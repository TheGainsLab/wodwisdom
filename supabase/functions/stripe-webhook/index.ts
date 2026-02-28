import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

// Product → feature mapping
// When you add new Stripe products, map them here
const PRODUCT_FEATURES: Record<string, string[]> = {
  ai_suite: ["ai_chat", "program_gen", "workout_review", "workout_log"],
  // engine: ["engine"],
  // engine_premium: ["engine", "ai_chat"],
};

// Map Stripe price IDs to product keys above
const PRICE_TO_PRODUCT: Record<string, string> = {
  [Deno.env.get("STRIPE_PRICE_ATHLETE") || ""]: "ai_suite",
  // [Deno.env.get("STRIPE_PRICE_ENGINE") || ""]: "engine",
};

const cryptoKey = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);

async function verifyStripeSignature(payload: string, header: string): Promise<boolean> {
  const pairs = header.split(",").map(s => s.trim().split("="));
  const timestamp = pairs.find(p => p[0] === "t")?.[1];
  const sig = pairs.find(p => p[0] === "v1")?.[1];
  if (!timestamp || !sig) return false;
  const signedPayload = timestamp + "." + payload;
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return expected === sig;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    if (!sig || !(await verifyStripeSignature(body, sig))) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(body);
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = session.customer_email || session.customer_details?.email;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Look up which product was purchased
        const priceId = session.line_items?.data?.[0]?.price?.id || "";
        const productKey = PRICE_TO_PRODUCT[priceId] || "ai_suite";
        const features = PRODUCT_FEATURES[productKey] || [];

        // Find user by email
        const { data: profiles } = await supa.from("profiles").select("id").eq("email", email).limit(1);
        if (profiles && profiles.length > 0) {
          const userId = profiles[0].id;
          const source = subscriptionId || `stripe_${customerId}`;

          // Store stripe_customer_id on profiles
          await supa.from("profiles").update({
            stripe_customer_id: customerId,
          }).eq("id", userId);

          // Grant entitlements for this product
          for (const feature of features) {
            await supa.from("user_entitlements").upsert({
              user_id: userId,
              feature,
              source,
            }, { onConflict: "user_id,feature,source" });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subscriptionId = sub.id;

        // Find user by stripe_customer_id
        const { data: profiles } = await supa.from("profiles").select("id").eq("stripe_customer_id", customerId).limit(1);
        if (profiles && profiles.length > 0) {
          // Remove all entitlements granted by this subscription
          await supa.from("user_entitlements")
            .delete()
            .eq("user_id", profiles[0].id)
            .eq("source", subscriptionId);
        }
        break;
      }

      // subscription.updated, invoice.paid, invoice.payment_failed:
      // Entitlements persist as long as they exist — no action needed.
      // When you want grace periods or past_due handling, add logic here.

      default:
        console.log("Unhandled event:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 400 });
  }
});
