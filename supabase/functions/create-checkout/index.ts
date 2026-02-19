import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const PRICE_ATHLETE = Deno.env.get("STRIPE_PRICE_ATHLETE");
const PRICE_GYM = Deno.env.get("STRIPE_PRICE_GYM");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader!.replace("Bearer ", "");
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) throw new Error("Not authenticated");

    const { plan } = await req.json();
    const priceId = plan === "gym" ? PRICE_GYM : PRICE_ATHLETE;

    const origin = req.headers.get("Origin") || req.headers.get("Referer")?.replace(/\/$/, "") || "https://wodwisdom.com";
    const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;
    const successUrl = `${baseUrl}/checkout/complete`;
    const cancelUrl = `${baseUrl}/checkout`;

    const params: Record<string, string> = {
      "mode": "subscription",
      "payment_method_types[0]": "card",
      "line_items[0][price]": priceId!,
      "line_items[0][quantity]": "1",
      "customer_email": user.email!,
      "success_url": successUrl,
      "cancel_url": cancelUrl,
      "metadata[user_id]": user.id,
      "metadata[plan]": plan,
      "subscription_data[metadata][user_id]": user.id,
      "subscription_data[metadata][plan]": plan,
    };

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
