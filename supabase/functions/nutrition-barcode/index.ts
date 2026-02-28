/**
 * Look up a barcode (UPC/EAN) in FatSecret and return nutrition data.
 * Handles multiple barcode formats and normalizes to GTIN-13.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callFatSecretAPI, normalizeToArray, roundToTwo } from "../_shared/fatsecret.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeBarcodeToGTIN13(barcode: string, barcodeType: string): string {
  const cleaned = barcode.trim().replace(/\D/g, "");
  if (cleaned.length === 13) return cleaned;
  if (barcodeType === "UPC_A" && cleaned.length === 12) return "0" + cleaned;
  if (barcodeType === "EAN_8" && cleaned.length === 8) return "00000" + cleaned;
  if (cleaned.length < 13) return cleaned.padStart(13, "0");
  if (cleaned.length > 13) return cleaned.slice(-13);
  return cleaned;
}

function extractFoodId(barcodeResult: any): string | null {
  if (barcodeResult?.food_id) {
    if (barcodeResult.food_id?.value) return String(barcodeResult.food_id.value);
    if (typeof barcodeResult.food_id === "string") return barcodeResult.food_id;
    if (barcodeResult.food_id?.food_id) return String(barcodeResult.food_id.food_id);
  }
  if (barcodeResult?.food?.food_id) return String(barcodeResult.food.food_id);
  return null;
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

    const { barcode, barcodeType = "UPC_A" } = await req.json();

    if (!barcode || typeof barcode !== "string") {
      return new Response(
        JSON.stringify({ error: "barcode parameter required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const normalizedBarcode = normalizeBarcodeToGTIN13(barcode, barcodeType);

    // Step 1: Find food ID from barcode
    const barcodeResult = await callFatSecretAPI("food.find_id_for_barcode", {
      barcode: normalizedBarcode,
    });

    const foodId = extractFoodId(barcodeResult);
    if (!foodId) {
      return new Response(
        JSON.stringify({
          error: "Product not found",
          message: "This barcode is not in the FatSecret database",
        }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Get complete nutrition data
    const nutritionResult = await callFatSecretAPI("food.get", {
      food_id: foodId,
    });

    const food = nutritionResult?.food;
    if (!food) {
      return new Response(
        JSON.stringify({ error: "Could not retrieve nutrition data" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (food.servings?.serving) {
      food.servings.serving = normalizeToArray(food.servings.serving);
    }

    const defaultServing = food.servings?.serving?.[0];
    if (!defaultServing) {
      return new Response(
        JSON.stringify({ error: "No serving information available" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          barcode,
          normalized_barcode: normalizedBarcode,
          found: true,
          cache_data: {
            fatsecret_id: foodId,
            name: food.food_name,
            brand_name: food.brand_name || null,
            food_type: food.food_type || "Packaged",
            nutrition_data: food,
          },
          entry_data: {
            food_id: foodId,
            food_name: food.food_name,
            serving_id: defaultServing.serving_id || "0",
            serving_description: defaultServing.serving_description || null,
            number_of_units: 1,
            calories: roundToTwo(parseFloat(defaultServing.calories || "0")),
            protein: roundToTwo(parseFloat(defaultServing.protein || "0")),
            carbohydrate: roundToTwo(parseFloat(defaultServing.carbohydrate || "0")),
            fat: roundToTwo(parseFloat(defaultServing.fat || "0")),
            fiber: roundToTwo(parseFloat(defaultServing.fiber || "0")),
            sugar: roundToTwo(parseFloat(defaultServing.sugar || "0")),
            sodium: roundToTwo(parseFloat(defaultServing.sodium || "0")),
          },
          product_info: {
            brand: food.brand_name,
            name: food.food_name,
            barcode,
            normalized_barcode: normalizedBarcode,
            barcode_type: barcodeType,
          },
          available_servings: food.servings?.serving || [],
        },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("nutrition-barcode error:", e);
    return new Response(
      JSON.stringify({
        error: (e as Error).message,
        message: "Failed to look up barcode. It may not be in the database.",
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
