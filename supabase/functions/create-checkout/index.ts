import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, ALLOWED_ORIGINS } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { ALERT_EMAIL, buildIntentAlertEmail, sendViaResend } from "../_shared/checkout-emails.ts";

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

const PRICES: Record<string, { monthly: string | undefined; quarterly: string | undefined }> = {
  coach: { monthly: PRICE_COACH, quarterly: PRICE_COACH_QUARTERLY },
  nutrition: { monthly: PRICE_NUTRITION, quarterly: PRICE_NUTRITION_QUARTERLY },
  coach_nutrition: { monthly: PRICE_COACH_NUTRITION, quarterly: PRICE_COACH_NUTRITION_QUARTERLY },
  programming: { monthly: PRICE_PROGRAMMING, quarterly: PRICE_PROGRAMMING_QUARTERLY },
  engine: { monthly: PRICE_ENGINE, quarterly: PRICE_ENGINE_QUARTERLY },
  all_access: { monthly: PRICE_ALL_ACCESS, quarterly: PRICE_ALL_ACCESS_QUARTERLY },
};

serve(async (req) => {
  const cors = getCorsHeaders(req);
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

    const origin = req.headers.get("Origin") ?? "";
    const baseUrl = ALLOWED_ORIGINS.includes(origin) ? origin : "https://www.thegainslab.com";
    // Include session_id in success URL so CheckoutCompletePage can look up the email
    const successUrl = `${baseUrl}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/checkout`;

    const params: Record<string, string> = {
      "mode": "subscription",
      // No payment_method_types: Stripe's DYNAMIC payment methods pick what
      // each buyer sees from the dashboard's payment-method configuration,
      // their locale/currency, and subscription support (non-recurring
      // methods are filtered out automatically). Was hardcoded to card-only,
      // which showed overseas buyers — half the July '26 checkout traffic —
      // a US-shaped page; the dashboard config is the control panel now.
      // Explicit (not just relying on Stripe's default): a 100%-off coupon
      // (e.g. a winback promo code) makes the first invoice $0, but this is a
      // recurring subscription — a card MUST still be collected so renewal
      // charges have something to bill against.
      "payment_method_collection": "always",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "success_url": successUrl,
      "cancel_url": cancelUrl,
      "metadata[plan]": plan,
      "subscription_data[metadata][plan]": plan,
    };

    // Promo codes are only offered on monthly plans; quarterly is already discounted.
    if (!isQuarterly) {
      params["allow_promotion_codes"] = "true";
    }

    // If authenticated, pre-fill email and attach user ID
    if (userEmail) {
      params["customer_email"] = userEmail;
    }
    if (userId) {
      params["metadata[user_id]"] = userId;
      params["subscription_data[metadata][user_id]"] = userId;
    }

    const resp = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    }, 15_000);

    const session = await resp.json();
    if (session.error) throw new Error(session.error.message);

    // Checkout breadcrumb: record the attempt so the admin panel can see who
    // opened checkout and never paid (the completed webhook flips status).
    // Best-effort — a logging failure must never block the checkout itself.
    try {
      const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
      await supa.from("checkout_attempts").insert({
        user_id: userId ?? null,
        email: userEmail ?? null,
        plan,
        billing_interval: isQuarterly ? "quarterly" : "monthly",
        stripe_session_id: session.id,
      });

      // High-intent alert: this identity just opened its SECOND checkout in
      // 24h without completing one — the same-day founder signal (a personal
      // note now beats the automated recovery email at the 24h expiry).
      // Fires only when the count is EXACTLY 2, so a six-session burst alerts
      // once. Anonymous checkouts (no auth header) have no identity to count.
      if (userId || userEmail) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        let recentQ = supa.from("checkout_attempts")
          .select("plan, status")
          .gte("created_at", since);
        recentQ = userId ? recentQ.eq("user_id", userId) : recentQ.eq("email", userEmail!);
        const { data: recent } = await recentQ;
        const attempts = (recent ?? []) as { plan: string; status: string }[];
        const anyCompleted = attempts.some((a) => a.status === "completed");
        if (attempts.length === 2 && !anyCompleted) {
          const plans = [...new Set(attempts.map((a) => a.plan))];
          const { subject, html } = buildIntentAlertEmail({
            email: userEmail ?? null,
            userId: userId ?? null,
            plans,
            attemptCount: attempts.length,
          });
          const messageId = await sendViaResend(ALERT_EMAIL, subject, html);
          console.log(`[create-checkout] high-intent alert ${messageId ? "sent" : "FAILED"} for ${userEmail ?? userId}`);
        }
      }
    } catch (e) {
      console.error("[create-checkout] failed to record checkout attempt:", e);
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
