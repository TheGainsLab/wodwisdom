/**
 * Complete food image → nutrition pipeline.
 * 1. Claude Vision identifies foods in the photo
 * 2. Searches FatSecret for each identified food
 * 3. Matches serving sizes and calculates nutrition
 * Returns data ready for food_entries insert.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callFatSecretAPI, normalizeToArray, roundToTwo } from "../_shared/fatsecret.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Claude Vision ──

async function identifyFoodWithClaude(
  imageBase64: string,
  imageType: string
): Promise<any[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageType === "png" ? "image/png" : "image/jpeg",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Analyze this food image and identify each distinct food item for nutrition database lookup.

For each food item, provide:
- food_name: Simple, searchable name for nutrition database (e.g., "chicken breast" not "Grilled Herb-Crusted Chicken")
- serving_size: Standard measurement (e.g., "1 cup", "100g", "1 medium", "1 slice")
- description: Cooking method and visual details (e.g., "grilled", "fried", "raw")

Keep food names SIMPLE and GENERIC for better database matching.

Return ONLY a JSON array with no markdown:
[
  {
    "food_name": "string",
    "serving_size": "string",
    "description": "string"
  }
]

If no food visible, return: []`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Claude API error:", response.status, errorText);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const aiResponse = data.content[0].text;

  // Try direct array match first
  let jsonStr = aiResponse.match(/\[[\s\S]*\]/)?.[0];
  // Fallback: extract from code fences
  if (!jsonStr) {
    const fenceMatch =
      aiResponse.match(/```json\n?([\s\S]*?)\n?```/) ||
      aiResponse.match(/```\n?([\s\S]*?)\n?```/);
    jsonStr = fenceMatch?.[1];
  }

  if (!jsonStr) return [];

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Serving matching ──

const UNIT_VARIANTS: Record<string, string[]> = {
  g: ["g", "gram", "grams"],
  oz: ["oz", "ounce", "ounces"],
  cup: ["cup", "cups", "c"],
  tbsp: ["tbsp", "tablespoon", "tablespoons", "tbs"],
  tsp: ["tsp", "teaspoon", "teaspoons"],
  ml: ["ml", "milliliter", "milliliters"],
  serving: ["serving", "servings", "serve"],
  piece: ["piece", "pieces", "whole", "each", "item"],
  slice: ["slice", "slices"],
  burger: ["burger", "burgers", "sandwich", "sandwiches"],
};

function findBestServingMatch(estimated: string, servings: any[]): any {
  if (!servings?.length) return null;

  const est = estimated.toLowerCase().trim();
  const estAmount = parseFloat(est.match(/[\d.]+/)?.[0] || "1");
  let estUnit = est.replace(/[\d.]+\s*/, "").trim();

  let normalizedUnit = estUnit;
  for (const [norm, variants] of Object.entries(UNIT_VARIANTS)) {
    if (variants.some((v) => estUnit.includes(v))) {
      normalizedUnit = norm;
      break;
    }
  }

  const scored = servings.map((s) => {
    let score = 0;
    const desc = `${s.serving_description || ""} ${s.measurement_description || ""} ${s.metric_serving_unit || ""}`.toLowerCase();

    if (UNIT_VARIANTS[normalizedUnit]?.some((v) => desc.includes(v))) {
      score += 100;
      const sAmt = parseFloat(s.metric_serving_amount || s.number_of_units || "1");
      score += Math.max(0, 50 - Math.abs(estAmount - sAmt) * 5);
    }

    est.split(/\s+/).forEach((kw) => {
      if (kw.length > 2 && desc.includes(kw)) score += 10;
    });

    if (desc.includes("100") && (desc.includes("g") || s.metric_serving_unit === "g")) {
      score += 5;
    }

    return { serving: s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].serving;
}

// ── FatSecret lookup ──

async function searchAndGetNutrition(
  foodName: string,
  estimatedServing?: string
): Promise<any> {
  try {
    const searchResult = await callFatSecretAPI("foods.search", {
      search_expression: foodName.trim(),
      page_number: 0,
      max_results: 5,
    });

    const foods = searchResult?.foods;
    if (!foods?.food) return null;

    const foodArray = normalizeToArray(foods.food);
    if (foodArray.length === 0) return null;

    const bestMatch = foodArray[0];
    const nutritionResult = await callFatSecretAPI("food.get", {
      food_id: bestMatch.food_id,
    });

    const food = nutritionResult?.food;
    if (food?.servings?.serving) {
      food.servings.serving = normalizeToArray(food.servings.serving);

      food.best_matched_serving = estimatedServing
        ? findBestServingMatch(estimatedServing, food.servings.serving)
        : food.servings.serving[0];
    }

    return {
      fatsecret_id: bestMatch.food_id,
      food_name: bestMatch.food_name,
      brand_name: bestMatch.brand_name || null,
      food_description: bestMatch.food_description,
      nutrition_data: food,
      search_alternatives: foodArray.slice(1, 4).map((alt: any) => ({
        food_id: alt.food_id,
        food_name: alt.food_name,
        brand_name: alt.brand_name || null,
        food_description: alt.food_description,
      })),
    };
  } catch (err) {
    console.error(`Error getting nutrition for ${foodName}:`, err);
    return null;
  }
}

// ── Main handler ──

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

    const { imageBase64, imageType = "jpeg" } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(
        JSON.stringify({ error: "imageBase64 parameter required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    // Step 1: Identify foods with Claude
    const identifiedFoods = await identifyFoodWithClaude(base64Data, imageType);

    if (identifiedFoods.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { foods: [], message: "No food items identified in the image" },
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Search FatSecret and calculate nutrition for each
    const results = await Promise.all(
      identifiedFoods.map(async (identified) => {
        const nutrition = await searchAndGetNutrition(
          identified.food_name,
          identified.serving_size
        );

        if (!nutrition) {
          return {
            identified,
            found: false,
            error: "No matching food found in database",
          };
        }

        const serving =
          nutrition.nutrition_data?.best_matched_serving ||
          nutrition.nutrition_data?.servings?.serving?.[0];

        // Calculate multiplier from Claude's serving estimate
        let units = parseFloat(serving?.number_of_units || "1");

        if (identified.serving_size && serving) {
          const est = identified.serving_size.toLowerCase().trim();
          const estAmt = parseFloat(est.match(/[\d.]+/)?.[0] || "1");
          const estUnit = est.replace(/[\d.]+\s*/, "").trim();

          const sDesc = (serving.serving_description || "").toLowerCase();
          const metricAmt = parseFloat(serving.metric_serving_amount || "0");
          const sAmt = metricAmt || parseFloat(sDesc.match(/[\d.]+/)?.[0] || "1");
          const sUnit = (serving.metric_serving_unit || sDesc).toLowerCase();

          const pieceUnits = ["piece", "whole", "each", "item", "medium", "large", "small"];
          const compatible =
            (estUnit.includes("g") && sUnit.includes("g")) ||
            (estUnit.includes("oz") && sUnit.includes("oz")) ||
            (estUnit.includes("cup") && sUnit.includes("cup")) ||
            (estUnit.includes("ml") && sUnit.includes("ml")) ||
            (estUnit.includes("tbsp") && sUnit.includes("tbsp")) ||
            (estUnit.includes("tsp") && sUnit.includes("tsp")) ||
            (pieceUnits.some((u) => estUnit.includes(u)) &&
              pieceUnits.some((u) => sUnit.includes(u)));

          if (compatible && sAmt > 0) units = estAmt / sAmt;
        }

        if (units <= 0 || units > 100) units = 1.0;
        units = roundToTwo(units);

        return {
          identified,
          found: true,
          cache_data: {
            fatsecret_id: nutrition.fatsecret_id,
            name: nutrition.food_name,
            brand_name: nutrition.brand_name,
            food_type: nutrition.nutrition_data?.food_type || null,
            nutrition_data: nutrition.nutrition_data,
          },
          entry_data: {
            food_id: nutrition.fatsecret_id,
            food_name: nutrition.food_name,
            serving_id: serving?.serving_id || "0",
            serving_description: serving?.serving_description || null,
            number_of_units: units,
            calories: roundToTwo(parseFloat(serving?.calories || "0") * units),
            protein: roundToTwo(parseFloat(serving?.protein || "0") * units),
            carbohydrate: roundToTwo(parseFloat(serving?.carbohydrate || "0") * units),
            fat: roundToTwo(parseFloat(serving?.fat || "0") * units),
            fiber: roundToTwo(parseFloat(serving?.fiber || "0") * units),
            sugar: roundToTwo(parseFloat(serving?.sugar || "0") * units),
            sodium: roundToTwo(parseFloat(serving?.sodium || "0") * units),
          },
          matched_serving: {
            claude_estimate: identified.serving_size,
            fatsecret_serving: serving?.serving_description,
            calculated_units: units,
            match_confidence:
              serving === nutrition.nutrition_data?.best_matched_serving
                ? "high"
                : "low",
          },
          available_servings: nutrition.nutrition_data?.servings?.serving || [],
          alternatives: nutrition.search_alternatives,
        };
      })
    );

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          foods: results,
          summary: {
            total_identified: identifiedFoods.length,
            total_found: results.filter((r) => r.found).length,
            total_not_found: results.filter((r) => !r.found).length,
          },
        },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("nutrition-image-complete error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
