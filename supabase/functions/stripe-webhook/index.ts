import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { raiseEngineMonthsFromGrant } from "../_shared/engine-months-drip.ts";
import { ALERT_EMAIL, buildCancelScheduledEmail, buildCancelUnscheduledEmail, buildGoodbyeEmail, buildRecoveryEmail, emailWrap, escapeHtml, logEmailSend, sendViaResend, unsubscribeUrl } from "../_shared/checkout-emails.ts";

// ── Billing-events ledger (capture item A) ──────────────────────────────────
// Append-only record of billing lifecycle moments; best-effort — a ledger
// write must never fail the webhook's real work.

interface BillingEventRow {
  user_id?: string | null;
  email?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  event_type: "purchased" | "canceled" | "payment_churn" | "payment_failed" | "refunded" | "dispute" | "plan_changed" | "cancel_scheduled" | "cancel_unscheduled";
  plan?: string | null;
  currency?: string | null;
  amount_cents?: number | null;
  tenure_days?: number | null;
  // deno-lint-ignore no-explicit-any
  details?: Record<string, any>;
}

// deno-lint-ignore no-explicit-any
async function recordBillingEvent(supa: any, row: BillingEventRow): Promise<void> {
  try {
    await supa.from("billing_events").insert({ details: {}, ...row });
  } catch (e) {
    console.error("[webhook] billing_events insert failed:", e);
  }
}

/** Resolve (user_id, email) from a Stripe customer id, best-effort. */
// deno-lint-ignore no-explicit-any
async function resolveByCustomer(supa: any, customerId: string | null): Promise<{ user_id: string | null; email: string | null }> {
  if (!customerId) return { user_id: null, email: null };
  const { data } = await supa.from("profiles").select("id, email").eq("stripe_customer_id", customerId).limit(1);
  return data && data.length > 0
    ? { user_id: data[0].id, email: data[0].email }
    : { user_id: null, email: null };
}

/** One-line founder alert (billing events he'd want same-day). Best-effort. */
async function alertFounder(subject: string, lines: string[]): Promise<void> {
  try {
    await sendViaResend(ALERT_EMAIL, subject, emailWrap(lines.map((l) => `<p>${l}</p>`).join("")));
  } catch (e) {
    console.error("[webhook] founder alert failed:", e);
  }
}

// ── Churn-alert dossier ─────────────────────────────────────────────────────
// A bare "subscription went unpaid for cus_xxx" tells the founder nothing.
// These helpers assemble who / plan+products / subscribed+tenure / admin link
// from data already on hand (profiles row, entitlement rows captured before
// revocation, sub.created off the event payload — accurate for every
// subscription regardless of our ledger's age). No extra Stripe calls.

const ADMIN_BASE_URL = "https://www.thegainslab.com";

/** "14 months" / "23 days" from a Stripe sub.created unix timestamp. */
function tenureLabel(subCreatedSec: number | null | undefined): string | null {
  if (typeof subCreatedSec !== "number" || !isFinite(subCreatedSec)) return null;
  const days = Math.max(0, (Date.now() / 1000 - subCreatedSec) / 86400);
  if (days < 60) return `${Math.round(days)} days`;
  return `${Math.round(days / 30.4)} months`;
}

