/**
 * CRUD operations for user nutrition favorites:
 * food favorites, restaurants, brands, hidden lists, and meal templates.
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

    const userId = user.id;
    const { action, ...params } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({ error: "action parameter required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let result: any;

    switch (action) {
      case "get_all":
        result = await getAllFavorites(supa, userId);
        break;
      case "add_restaurant":
        result = await addRestaurant(supa, userId, params);
        break;
      case "add_brand":
        result = await addBrand(supa, userId, params);
        break;
      case "add_food":
        result = await addFood(supa, userId, params);
        break;
      case "delete_food":
        result = await deleteFood(supa, userId, params);
        break;
      case "delete_restaurant":
        result = await deleteRestaurant(supa, userId, params);
        break;
      case "delete_brand":
        result = await deleteBrand(supa, userId, params);
        break;
      case "hide_restaurant":
        result = await hideRestaurant(supa, userId, params);
        break;
      case "hide_brand":
        result = await hideBrand(supa, userId, params);
        break;
      case "add_meal_template":
        result = await addMealTemplate(supa, userId, params);
        break;
      case "update_meal_template":
        result = await updateMealTemplate(supa, userId, params);
        break;
      case "delete_meal_template":
        result = await deleteMealTemplate(supa, userId, params);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" },
          }
        );
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("favorites-manage error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});

// ── Actions ──

async function getAllFavorites(supa: any, userId: string) {
  const [restaurants, brands, foods, meals] = await Promise.all([
    supa
      .from("favorite_restaurants")
      .select("*")
      .eq("user_id", userId)
      .order("last_accessed_at", { ascending: false, nullsFirst: false }),
    supa
      .from("favorite_brands")
      .select("*")
      .eq("user_id", userId)
      .order("last_accessed_at", { ascending: false, nullsFirst: false }),
    supa
      .from("food_favorites")
      .select("*")
      .eq("user_id", userId)
      .order("log_count", { ascending: false }),
    supa
      .from("meal_templates")
      .select("*")
      .eq("user_id", userId)
      .order("log_count", { ascending: false }),
  ]);

  return {
    restaurants: restaurants.data || [],
    brands: brands.data || [],
    foods: foods.data || [],
    meals: meals.data || [],
  };
}

async function addRestaurant(supa: any, userId: string, params: any) {
  const { restaurant_name, fatsecret_brand_filter = null } = params;
  if (!restaurant_name) throw new Error("restaurant_name required");

  await supa
    .from("hidden_restaurants")
    .delete()
    .eq("user_id", userId)
    .eq("restaurant_name", restaurant_name);

  const { data, error } = await supa
    .from("favorite_restaurants")
    .insert({
      user_id: userId,
      restaurant_name,
      fatsecret_brand_filter,
      last_accessed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function addBrand(supa: any, userId: string, params: any) {
  const { brand_name, fatsecret_brand_filter = null } = params;
  if (!brand_name) throw new Error("brand_name required");

  await supa
    .from("hidden_brands")
    .delete()
    .eq("user_id", userId)
    .eq("brand_name", brand_name);

  const { data, error } = await supa
    .from("favorite_brands")
    .insert({
      user_id: userId,
      brand_name,
      fatsecret_brand_filter,
      last_accessed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function addFood(supa: any, userId: string, params: any) {
  const {
    food_id,
    food_name,
    food_type = "generic",
    brand_name = null,
    serving_id = null,
    serving_description = null,
    default_amount = 1,
    default_unit = "serving",
    calories_per_gram = null,
    protein_per_gram = null,
    carbs_per_gram = null,
    fat_per_gram = null,
    fiber_per_gram = null,
    sodium_per_gram = null,
    raw_serving_calories = null,
    raw_serving_protein = null,
    raw_serving_carbs = null,
    raw_serving_fat = null,
  } = params;

  if (!food_id || !food_name) throw new Error("food_id and food_name required");

  const { data, error } = await supa
    .from("food_favorites")
    .insert({
      user_id: userId,
      food_id,
      food_name,
      food_type,
      brand_name,
      serving_id,
      serving_description,
      default_amount,
      default_unit,
      calories_per_gram,
      protein_per_gram,
      carbs_per_gram,
      fat_per_gram,
      fiber_per_gram,
      sodium_per_gram,
      raw_serving_calories,
      raw_serving_protein,
      raw_serving_carbs,
      raw_serving_fat,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteFood(supa: any, userId: string, params: any) {
  const { id } = params;
  if (!id) throw new Error("id required");

  const { error } = await supa
    .from("food_favorites")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw error;
  return { deleted: true };
}

async function deleteRestaurant(supa: any, userId: string, params: any) {
  const { id } = params;
  if (!id) throw new Error("id required");

  const { error } = await supa
    .from("favorite_restaurants")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw error;
  return { deleted: true };
}

async function deleteBrand(supa: any, userId: string, params: any) {
  const { id } = params;
  if (!id) throw new Error("id required");

  const { error } = await supa
    .from("favorite_brands")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw error;
  return { deleted: true };
}

async function hideRestaurant(supa: any, userId: string, params: any) {
  const { restaurant_name } = params;
  if (!restaurant_name) throw new Error("restaurant_name required");

  const { data, error } = await supa
    .from("hidden_restaurants")
    .insert({ user_id: userId, restaurant_name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { hidden: true, already_hidden: true };
    throw error;
  }

  return { hidden: true, data };
}

async function hideBrand(supa: any, userId: string, params: any) {
  const { brand_name } = params;
  if (!brand_name) throw new Error("brand_name required");

  const { data, error } = await supa
    .from("hidden_brands")
    .insert({ user_id: userId, brand_name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { hidden: true, already_hidden: true };
    throw error;
  }

  return { hidden: true, data };
}

async function addMealTemplate(supa: any, userId: string, params: any) {
  const { template_name, items, totals } = params;
  if (!template_name) throw new Error("template_name required");
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("items array required with at least one item");
  }

  const { data: template, error: tErr } = await supa
    .from("meal_templates")
    .insert({
      user_id: userId,
      template_name,
      total_calories: totals?.calories || 0,
      total_protein: totals?.protein || 0,
      total_carbohydrate: totals?.carbohydrate || 0,
      total_fat: totals?.fat || 0,
      total_fiber: totals?.fiber || 0,
      total_sodium: totals?.sodium || 0,
    })
    .select()
    .single();

  if (tErr) throw tErr;

  const rows = items.map((item: any, i: number) => ({
    meal_template_id: template.id,
    food_id: item.food_id,
    food_name: item.food_name,
    serving_id: item.serving_id || "0",
    serving_description: item.serving_description || "",
    number_of_units: item.number_of_units || 1,
    calories: item.calories || 0,
    protein: item.protein || 0,
    carbohydrate: item.carbohydrate || 0,
    fat: item.fat || 0,
    fiber: item.fiber || 0,
    sugar: item.sugar || 0,
    sodium: item.sodium || 0,
    sort_order: i,
  }));

  const { error: iErr } = await supa
    .from("meal_template_items")
    .insert(rows);

  if (iErr) throw iErr;
  return template;
}

async function updateMealTemplate(supa: any, userId: string, params: any) {
  const { template_id, template_name, items, totals } = params;
  if (!template_id) throw new Error("template_id required");
  if (!template_name) throw new Error("template_name required");
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("items array required with at least one item");
  }

  // Verify ownership
  const { data: existing } = await supa
    .from("meal_templates")
    .select("id")
    .eq("id", template_id)
    .eq("user_id", userId)
    .single();

  if (!existing) throw new Error("Meal template not found or access denied");

  const { data: template, error: tErr } = await supa
    .from("meal_templates")
    .update({
      template_name,
      total_calories: totals?.calories || 0,
      total_protein: totals?.protein || 0,
      total_carbohydrate: totals?.carbohydrate || 0,
      total_fat: totals?.fat || 0,
      total_fiber: totals?.fiber || 0,
      total_sodium: totals?.sodium || 0,
    })
    .eq("id", template_id)
    .select()
    .single();

  if (tErr) throw tErr;

  // Replace items
  await supa
    .from("meal_template_items")
    .delete()
    .eq("meal_template_id", template_id);

  const rows = items.map((item: any, i: number) => ({
    meal_template_id: template.id,
    food_id: item.food_id,
    food_name: item.food_name,
    serving_id: item.serving_id || "0",
    serving_description: item.serving_description || "",
    number_of_units: item.number_of_units || 1,
    calories: item.calories || 0,
    protein: item.protein || 0,
    carbohydrate: item.carbohydrate || 0,
    fat: item.fat || 0,
    fiber: item.fiber || 0,
    sugar: item.sugar || 0,
    sodium: item.sodium || 0,
    sort_order: i,
  }));

  const { error: iErr } = await supa
    .from("meal_template_items")
    .insert(rows);

  if (iErr) throw iErr;
  return template;
}

async function deleteMealTemplate(supa: any, userId: string, params: any) {
  const { id } = params;
  if (!id) throw new Error("id required");

  const { error } = await supa
    .from("meal_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw error;
  return { deleted: true };
}
