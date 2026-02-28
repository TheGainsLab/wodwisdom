/**
 * Get complete nutrition details for a specific FatSecret food ID.
 * Optionally normalizes to per-gram values for flexible unit conversion.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callFatSecretAPI, normalizeToArray } from "../_shared/fatsecret.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAMS_PER_OZ = 28.35;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeToPerGram(serving: any): any {
  let grams: number | null = null;

  if (serving.metric_serving_amount && serving.metric_serving_unit === "g") {
    grams = parseFloat(serving.metric_serving_amount);
  } else if (serving.serving_description) {
    const desc = serving.serving_description.toLowerCase();
    const ozMatch = desc.match(/([\d.]+)\s*oz/i);
    if (ozMatch) grams = parseFloat(ozMatch[1]) * GRAMS_PER_OZ;
    if (!grams) {
      const gMatch = desc.match(/([\d.]+)\s*g(?:\s|$)/i);
      if (gMatch) grams = parseFloat(gMatch[1]);
    }
  }

  if (!grams || grams <= 0) return null;

  return {
    grams,
    calories_per_gram: parseFloat(serving.calories || 0) / grams,
    protein_per_gram: parseFloat(serving.protein || 0) / grams,
    carbs_per_gram: parseFloat(serving.carbohydrate || 0) / grams,
    fat_per_gram: parseFloat(serving.fat || 0) / grams,
    fiber_per_gram: parseFloat(serving.fiber || 0) / grams,
    sodium_per_gram: parseFloat(serving.sodium || 0) / grams,
  };
}

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

    const { foodId, normalize = false } = await req.json();

    if (!foodId || typeof foodId !== "string") {
      return new Response(
        JSON.stringify({ error: "foodId parameter required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const result = await callFatSecretAPI("food.get", {
      food_id: foodId.trim(),
    });

    const food = result?.food;
    if (!food) {
      return new Response(
        JSON.stringify({ error: "Food not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Normalize servings (single vs array quirk)
    if (food.servings?.serving) {
      food.servings.serving = normalizeToArray(food.servings.serving);
    }

    if (normalize && food.servings?.serving) {
      const servings = food.servings.serving;
      const bestServing =
        servings.find(
          (s: any) =>
            s.serving_description?.toLowerCase().includes("100") &&
            s.metric_serving_unit === "g"
        ) ||
        servings.find((s: any) =>
          s.serving_description?.toLowerCase().includes("1 oz")
        ) ||
        servings[0];

      const perGram = normalizeToPerGram(bestServing);
      if (perGram) {
        food.normalized_nutrition = {
          ...perGram,
          source_serving: bestServing.serving_description,
        };
      }
    }

    return new Response(
      JSON.stringify({ success: true, data: { food } }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("nutrition-food error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
