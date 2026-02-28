/**
 * Identify food items in a photo using Claude Vision.
 * Lightweight — returns identified foods only, no FatSecret lookup.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
              text: `Analyze this food image and identify all food items visible. For each food item, provide:
1. Food name (be specific, e.g., "Grilled Chicken Breast" not just "Chicken")
2. Estimated serving size/quantity (e.g., "1 cup", "200g", "1 medium apple")
3. Estimated calories (if you can reasonably estimate)
4. Brief description of what you see

Return the response as a JSON array of objects with this structure:
[
  {
    "food_name": "string",
    "serving_size": "string",
    "estimated_calories": number (or null if unknown),
    "description": "string"
  }
]

If you cannot identify any food items, return an empty array [].`,
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

  let jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    jsonMatch =
      aiResponse.match(/```json\n?([\s\S]*?)\n?```/) ||
      aiResponse.match(/```\n?([\s\S]*?)\n?```/);
    if (jsonMatch) jsonMatch = [jsonMatch[0], jsonMatch[1]];
  }

  if (!jsonMatch) {
    console.error("Could not extract JSON from Claude response:", aiResponse);
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0] || jsonMatch[1] || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error("Failed to parse Claude response as JSON");
    return [];
  }
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

    const { imageBase64, imageType = "jpeg" } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(
        JSON.stringify({ error: "imageBase64 parameter required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    const foods = await identifyFoodWithClaude(base64Data, imageType);

    return new Response(
      JSON.stringify({ success: true, data: { foods } }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("nutrition-image-recognition error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
