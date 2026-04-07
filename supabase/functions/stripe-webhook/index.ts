import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

// Fallback plan → entitlements mapping (used if price metadata is missing)
const PLAN_ENTITLEMENTS: Record<string, string[]> = {
  coach: ["ai_chat"],
  nutrition: ["nutrition"],
  coach_nutrition: ["ai_chat", "nutrition"],
  engine: ["engine", "ai_chat", "nutrition"],
  programming: ["programming", "ai_chat", "nutrition"],
  all_access: ["ai_chat", "programming", "engine", "nutrition"],
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

// Fetch subscription details from Stripe to get price metadata
async function getSubscriptionEntitlements(subscriptionId: string): Promise<{ plan: string; features: string[] }> {
  // Fetch the subscription to get the price ID
  const subResp = await fetchWithTimeout(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
  }, 15_000);
  const sub = await subResp.json();

  // Get the price ID from the first subscription item
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (!priceId) {
    // Fall back to subscription metadata
    const plan = sub.metadata?.plan;
    if (plan && PLAN_ENTITLEMENTS[plan]) {
      return { plan, features: PLAN_ENTITLEMENTS[plan] };
    }
    return { plan: "unknown", features: [] };
  }

  // Fetch the price to get its metadata
  const priceResp = await fetchWithTimeout(`https://api.stripe.com/v1/prices/${priceId}`, {
    headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
  }, 15_000);
  const price = await priceResp.json();

  // Read entitlements from price metadata
  const plan = price.metadata?.plan || sub.metadata?.plan || "unknown";
  const entitlementsStr = price.metadata?.entitlements;

  if (entitlementsStr) {
    // Use metadata from the price
    return { plan, features: entitlementsStr.split(",").map((s: string) => s.trim()) };
  }

  // Fall back to plan → entitlements mapping
  if (plan && PLAN_ENTITLEMENTS[plan]) {
    return { plan, features: PLAN_ENTITLEMENTS[plan] };
  }

  return { plan, features: [] };
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

        if (!subscriptionId) {
          console.log("No subscription ID in checkout session — skipping");
          break;
        }

        // Get entitlements from the subscription's price metadata
        const { plan, features } = await getSubscriptionEntitlements(subscriptionId);
        console.log(`Checkout completed: plan=${plan}, features=${features.join(",")}, email=${email}`);

        if (features.length === 0) {
          console.error("No features resolved for plan:", plan);
          break;
        }

        // Find user by email
        const { data: profiles } = await supa.from("profiles").select("id").eq("email", email).limit(1);
        if (profiles && profiles.length > 0) {
          const userId = profiles[0].id;
          const source = subscriptionId;

          // Store stripe_customer_id on profiles
          await supa.from("profiles").update({
            stripe_customer_id: customerId,
          }).eq("id", userId);

          // Remove any existing entitlements from previous subscriptions
          // (handles plan changes — old entitlements cleared, new ones granted)
          await supa.from("user_entitlements")
            .delete()
            .eq("user_id", userId)
            .like("source", "sub_%");

          // Grant entitlements for this plan
          for (const feature of features) {
            await supa.from("user_entitlements").upsert({
              user_id: userId,
              feature,
              source,
            }, { onConflict: "user_id,feature,source" });
          }

          console.log(`Granted ${features.length} entitlements to user ${userId}`);
        } else {
          // No account yet — write to pending_subscriptions
          console.log(`No user found for ${email} — writing to pending_subscriptions`);
          await supa.from("pending_subscriptions").upsert({
            email,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan,
            entitlements: features,
          }, { onConflict: "stripe_subscription_id" });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subscriptionId = sub.id;
        const status = sub.status;

        // Handle plan changes (upgrade/downgrade)
        if (status === "active") {
          const { plan, features } = await getSubscriptionEntitlements(subscriptionId);
          console.log(`Subscription updated: plan=${plan}, features=${features.join(",")}`);

          const { data: profiles } = await supa.from("profiles").select("id").eq("stripe_customer_id", customerId).limit(1);
          if (profiles && profiles.length > 0) {
            const userId = profiles[0].id;

            // Clear old entitlements from this subscription
            await supa.from("user_entitlements")
              .delete()
              .eq("user_id", userId)
              .eq("source", subscriptionId);

            // Grant new entitlements
            for (const feature of features) {
              await supa.from("user_entitlements").upsert({
                user_id: userId,
                feature,
                source: subscriptionId,
              }, { onConflict: "user_id,feature,source" });
            }

            console.log(`Updated entitlements for user ${userId}: ${features.join(",")}`);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subscriptionId = sub.id;

        console.log(`Subscription deleted: ${subscriptionId}`);

        // Find user by stripe_customer_id
        const { data: profiles } = await supa.from("profiles").select("id").eq("stripe_customer_id", customerId).limit(1);
        if (profiles && profiles.length > 0) {
          // Remove all entitlements granted by this subscription
          await supa.from("user_entitlements")
            .delete()
            .eq("user_id", profiles[0].id)
            .eq("source", subscriptionId);

          console.log(`Removed entitlements for user ${profiles[0].id}`);
        }
        break;
      }

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
