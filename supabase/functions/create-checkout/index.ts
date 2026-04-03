import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const PRICE_COACH = Deno.env.get("STRIPE_PRICE_COACH");
const PRICE_COACH_QUARTERLY = Deno.env.get("STRIPE_PRICE_COACH_QUARTERLY");
const PRICE_NUTRITION = Deno.env.get("STRIPE_PRICE_NUTRITION");
const PRICE_NUTRITION_QUARTERLY = Deno.env.get("STRIPE_PRICE_NUTRITION_QUARTERLY");
const PRICE_COACH_NUTRITION = Deno.env.get("STRIPE_PRICE_COACH_NUTRITION");
const PRICE_COACH_NUTRITION_QUARTERLY = Deno.env.get("STRIPE_PRICE_COACH_NUTRITION_QUARTERLY");
const PRICE_PROGRAMMING = Deno.env.get("STRIPE_PRICE_PROGRAMMING");
const PRICE_PROGRAMMING_QUARTERLY = Deno.env.get("STRIPE_PRICE_PROGRAMMING_QUARTERLY");
const PRICE_ENGINE = Deno.env.get("STRIPE_PRICE_ENGINE");
const PRICE_ENGINE_QUARTERLY = Deno.env.get("STRIPE_PRICE_ENGINE_QUARTERLY");
const PRICE_ALL_ACCESS = Deno.env.get("STRIPE_PRICE_ALL_ACCESS");
const PRICE_ALL_ACCESS_QUARTERLY = Deno.env.get("STRIPE_PRICE_ALL_ACCESS_QUARTERLY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRICES: Record<string, { monthly: string | undefined; quarterly: string | undefined }> = {
  coach: { monthly: PRICE_COACH, quarterly: PRICE_COACH_QUARTERLY },
  nutrition: { monthly: PRICE_NUTRITION, quarterly: PRICE_NUTRITION_QUARTERLY },
  coach_nutrition: { monthly: PRICE_COACH_NUTRITION, quarterly: PRICE_COACH_NUTRITION_QUARTERLY },
  programming: { monthly: PRICE_PROGRAMMING, quarterly: PRICE_PROGRAMMING_QUARTERLY },
  engine: { monthly: PRICE_ENGINE, quarterly: PRICE_ENGINE_QUARTERLY },
  all_access: { monthly: PRICE_ALL_ACCESS, quarterly: PRICE_ALL_ACCESS_QUARTERLY },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { plan, interval = "monthly" } = await req.json();
    const isQuarterly = interval === "quarterly";

    const planPrices = PRICES[plan];
    if (!planPrices) throw new Error("Invalid plan: " + plan);
    const priceId = isQuarterly ? planPrices.quarterly : planPrices.monthly;
    if (!priceId) throw new Error("Price not configured for " + plan + " " + interval);

    // Check if user is authenticated (optional)
    const authHeader = req.headers.get("Authorization");
    let userEmail: string | undefined;
    let userId: string | undefined;

    if (authHeader) {
      const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supa.auth.getUser(token);
      if (user) {
        userEmail = user.email;
        userId = user.id;
      }
    }

    const origin = req.headers.get("Origin") || req.headers.get("Referer")?.replace(/\/$/, "") || "https://www.thegainslab.com";
    const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;
    // Include session_id in success URL so CheckoutCompletePage can look up the email
    const successUrl = `${baseUrl}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/checkout`;

    const params: Record<string, string> = {
      "mode": "subscription",
      "allow_promotion_codes": "true",
      "payment_method_types[0]": "card",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "success_url": successUrl,
      "cancel_url": cancelUrl,
      "metadata[plan]": plan,
      "subscription_data[metadata][plan]": plan,
    };

    // If authenticated, pre-fill email and attach user ID
    if (userEmail) {
      params["customer_email"] = userEmail;
    }
    if (userId) {
      params["metadata[user_id]"] = userId;
      params["subscription_data[metadata][user_id]"] = userId;
    }

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });

    const session = await resp.json();
    if (session.error) throw new Error(session.error.message);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
