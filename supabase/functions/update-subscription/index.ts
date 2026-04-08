import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const PRICES: Record<string, { monthly: string | undefined; quarterly: string | undefined }> = {
  coach: { monthly: Deno.env.get("STRIPE_PRICE_COACH"), quarterly: Deno.env.get("STRIPE_PRICE_COACH_QUARTERLY") },
  nutrition: { monthly: Deno.env.get("STRIPE_PRICE_NUTRITION"), quarterly: Deno.env.get("STRIPE_PRICE_NUTRITION_QUARTERLY") },
  coach_nutrition: { monthly: Deno.env.get("STRIPE_PRICE_COACH_NUTRITION"), quarterly: Deno.env.get("STRIPE_PRICE_COACH_NUTRITION_QUARTERLY") },
  programming: { monthly: Deno.env.get("STRIPE_PRICE_PROGRAMMING"), quarterly: Deno.env.get("STRIPE_PRICE_PROGRAMMING_QUARTERLY") },
  engine: { monthly: Deno.env.get("STRIPE_PRICE_ENGINE"), quarterly: Deno.env.get("STRIPE_PRICE_ENGINE_QUARTERLY") },
  all_access: { monthly: Deno.env.get("STRIPE_PRICE_ALL_ACCESS"), quarterly: Deno.env.get("STRIPE_PRICE_ALL_ACCESS_QUARTERLY") },
};

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) throw new Error("Not authenticated");

    // Parse request
    const { plan, interval = "monthly" } = await req.json();
    const isQuarterly = interval === "quarterly";

    const planPrices = PRICES[plan];
    if (!planPrices) throw new Error("Invalid plan: " + plan);
    const newPriceId = isQuarterly ? planPrices.quarterly : planPrices.monthly;
    if (!newPriceId) throw new Error("Price not configured for " + plan + " " + interval);

    // Get user's Stripe customer ID
    const { data: profile } = await supa.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    if (!profile?.stripe_customer_id) throw new Error("No active subscription found");

    // Get the customer's current subscription from Stripe
    const subsResp = await fetchWithTimeout(
      `https://api.stripe.com/v1/subscriptions?customer=${profile.stripe_customer_id}&status=active&limit=1`,
      { headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") } },
      15_000
    );
    if (!subsResp.ok) throw new Error("Failed to fetch subscriptions");
    const subsData = await subsResp.json();

    const subscription = subsData.data?.[0];
    if (!subscription) throw new Error("No active subscription found");

    const subscriptionItemId = subscription.items?.data?.[0]?.id;
    if (!subscriptionItemId) throw new Error("No subscription item found");

    // Update the subscription: swap price, prorate, reset billing cycle
    const updateParams = new URLSearchParams({
      "items[0][id]": subscriptionItemId,
      "items[0][price]": newPriceId,
      "proration_behavior": "create_prorations",
      "billing_cycle_anchor": "now",
      "payment_behavior": "pending_if_incomplete",
      "metadata[plan]": plan,
    });

    const updateResp = await fetchWithTimeout(
      `https://api.stripe.com/v1/subscriptions/${subscription.id}`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: updateParams.toString(),
      },
      15_000
    );

    if (!updateResp.ok) {
      const errData = await updateResp.json();
      throw new Error(errData.error?.message || "Failed to update subscription");
    }

    const updated = await updateResp.json();

    return new Response(JSON.stringify({ success: true, plan, interval, status: updated.status }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed to update subscription" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
