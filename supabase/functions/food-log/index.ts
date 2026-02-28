/**
 * Log a food entry to the user's daily nutrition log.
 * Triggers auto-update daily_nutrition totals and auto-favorite logic.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      food_id,
      food_name,
      cached_food_id = null,
      serving_id,
      serving_description = null,
      number_of_units = 1,
      calories,
      protein,
      carbohydrate,
      fat,
      fiber = null,
      sugar = null,
      sodium = null,
      meal_type = null,
      notes = null,
      logged_at = new Date().toISOString(),
    } = await req.json();

    if (!food_id || !food_name || !serving_id || calories === undefined) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required fields: food_id, food_name, serving_id, calories",
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { data: entry, error: insertErr } = await supa
      .from("food_entries")
      .insert({
        user_id: user.id,
        food_id,
        cached_food_id,
        food_name,
        serving_id,
        serving_description,
        number_of_units,
        calories,
        protein,
        carbohydrate,
        fat,
        fiber,
        sugar,
        sodium,
        meal_type,
        notes,
        logged_at,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("food-log insert error:", insertErr);
      throw insertErr;
    }

    return new Response(JSON.stringify({ success: true, data: entry }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("food-log error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
