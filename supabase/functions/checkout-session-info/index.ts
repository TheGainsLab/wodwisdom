import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error("Missing session_id");

    // Fetch checkout session from Stripe
    const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
      headers: {
        "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
      },
    });

    const session = await resp.json();
    if (session.error) throw new Error(session.error.message);

    const email = session.customer_email || session.customer_details?.email;
    const plan = session.metadata?.plan || null;

    return new Response(JSON.stringify({ email, plan }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
