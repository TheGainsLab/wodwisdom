import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { raiseEngineMonthsFromGrant } from "../_shared/engine-months-drip.ts";

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
  if (!subResp.ok) {
    console.error("Failed to fetch subscription from Stripe:", subResp.status);
    return { plan: "unknown", features: [] };
  }
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
  if (!priceResp.ok) {
    console.error("Failed to fetch price from Stripe:", priceResp.status);
    // Fall back to subscription metadata
    const plan = sub.metadata?.plan;
    return { plan: plan || "unknown", features: plan && PLAN_ENTITLEMENTS[plan] ? PLAN_ENTITLEMENTS[plan] : [] };
  }
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

// Resolve a feature list from price/subscription metadata. `entitlements` (a
// comma list) wins; otherwise the `plan` name maps through PLAN_ENTITLEMENTS.
function featuresFromMetadata(meta: Record<string, string> | undefined | null): string[] {
  if (!meta) return [];
  if (meta.entitlements) return meta.entitlements.split(",").map(s => s.trim()).filter(Boolean);
  if (meta.plan && PLAN_ENTITLEMENTS[meta.plan]) return PLAN_ENTITLEMENTS[meta.plan];
  return [];
}

// Features a single invoice line grants, resolved from its price metadata.
// Uses the price object embedded in the event when it carries metadata; falls
// back to fetching the price by id otherwise.
// deno-lint-ignore no-explicit-any
async function priceFeatures(price: any): Promise<string[]> {
  const embedded = featuresFromMetadata(price?.metadata);
  if (embedded.length) return embedded;
  const id = price?.id;
  if (!id) return [];
  try {
    const r = await fetchWithTimeout(`https://api.stripe.com/v1/prices/${id}`, {
      headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
    }, 15_000);
    if (r.ok) {
      const p = await r.json();
      return featuresFromMetadata(p?.metadata);
    }
  } catch { /* fall through to empty */ }
  return [];
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
          break;
        }

        // Get entitlements from the subscription's price metadata
        const { plan, features } = await getSubscriptionEntitlements(subscriptionId);

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

          // Seed Engine month 1 at grant time (mirrors the gym-grant path).
          // The invoice.payment_succeeded +1 races this handler — it looks
          // the user up by stripe_customer_id, which is only stored HERE —
          // and historically dropped first months (July '26 engine audit:
          // 8 paying subscribers at 0 months, fully locked catalog). Only-
          // raise, so an invoice event that did land first is untouched.
          if (features.includes("engine")) {
            const nowIso = new Date().toISOString();
            const seed = await raiseEngineMonthsFromGrant(supa, userId, nowIso, nowIso);
            if (seed.error) console.error("[webhook] engine month-1 seed failed:", seed.error);
          }

        } else {
          // No account yet — write to pending_subscriptions
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

          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subscriptionId = sub.id;

        // Subscription cancelled — remove entitlements

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

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;

        // Skip if not a subscription invoice (e.g. one-time charges)
        if (!subscriptionId) break;

        // Handle every successful subscription payment — initial and renewals
        // alike. engine_months_unlocked is raised here as the single source of
        // truth for Engine content access.
        console.log(`[webhook] Subscription payment: customer=${customerId}, subscription=${subscriptionId}, billing_reason=${invoice.billing_reason}`);

        // Find user — by stripe_customer_id, then by the Stripe customer's
        // email. The customer id is only written by checkout.session.completed,
        // and Stripe does not order invoice.payment_succeeded after it: on a
        // first payment this lookup historically found nobody and the unlock/
        // generation was silently dropped (July '26 engine audit). The email
        // fallback closes the race for users with accounts (and backfills the
        // customer id); account-less checkouts flow through
        // pending_subscriptions and are trued up by the daily reconcilers.
        let payUserId: string | null = null;
        const { data: payProfiles } = await supa.from("profiles").select("id").eq("stripe_customer_id", customerId).limit(1);
        if (payProfiles && payProfiles.length > 0) {
          payUserId = payProfiles[0].id;
        } else {
          try {
            const custResp = await fetchWithTimeout(`https://api.stripe.com/v1/customers/${customerId}`, {
              headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
            }, 15_000);
            if (custResp.ok) {
              const cust = await custResp.json();
              if (cust?.email) {
                const { data: byEmail } = await supa.from("profiles").select("id").eq("email", cust.email).limit(1);
                if (byEmail && byEmail.length > 0) {
                  payUserId = byEmail[0].id;
                  await supa.from("profiles").update({ stripe_customer_id: customerId }).eq("id", payUserId);
                  console.log(`[webhook] invoice ${invoice.id}: matched user by email fallback, backfilled stripe_customer_id`);
                }
              }
            }
          } catch { /* fall through to break */ }
        }
        if (!payUserId) {
          console.warn(`[webhook] invoice ${invoice.id}: no user found for customer ${customerId} (by id or email) — relying on daily reconcilers`);
          break;
        }

        // Check what entitlements the user has
        const { data: payEntitlements } = await supa
          .from("user_entitlements")
          .select("feature")
          .eq("user_id", payUserId)
          .or("expires_at.is.null,expires_at.gt." + new Date().toISOString());

        const payFeatures = new Set((payEntitlements || []).map(e => e.feature));

        // Which products did THIS invoice bill for a NEW period? Skip proration
        // lines (mid-cycle add / upgrade / downgrade) — those are the same month,
        // not a new one, so a subscription update can't tick a drip forward. Each
        // real line resolves to its features via the price metadata, so a payment
        // for one product never advances another (separate purchases stay
        // independent). All Access bills as a single price whose metadata lists
        // every feature, so its one line advances both branches — as intended.
        const billedFeatures = new Set<string>();
        let sawRealLine = false;
        for (const line of (invoice.lines?.data ?? [])) {
          if (line.proration) continue;
          sawRealLine = true;
          for (const f of await priceFeatures(line.price)) billedFeatures.add(f);
        }
        // Safety net: a real line existed but no features resolved (price missing
        // metadata) — fall back to stored entitlements so delivery never silently
        // stops, and log loudly so the misconfiguration is visible.
        let advance = billedFeatures;
        if (billedFeatures.size === 0 && sawRealLine) {
          console.warn(`[webhook] invoice ${invoice.id}: no features resolved from line metadata; falling back to stored entitlements`);
          advance = payFeatures;
        }
        console.log(`[webhook] invoice ${invoice.id} billing_reason=${invoice.billing_reason} advancing=[${[...advance].join(",")}]`);

        // Programming users: trigger next month generation
        if (advance.has("programming")) {
          // Find the user's most recent generated program
          const { data: programs } = await supa
            .from("programs")
            .select("id, generated_months")
            .eq("user_id", payUserId)
            .eq("source", "generated")
            .order("created_at", { ascending: false })
            .limit(1);

          if (programs && programs.length > 0) {
            const program = programs[0];
            const nextMonth = (program.generated_months || 1) + 1;
            console.log(`[webhook] Triggering month ${nextMonth} generation for program ${program.id}`);

            // Call generate-next-month using service role (no user token needed)
            const genUrl = `${SUPABASE_URL}/functions/v1/generate-next-month`;
            try {
              await fetchWithTimeout(genUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
                  "x-webhook-user-id": payUserId,
                },
                body: JSON.stringify({ program_id: program.id, user_id: payUserId }),
              }, 30_000);
            } catch (e) {
              console.error("[webhook] Failed to trigger program generation:", e);
            }
          }
        }

        // Engine users: unlock next month (capped at 36). Also creates the
        // athlete_profiles row if it doesn't exist yet — an Engine subscriber
        // who pays before picking a program still gets their first month.
        if (advance.has("engine")) {
          const { data: athleteProfile } = await supa
            .from("athlete_profiles")
            .select("engine_months_unlocked")
            .eq("user_id", payUserId)
            .maybeSingle();

          const currentUnlocked = athleteProfile?.engine_months_unlocked ?? 0;
          const newUnlocked = Math.min(currentUnlocked + 1, 36);
          if (newUnlocked > currentUnlocked) {
            console.log(`[webhook] Unlocking engine month ${newUnlocked} for user ${payUserId}`);
            await supa
              .from("athlete_profiles")
              .upsert(
                {
                  user_id: payUserId,
                  engine_months_unlocked: newUnlocked,
                  engine_months_unlocked_last_at: new Date().toISOString(),
                },
                { onConflict: "user_id" }
              );
          } else {
            console.log(`[webhook] Engine months at cap (36) for user ${payUserId} — no increment`);
          }
        }

        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const customerId = charge.customer;
        if (!customerId) break;

        // Look up the user by their Stripe customer id.
        const { data: refundProfiles } = await supa
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .limit(1);
        if (!refundProfiles || refundProfiles.length === 0) break;
        const refundUserId = refundProfiles[0].id;

        console.log(`[webhook] Refund: customer=${customerId}, user=${refundUserId}, charge=${charge.id}, amount_refunded=${charge.amount_refunded}`);

        // Only decrement if the user currently has an active Engine
        // entitlement. Refund-after-cancel cases: the entitlement is already
        // gone, access is already revoked, so a no-op is correct here. Admin
        // override handles edge cases per product decision.
        const { data: refundEntitlements } = await supa
          .from("user_entitlements")
          .select("feature")
          .eq("user_id", refundUserId)
          .eq("feature", "engine")
          .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
          .limit(1);
        if (!refundEntitlements || refundEntitlements.length === 0) break;

        // Decrement engine_months_unlocked by 1, floored at 0.
        const { data: refundAthleteProfile } = await supa
          .from("athlete_profiles")
          .select("engine_months_unlocked")
          .eq("user_id", refundUserId)
          .maybeSingle();
        if (!refundAthleteProfile) break;

        const refundCurrent = refundAthleteProfile.engine_months_unlocked ?? 0;
        const refundNew = Math.max(refundCurrent - 1, 0);
        if (refundNew < refundCurrent) {
          console.log(`[webhook] Refund: engine months ${refundCurrent} -> ${refundNew} for user ${refundUserId}`);
          await supa
            .from("athlete_profiles")
            .update({ engine_months_unlocked: refundNew })
            .eq("user_id", refundUserId);
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
    console.error("Webhook error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
  }
});
