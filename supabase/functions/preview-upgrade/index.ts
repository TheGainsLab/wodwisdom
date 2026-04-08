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

const PLAN_NAMES: Record<string, string> = {
  coach: "AI Coach",
  nutrition: "AI Nutrition",
  coach_nutrition: "AI Coach + AI Nutrition",
  programming: "AI Programming",
  engine: "Year of the Engine",
  all_access: "All Access",
};

/**
 * Preview what an upgrade will cost using Stripe's upcoming invoice API.
 * Does NOT charge the user — just returns the proration details.
 */
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

    // Get the customer's current subscription
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

    // Get current plan name from the subscription's price
    const currentPriceId = subscription.items?.data?.[0]?.price?.id;
    let currentPlanName = "Current Plan";
    if (currentPriceId) {
      // Try to match the price ID to a known plan
      for (const [planKey, prices] of Object.entries(PRICES)) {
        if (prices.monthly === currentPriceId || prices.quarterly === currentPriceId) {
          currentPlanName = PLAN_NAMES[planKey] || planKey;
          break;
        }
      }
    }

    // Use Stripe's upcoming invoice API to preview the proration
    const previewParams = new URLSearchParams({
      customer: profile.stripe_customer_id,
      subscription: subscription.id,
      "subscription_items[0][id]": subscriptionItemId,
      "subscription_items[0][price]": newPriceId,
      "subscription_billing_cycle_anchor": "now",
      "subscription_proration_behavior": "create_prorations",
    });

    const invoiceResp = await fetchWithTimeout(
      `https://api.stripe.com/v1/invoices/upcoming?${previewParams.toString()}`,
      {
        headers: {
          "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
        },
      },
      15_000
    );

    if (!invoiceResp.ok) {
      const errData = await invoiceResp.json();
      throw new Error(errData.error?.message || "Failed to preview upgrade");
    }

    const invoice = await invoiceResp.json();

    // Extract proration details from invoice lines
    let credit = 0;
    let newCharge = 0;
    for (const line of invoice.lines?.data || []) {
      if (line.amount < 0) {
        credit += Math.abs(line.amount);
      } else {
        newCharge += line.amount;
      }
    }

    // Amounts are in cents
    const totalDue = Math.max(0, invoice.amount_due || 0);
    const discount = invoice.total_discount_amounts?.reduce((sum: number, d: any) => sum + (d.amount || 0), 0) || 0;

    return new Response(JSON.stringify({
      current_plan: currentPlanName,
      new_plan: PLAN_NAMES[plan] || plan,
      interval: isQuarterly ? "quarterly" : "monthly",
      credit: (credit / 100).toFixed(2),
      new_charge: (newCharge / 100).toFixed(2),
      discount: (discount / 100).toFixed(2),
      total_due: (totalDue / 100).toFixed(2),
      currency: invoice.currency || "usd",
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed to preview upgrade" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