function churnDossierLines(opts: {
  name: string | null;
  email: string | null;
  userId: string | null;
  plan: string | null;
  features: string[];
  subCreatedSec: number | null;
}): string[] {
  const lines: string[] = [];
  const who = opts.name
    ? `<strong>${escapeHtml(opts.name)}</strong> (${escapeHtml(opts.email ?? "no email")})`
    : `<strong>${escapeHtml(opts.email ?? "unknown user")}</strong>`;
  lines.push(who);
  lines.push(
    `Plan: <strong>${escapeHtml(opts.plan ?? "unknown")}</strong>` +
      (opts.features.length > 0
        ? ` — products: ${escapeHtml(opts.features.map((f) => f.replace(/_/g, " ")).join(", "))}`
        : ""),
  );
  if (typeof opts.subCreatedSec === "number" && isFinite(opts.subCreatedSec)) {
    const since = new Date(opts.subCreatedSec * 1000).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
    const tenure = tenureLabel(opts.subCreatedSec);
    lines.push(`Subscribed: ${since}${tenure ? ` (${tenure})` : ""}`);
  }
  if (opts.userId) {
    lines.push(`<a href="${ADMIN_BASE_URL}/admin/users/${opts.userId}">Open in admin</a> — timeline, entitlements, and the email composer for a win-back note.`);
  } else {
    lines.push("No matching app account found for this Stripe customer.");
  }
  return lines;
}

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

        // Checkout breadcrumb: mark the attempt recorded by create-checkout as
        // completed (and backfill email for account-less checkouts). Best-effort;
        // never blocks entitlement granting.
        try {
          await supa
            .from("checkout_attempts")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              ...(email ? { email } : {}),
            })
            .eq("stripe_session_id", session.id);
        } catch (e) {
          console.error("[webhook] failed to mark checkout attempt completed:", e);
        }

        // Ledger: the purchase, WITH the currency it actually billed in —
        // the multi-currency rollout's scoreboard.
        await recordBillingEvent(supa, {
          user_id: session.metadata?.user_id ?? null, email,
          stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
          event_type: "purchased",
          plan: session.metadata?.plan ?? null,
          currency: session.currency ?? null,
          amount_cents: session.amount_total ?? null,
        });

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

          // Backfill the checkout breadcrumb's user_id for account-less
          // checkouts (create-checkout had no auth header to resolve one).
          await supa
            .from("checkout_attempts")
            .update({ user_id: userId })
            .eq("stripe_session_id", session.id)
            .is("user_id", null);

          // Store stripe_customer_id on profiles
          await supa.from("profiles").update({
            stripe_customer_id: customerId,
          }).eq("id", userId);

          // Remove any existing entitlements from PREVIOUS subscriptions
          // (handles plan changes — old entitlements cleared, new ones granted).
          // THIS subscription's rows are kept so a webhook retry can't reset
          // their granted_at.
          await supa.from("user_entitlements")
            .delete()
            .eq("user_id", userId)
            .like("source", "sub_%")
            .neq("source", subscriptionId);

          // Grant entitlements for this plan. ignoreDuplicates: an existing
          // row keeps its original granted_at (webhook retries must not
          // re-stamp the grant date).
          for (const feature of features) {
            await supa.from("user_entitlements").upsert({
              user_id: userId,
              feature,
              source,
            }, { onConflict: "user_id,feature,source", ignoreDuplicates: true });
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

      case "checkout.session.expired": {
        // Abandonment made explicit: the session opened 24h ago and was never
        // paid. Mark the breadcrumb, then send ONE recovery email per identity
        // per 7 days (an abandoner usually leaves several sessions behind —
        // mrs.hart1122 left six). All best-effort; a failure here must never
        // 4xx back to Stripe.
        const session = event.data.object;
        try {
          const { data: attempt } = await supa
            .from("checkout_attempts")
            .update({ status: "expired", expired_at: new Date().toISOString() })
            .eq("stripe_session_id", session.id)
            .neq("status", "completed")
            .select("user_id, email, plan")
            .maybeSingle();

          const plan = attempt?.plan ?? session.metadata?.plan ?? null;
          const userId = attempt?.user_id ?? session.metadata?.user_id ?? null;
          const to = attempt?.email ?? session.customer_email ?? session.customer_details?.email ?? null;
          if (!to || !plan) break;

          // Identity = user_id when known, else the email create-checkout saw.
          const identity = (q: any) => (userId ? q.eq("user_id", userId) : q.eq("email", to));

          // Already a customer? Two checks: a completed checkout for this
          // identity (bought via a later session while this one aged out), OR
          // any live entitlement (checkout_attempts only records sessions
          // since July '26 — long-time subscribers have no completed row, and
          // one browsing an upgrade must not get a win-a-prospect email).
          const { count: completedCount } = await identity(
            supa.from("checkout_attempts")
              .select("id", { count: "exact", head: true })
              .eq("status", "completed"),
          );
          if ((completedCount ?? 0) > 0) break;
          if (userId) {
            const { count: entitled } = await supa
              .from("user_entitlements")
              .select("user_id", { count: "exact", head: true })
              .eq("user_id", userId);
            if ((entitled ?? 0) > 0) break;
          }

          // Dedup: another expired attempt in the last 7 days already carried
          // the recovery email (their sessions expire minutes apart; the first
          // one processed wins).
          const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
          const { count: priorExpired } = await identity(
            supa.from("checkout_attempts")
              .select("id", { count: "exact", head: true })
              .eq("status", "expired")
              .gte("expired_at", since)
              .neq("stripe_session_id", session.id),
          );
          if ((priorExpired ?? 0) > 0) break;

          // Honor the unsubscribe flag (recovery is commercial email too).
          if (userId) {
            const { data: prof } = await supa
              .from("profiles").select("email_opt_out").eq("id", userId).maybeSingle();
            if (prof?.email_opt_out) break;
          }

          const { subject, html } = buildRecoveryEmail(plan, await unsubscribeUrl(userId));
          const messageId = await sendViaResend(to, subject, html);
          await logEmailSend(supa, userId, "checkout_recovery", subject, messageId);
          console.log(`[webhook] recovery email ${messageId ? "sent" : "FAILED"} to ${to} (plan=${plan})`);
        } catch (e) {
          console.error("[webhook] checkout.session.expired handling failed:", e);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const subscriptionId = sub.id;
        const status = sub.status;

        // ── Cancellation intent: cancel_at_period_end flipped ──────────────
        // The earliest churn signal there is (weeks of warning). Guarded on
        // previous_attributes so it fires exactly once per flip — incidental
        // updates on a scheduled-cancel sub never re-alert (the zombie
        // lesson). Both directions: true = scheduled, false = a save.
        const prevAttrs = event.data.previous_attributes ?? {};
        if ("cancel_at_period_end" in prevAttrs && prevAttrs.cancel_at_period_end !== sub.cancel_at_period_end) {
          const scheduled = sub.cancel_at_period_end === true;
          const { data: cWho } = await supa.from("profiles").select("id, email, full_name").eq("stripe_customer_id", customerId).limit(1);
          const cw = cWho?.[0] ?? null;
          const cPlan = sub.metadata?.plan ?? sub.items?.data?.[0]?.price?.metadata?.plan ?? null;
          const lapseSec = (sub.cancel_at as number | null) ?? (sub.current_period_end as number | null) ?? null;
          const feedback = sub.cancellation_details?.feedback ?? null;
          const comment = sub.cancellation_details?.comment ?? null;

          await recordBillingEvent(supa, {
            user_id: cw?.id ?? null, email: cw?.email ?? null,
            stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
            event_type: scheduled ? "cancel_scheduled" : "cancel_unscheduled",
            plan: cPlan,
            currency: sub.currency ?? null,
            tenure_days: sub.created ? Math.round((Date.now() / 1000 - sub.created) / 86400) : null,
            details: { cancel_at: lapseSec, feedback, comment },
          });

          // Founder alert with the dossier + lapse date + any exit feedback.
          let cFeatures: string[] = [];
          if (cw) {
            const { data: ents } = await supa
              .from("user_entitlements").select("feature")
              .eq("user_id", cw.id).eq("source", subscriptionId);
            cFeatures = (ents ?? []).map((e: { feature: string }) => e.feature);
          }
          const cTenure = tenureLabel(sub.created ?? null);
          const lapseStr = lapseSec ? new Date(lapseSec * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null;
          if (scheduled) {
            await alertFounder(
              `Cancellation scheduled: ${cw?.full_name ?? cw?.email ?? customerId}${cPlan ? ` — ${cPlan}` : ""}${cTenure ? `, ${cTenure} in` : ""}${lapseStr ? `, lapses ${lapseStr}` : ""}`,
              [
                `Set to cancel${lapseStr ? ` on <strong>${lapseStr}</strong>` : " at period end"} — access continues until then. This is the save window.`,
                ...churnDossierLines({
                  name: cw?.full_name ?? null, email: cw?.email ?? null, userId: cw?.id ?? null,
                  plan: cPlan, features: cFeatures, subCreatedSec: sub.created ?? null,
                }),
                feedback ? `Stripe exit feedback: <strong>${escapeHtml(String(feedback))}</strong>${comment ? ` — "${escapeHtml(String(comment))}"` : ""}` : "No exit feedback captured.",
              ],
            );
          } else {
            await alertFounder(
              `Cancellation removed: ${cw?.full_name ?? cw?.email ?? customerId}${cPlan ? ` — ${cPlan}` : ""}`,
              [
                `They un-scheduled their cancellation — a confirmed save. Subscription continues as normal.`,
                ...churnDossierLines({
                  name: cw?.full_name ?? null, email: cw?.email ?? null, userId: cw?.id ?? null,
                  plan: cPlan, features: cFeatures, subCreatedSec: sub.created ?? null,
                }),
              ],
            );
          }

          // Customer confirmation (transactional; logged for timeline/opens).
          if (cw?.email) {
            const mail = scheduled
              ? buildCancelScheduledEmail({ fullName: cw.full_name ?? null, plan: cPlan, lapseSec })
              : buildCancelUnscheduledEmail({ fullName: cw.full_name ?? null });
            const msgId = await sendViaResend(cw.email, mail.subject, mail.html);
            await logEmailSend(supa, cw.id, scheduled ? "cancel_scheduled_ack" : "cancel_unscheduled_ack", mail.subject, msgId);
          }
        }

        // Handle plan changes (upgrade/downgrade)
        if (status === "active") {
          const { plan, features } = await getSubscriptionEntitlements(subscriptionId);
          console.log(`Subscription updated: plan=${plan}, features=${features.join(",")}`);

          // Ledger: a price/items change on a live subscription = plan change.
          if (event.data.previous_attributes?.items) {
            const who = await resolveByCustomer(supa, customerId);
            await recordBillingEvent(supa, {
              user_id: who.user_id, email: who.email,
              stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
              event_type: "plan_changed", plan,
              currency: sub.currency ?? null,
              amount_cents: sub.items?.data?.[0]?.price?.unit_amount ?? null,
            });
          }

          // An unresolvable plan must be a no-op, never a wipe: reconciling
          // against an empty feature set would revoke everything the user paid
          // for because a metadata lookup hiccuped.
          if (features.length === 0) {
            console.error(`[webhook] subscription.updated: no features resolved for plan=${plan}; skipping entitlement reconcile`);
            break;
          }

          const { data: profiles } = await supa.from("profiles").select("id").eq("stripe_customer_id", customerId).limit(1);
          if (profiles && profiles.length > 0) {
            const userId = profiles[0].id;

            // RECONCILE, don't wipe-and-rewrite. subscription.updated fires on
            // every renewal cycle; the old delete-all + re-insert reset every
            // row's granted_at monthly, so "granted" really meant "last
            // renewal" (July '26: misled three separate billing analyses).
            // Targeted delete removes only features no longer in the plan;
            // ignoreDuplicates leaves existing rows — and their original
            // granted_at — untouched. Plan changes still reconcile exactly;
            // renewals become true no-ops on the rows.
            await supa.from("user_entitlements")
              .delete()
              .eq("user_id", userId)
              .eq("source", subscriptionId)
              .not("feature", "in", `(${features.map((f) => `"${f}"`).join(",")})`);

            for (const feature of features) {
              await supa.from("user_entitlements").upsert({
                user_id: userId,
                feature,
                source: subscriptionId,
              }, { onConflict: "user_id,feature,source", ignoreDuplicates: true });
            }

          }
        } else if (["incomplete_expired", "unpaid", "canceled"].includes(status)) {
          // Terminal statuses: revoke entitlements sourced from this
          // subscription. incomplete_expired (first payment never landed) and
          // unpaid (dunning exhausted, per Stripe revenue-recovery settings)
          // arrive ONLY via this event — customer.subscription.deleted never
          // fires for them, so before this branch existed those users kept
          // access forever (July '26 ops audit). canceled normally arrives via
          // the deleted handler; handling it here too is idempotent insurance.
          // past_due is deliberately NOT revoked — Stripe is still retrying
          // the card and the subscriber is expected to recover.
          const { data: profiles } = await supa.from("profiles").select("id, email, full_name").eq("stripe_customer_id", customerId).limit(1);
          // Capture the products BEFORE revocation deletes the rows — they
          // feed the churn dossier below.
          let revokedFeatures: string[] = [];
          if (profiles && profiles.length > 0) {
            const { data: ents } = await supa
              .from("user_entitlements")
              .select("feature")
              .eq("user_id", profiles[0].id)
              .eq("source", subscriptionId);
            revokedFeatures = (ents ?? []).map((e: { feature: string }) => e.feature);
            console.log(`[webhook] Subscription ${subscriptionId} → ${status}; revoking its entitlements for user ${profiles[0].id}`);
            await supa.from("user_entitlements")
              .delete()
              .eq("user_id", profiles[0].id)
              .eq("source", subscriptionId);
          }

          // Ledger + alert: unpaid/incomplete_expired = INVOLUNTARY churn (the
          // card died, not the intent). 'canceled' is skipped here — the
          // deleted handler records that one.
          //
          // TRANSITION GUARD (July '26 zombie-noise incident): only when this
          // event actually MOVED the subscription to the terminal status —
          // previous_attributes carries the changed fields. Long-dead subs
          // re-emit updated events for incidental reasons (payment method
          // detached, invoice voided, revenue-recovery sweeps), and each one
          // was recorded as fresh churn + a founder email for users who
          // expired months ago. Revocation above still runs on every event
          // (idempotent cleanup); reporting only fires on the transition.
          const becameTerminal =
            typeof event.data.previous_attributes?.status === "string" &&
            event.data.previous_attributes.status !== status;
          if (status !== "canceled" && becameTerminal) {
            // Dedupe: at most one payment_churn row per subscription, so an
            // edge-case double transition can't double-count in reports.
            const { data: priorChurn } = await supa
              .from("billing_events")
              .select("id")
              .eq("stripe_subscription_id", subscriptionId)
              .eq("event_type", "payment_churn")
              .limit(1);
            if (!priorChurn || priorChurn.length === 0) {
              const plan = sub.metadata?.plan ?? sub.items?.data?.[0]?.price?.metadata?.plan ?? null;
              const tenureDays = sub.created ? Math.round((Date.now() / 1000 - sub.created) / 86400) : null;
              await recordBillingEvent(supa, {
                user_id: profiles?.[0]?.id ?? null, email: profiles?.[0]?.email ?? null,
                stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
                event_type: "payment_churn",
                plan,
                currency: sub.currency ?? null,
                tenure_days: tenureDays,
                details: { terminal_status: status, previous_status: event.data.previous_attributes.status },
              });
              const who = profiles?.[0] ?? null;
              const tenure = tenureLabel(sub.created ?? null);
              await alertFounder(
                `Involuntary churn: ${who?.full_name ?? who?.email ?? customerId}${plan ? ` — ${plan}` : ""}${tenure ? `, ${tenure}` : ""}`,
                [
                  `Subscription went <strong>${escapeHtml(status)}</strong> — payment never recovered. Access revoked.`,
                  ...churnDossierLines({
                    name: who?.full_name ?? null,
                    email: who?.email ?? null,
                    userId: who?.id ?? null,
                    plan,
                    features: revokedFeatures,
                    subCreatedSec: sub.created ?? null,
                  }),
                ],
              );

              // Customer come-back note — same email the auto-cancel path
              // sends. This branch only fires if revenue-recovery ever
              // regresses to parking subs at unpaid instead of canceling.
              if (who?.email) {
                const mail = buildGoodbyeEmail({ fullName: who.full_name ?? null, plan, involuntary: true });
                const msgId = await sendViaResend(who.email, mail.subject, mail.html);
                await logEmailSend(supa, who.id, "goodbye_involuntary", mail.subject, msgId);
              }
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

        // Find user by stripe_customer_id; capture products BEFORE the
        // revocation deletes the rows (they feed the churn dossier).
        const { data: profiles } = await supa.from("profiles").select("id, email, full_name").eq("stripe_customer_id", customerId).limit(1);
        let canceledFeatures: string[] = [];
        if (profiles && profiles.length > 0) {
          const { data: ents } = await supa
            .from("user_entitlements")
            .select("feature")
            .eq("user_id", profiles[0].id)
            .eq("source", subscriptionId);
          canceledFeatures = (ents ?? []).map((e: { feature: string }) => e.feature);
          // Remove all entitlements granted by this subscription
          await supa.from("user_entitlements")
            .delete()
            .eq("user_id", profiles[0].id)
            .eq("source", subscriptionId);

        }

        // The fork that decides everything downstream: WHY did this sub end?
        // 'payment_failed' / 'payment_disputed' = INVOLUNTARY (dunning
        // exhausted → the revenue-recovery setting auto-canceled). Everything
        // else ('cancellation_requested', missing) = voluntary. With auto-
        // cancel on, involuntary churn now arrives HERE (not via the 'unpaid'
        // status), so the ledger keeps involuntary distinct via payment_churn.
        const cancelReason = sub.cancellation_details?.reason ?? null;
        const involuntary = cancelReason === "payment_failed" || cancelReason === "payment_disputed";

        const tenureDays = sub.created ? Math.round((Date.now() / 1000 - sub.created) / 86400) : null;
        const plan = sub.metadata?.plan ?? sub.items?.data?.[0]?.price?.metadata?.plan ?? null;
        const who = profiles?.[0] ?? { id: null, email: null, full_name: null };

        // Dedupe involuntary churn (a sub that went unpaid first already has a
        // payment_churn row from the updated handler).
        let alreadyChurned = false;
        if (involuntary) {
          const { data: priorChurn } = await supa
            .from("billing_events").select("id")
            .eq("stripe_subscription_id", subscriptionId)
            .eq("event_type", "payment_churn").limit(1);
          alreadyChurned = (priorChurn?.length ?? 0) > 0;
        }
        if (!alreadyChurned) {
          await recordBillingEvent(supa, {
            user_id: who.id, email: who.email,
            stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
            event_type: involuntary ? "payment_churn" : "canceled", plan,
            currency: sub.currency ?? null,
            amount_cents: sub.items?.data?.[0]?.price?.unit_amount ?? null,
            tenure_days: tenureDays,
            details: { cancellation_reason: cancelReason, feedback: sub.cancellation_details?.feedback ?? null },
          });
        }
        const tenure = tenureLabel(sub.created ?? null);
        await alertFounder(
          `${involuntary ? "Involuntary churn (card failed)" : "Cancellation"}: ${who.full_name ?? who.email ?? customerId} (${plan ?? "unknown plan"}${tenure ? `, ${tenure}` : ""})`,
          [
            involuntary
              ? `Dunning exhausted — the subscription auto-canceled after all retries failed. Access revoked; they've been emailed the come-back note.`
              : `Canceled <strong>${escapeHtml(plan ?? "unknown plan")}</strong> as scheduled.`,
            ...churnDossierLines({
              name: who.full_name ?? null,
              email: who.email ?? null,
              userId: who.id ?? null,
              plan,
              features: canceledFeatures,
              subCreatedSec: sub.created ?? null,
            }),
            sub.cancellation_details?.feedback ? `Stripe exit feedback: ${escapeHtml(String(sub.cancellation_details.feedback))}` : "No exit feedback captured.",
          ],
        );

        // Customer goodbye — voluntary gets the graceful close, involuntary
        // gets the automated come-back-anytime card note. Logged for timeline
        // visibility and open tracking.
        if (who.email) {
          const mail = buildGoodbyeEmail({ fullName: who.full_name ?? null, plan, involuntary });
          const msgId = await sendViaResend(who.email, mail.subject, mail.html);
          await logEmailSend(supa, who.id, involuntary ? "goodbye_involuntary" : "goodbye_voluntary", mail.subject, msgId);
        }
        break;
      }

      case "invoice.payment_failed": {
        // Involuntary churn starts here — previously invisible until
        // entitlements were revoked days later.
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const who = await resolveByCustomer(supa, invoice.customer);
        await recordBillingEvent(supa, {
          user_id: who.user_id, email: who.email ?? invoice.customer_email ?? null,
          stripe_customer_id: invoice.customer, stripe_subscription_id: invoice.subscription,
          event_type: "payment_failed",
          currency: invoice.currency ?? null,
          amount_cents: invoice.amount_due ?? null,
          details: { attempt_count: invoice.attempt_count ?? null, next_attempt: invoice.next_payment_attempt ?? null },
        });
        // Alert on the FIRST failure only — Stripe's retries handle the rest.
        if ((invoice.attempt_count ?? 1) === 1) {
          await alertFounder(
            `Payment failed: ${who.email ?? invoice.customer_email ?? invoice.customer}`,
            [
              `Renewal payment failed for <strong>${escapeHtml(who.email ?? invoice.customer_email ?? String(invoice.customer))}</strong> (${((invoice.amount_due ?? 0) / 100).toFixed(2)} ${String(invoice.currency ?? "usd").toUpperCase()}).`,
              `Stripe will retry per your revenue-recovery settings${invoice.next_payment_attempt ? "; next attempt is scheduled" : ""}. If dunning emails are enabled, the customer has been notified.`,
            ],
          );
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object;
        // The dispute object has no customer field — it lives on the charge.
        let disputeCustomer: string | null = null;
        if (dispute.charge) {
          try {
            const r = await fetchWithTimeout(`https://api.stripe.com/v1/charges/${dispute.charge}`, {
              headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
            }, 15_000);
            if (r.ok) disputeCustomer = (await r.json())?.customer ?? null;
          } catch { /* record without customer */ }
        }
        const who = await resolveByCustomer(supa, disputeCustomer);
        await recordBillingEvent(supa, {
          user_id: who.user_id, email: who.email,
          stripe_customer_id: disputeCustomer,
          event_type: "dispute",
          currency: dispute.currency ?? null,
          amount_cents: dispute.amount ?? null,
          details: { reason: dispute.reason ?? null, status: dispute.status ?? null, charge: dispute.charge ?? null },
        });
        await alertFounder(
          `⚠️ Chargeback opened: ${who.email ?? "unknown customer"}`,
          [
            `A dispute was opened for ${((dispute.amount ?? 0) / 100).toFixed(2)} ${String(dispute.currency ?? "usd").toUpperCase()} (reason: ${escapeHtml(dispute.reason ?? "unknown")}).`,
            `Respond in the Stripe dashboard — disputes have deadlines.`,
          ],
        );
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

        // Ledger + alert (refunds were previously only a log line).
        const { data: refundProfile } = await supa.from("profiles").select("email").eq("id", refundUserId).maybeSingle();
        await recordBillingEvent(supa, {
          user_id: refundUserId, email: refundProfile?.email ?? null,
          stripe_customer_id: customerId,
          event_type: "refunded",
          currency: charge.currency ?? null,
          amount_cents: charge.amount_refunded ?? null,
          details: { charge: charge.id },
        });
        await alertFounder(
          `Refund: ${refundProfile?.email ?? customerId}`,
          [`Refunded ${((charge.amount_refunded ?? 0) / 100).toFixed(2)} ${String(charge.currency ?? "usd").toUpperCase()} to <strong>${escapeHtml(refundProfile?.email ?? String(customerId))}</strong>.`],
        );

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
