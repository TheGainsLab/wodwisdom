/**
 * Search FatSecret food database.
 * Supports filtering by type (brand/generic) and specific brand name.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callFatSecretAPI, normalizeToArray } from "../_shared/fatsecret.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const {
      query,
      pageNumber = 0,
      maxResults = 20,
      filterType = "all",
      brandName = null,
    } = await req.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "query parameter required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const result = await callFatSecretAPI("foods.search", {
      search_expression: query.trim(),
      page_number: pageNumber,
      max_results: maxResults,
    });

    const foods = result?.foods;
    if (!foods || !foods.food) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            foods: [],
            pagination: { page: 0, maxResults: 0, total: 0, filtered: false },
          },
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let filtered = normalizeToArray(foods.food);

    if (filterType === "brand") {
      filtered = filtered.filter(
        (f: any) => f.brand_name && f.brand_name.trim().length > 0
      );
    } else if (filterType === "generic") {
      filtered = filtered.filter(
        (f: any) => !f.brand_name || f.brand_name.trim().length === 0
      );
    }

    if (brandName && typeof brandName === "string") {
      const search = brandName.toLowerCase();
      filtered = filtered.filter(
        (f: any) => f.brand_name && f.brand_name.toLowerCase().includes(search)
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          foods: filtered,
          pagination: {
            page: parseInt(foods.page_number || "0", 10),
            maxResults: parseInt(foods.max_results || "0", 10),
            total: filtered.length,
            filtered: filterType !== "all" || brandName !== null,
          },
        },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("nutrition-search error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
