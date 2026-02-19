import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) throw new Error("Not authenticated");

    const { data: profile } = await supa.from("profiles").select("stripe_customer_id, subscription_status").eq("id", user.id).single();
    if (!profile?.stripe_customer_id) throw new Error("No subscription to manage");
    if (profile.subscription_status !== "active" && profile.subscription_status !== "canceling" && profile.subscription_status !== "past_due") {
      throw new Error("No active subscription");
    }

    const origin = req.headers.get("Origin") || req.headers.get("Referer")?.replace(/\/$/, "") || "https://wodwisdom.com";
    const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;
    const returnUrl = `${baseUrl}/settings`;

    const params = new URLSearchParams({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
    });

    const resp = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    return new Response(JSON.stringify({ url: data.url }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed to open billing portal" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
