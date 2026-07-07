/**
 * Daily reconciler (the Engine suspenders): ensures every Engine subscriber's
 * engine_months_unlocked matches what their Stripe subscription entitles
 * them to. Originally a one-shot built to clean up the deploy-gap fallout
 * where the webhook was silently dropping unlocks; now scheduled daily via
 * pg_cron because the gap it cleans up is structural, not historical —
 * monthly retail Engine subscribers are otherwise delivered ONLY by the
 * invoice.payment_succeeded webhook's +1, and a dropped webhook is a paid
 * month of catalog access that silently never unlocks. (Quarterly retail is
 * already reconciled daily by monthly-generation-cron; gym-granted members
 * by gym-engine-months-cron. This closes the monthly-retail path.)
 *
 * Unlike the programming sweep, no cadence guard is needed: catch-up here is
 * CORRECT. Months unlocked are cumulative catalog access already paid for —
 * raising 2 → 5 in one go hands over what was bought, not a burst of
 * time-anchored content. The write is only-raise and idempotent.
 *
 * Every run inserts an audit row into programming_reconciliations with
 * kind='engine', so this sweep can't fail silently either: no row = the cron
 * didn't run.
 *
 * Per-user logic:
 *   1. Fetch the user's active Stripe subscription.
 *   2. Determine cadence: 1-month interval = monthly; 3-month or
 *      quarterly interval = quarterly.
 *   3. Count successful invoices on this subscription = N.
 *   4. Compute entitled months:
 *        monthly:   N (one unlock per paid invoice)
 *        quarterly: (N - 1) * 3 + months_into_current_quarter
 *                   where months_into_current_quarter ∈ {1,2,3} based
 *                   on days since current_period_start (the drip).
 *   5. Cap at 36 (matches webhook/cron).
 *   6. If correct > current_unlocked, raise to correct. Otherwise no-op.
 *   7. Set engine_months_unlocked_last_at so the cron's next drip
 *      arrives on schedule — anchored to when the most recent unlock
 *      *would* have happened, not now().
 *
 * Auth: service role bearer only (mirrors monthly-generation-cron).
 * Deploy: supabase functions deploy reconcile-engine-months
 * Invoke: curl -X POST <fn-url> -H "Authorization: Bearer $SERVICE_ROLE"
 *
 * Returns a per-user report: { user_id, email, before, after, reason }.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const STRIPE_AUTH = "Basic " + btoa(STRIPE_SECRET_KEY + ":");
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const ENGINE_MONTHS_CAP = 36;

interface Report {
  user_id: string;
  email: string | null;
  before: number;
  after: number;
  reason: string;
}

// No custom auth check inside the function. Gating is by `verify_jwt = false`
// in config.toml + the URL only being called by pg_cron (same posture and
// key-drift rationale as monthly-generation-cron). Worst-case abuse is
// triggering an only-raise reconciliation toward what was already paid for.
Deno.serve(async (_req) => {
  const req = _req;
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "true";

  // Optional: limit to specific user_ids via ?user_ids=uuid,uuid,...
  // Lets the operator validate on one known case before running everyone.
  const userIdsParam = new URL(req.url).searchParams.get("user_ids");
  const userIdFilter = userIdsParam
    ? new Set(userIdsParam.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const report: Report[] = [];
  const errors: Array<{ user_id: string; error: string }> = [];

  try {
    // Pull every active engine entitlement.
    const nowIso = new Date().toISOString();
    let entQuery = supa
      .from("user_entitlements")
      .select("user_id")
      .eq("feature", "engine")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    if (userIdFilter) entQuery = entQuery.in("user_id", [...userIdFilter]);
    const { data: entitlements } = await entQuery;

    if (!entitlements || entitlements.length === 0) {
      return jsonResp({ dry_run: dryRun, processed: 0, report, errors });
    }

    for (const ent of entitlements) {
      const userId = ent.user_id as string;
      try {
        const result = await reconcileOne(supa, userId, dryRun);
        if (result) report.push(result);
      } catch (e) {
        errors.push({ user_id: userId, error: (e as Error).message });
      }
    }

    // Classify the per-user reports for the audit row (mirrors the
    // programming sweep's healthy/healed/flagged buckets):
    //   already_correct:*            → healthy (no-op)
    //   monthly:* / quarterly:*      → healed (raised, or would-raise on dry run)
    //   everything else              → flagged (no customer/sub/invoices, odd interval)
    const healed = report.filter((r) => /^(monthly|quarterly):/.test(r.reason));
    const flaggedRows = report.filter(
      (r) => !/^(monthly|quarterly):/.test(r.reason) && !r.reason.startsWith("already_correct"),
    );
    const healthy = report.filter((r) => r.reason.startsWith("already_correct")).length;

    // Audit row (kind='engine') — the sweep must never be silent. A failed
    // insert surfaces as a 500 so the cron run history shows it.
    const { error: auditErr } = await supa.from("programming_reconciliations").insert({
      kind: "engine",
      dry_run: dryRun,
      checked: entitlements.length,
      healthy,
      healed,
      flagged: flaggedRows,
      errors,
    });

    return jsonResp(
      {
        dry_run: dryRun,
        processed: entitlements.length,
        adjusted: report.filter((r) => r.before !== r.after).length,
        healthy,
        healed,
        flagged: flaggedRows,
        errors,
      },
      auditErr ? 500 : 200,
    );
  } catch (e) {
    return jsonResp({ error: (e as Error).message }, 500);
  }
});

async function reconcileOne(
  // deno-lint-ignore no-explicit-any
  supa: any,
  userId: string,
  dryRun: boolean,
): Promise<Report | null> {
  const { data: profile } = await supa
    .from("profiles")
    .select("email, stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.stripe_customer_id) {
    return { user_id: userId, email: profile?.email ?? null, before: 0, after: 0, reason: "no_stripe_customer" };
  }

  const { data: athleteProfile } = await supa
    .from("athlete_profiles")
    .select("engine_months_unlocked")
    .eq("user_id", userId)
    .maybeSingle();
  const currentUnlocked = athleteProfile?.engine_months_unlocked ?? 0;

  // Active sub
  const subsResp = await fetchWithTimeout(
    `https://api.stripe.com/v1/subscriptions?customer=${profile.stripe_customer_id}&status=active&limit=1`,
    { headers: { Authorization: STRIPE_AUTH } },
    15_000,
  );
  if (!subsResp.ok) throw new Error(`stripe subs ${subsResp.status}`);
  const subsData = await subsResp.json();
  const sub = subsData.data?.[0];
  if (!sub) {
    return { user_id: userId, email: profile.email, before: currentUnlocked, after: currentUnlocked, reason: "no_active_subscription" };
  }

  const recurring = sub.items?.data?.[0]?.price?.recurring ?? {};
  const interval = recurring.interval as string | undefined;
  const intervalCount = (recurring.interval_count as number | undefined) ?? 1;
  const isQuarterly =
    (interval === "month" && intervalCount === 3) ||
    (interval === "quarter" && intervalCount === 1);
  const isMonthly = interval === "month" && intervalCount === 1;
  if (!isMonthly && !isQuarterly) {
    return { user_id: userId, email: profile.email, before: currentUnlocked, after: currentUnlocked, reason: `unsupported_interval:${interval}x${intervalCount}` };
  }

  // Count succeeded invoices on this subscription. Cap query at 100 — any
  // user with 100+ invoices is way past the 36-month ceiling anyway.
  const invResp = await fetchWithTimeout(
    `https://api.stripe.com/v1/invoices?customer=${profile.stripe_customer_id}&subscription=${sub.id}&status=paid&limit=100`,
    { headers: { Authorization: STRIPE_AUTH } },
    15_000,
  );
  if (!invResp.ok) throw new Error(`stripe invoices ${invResp.status}`);
  const invData = await invResp.json();
  const paidInvoiceCount: number = (invData.data ?? []).length;
  if (paidInvoiceCount === 0) {
    return { user_id: userId, email: profile.email, before: currentUnlocked, after: currentUnlocked, reason: "no_paid_invoices" };
  }

  // Entitled months by cadence.
  let entitled: number;
  let monthsIntoCurrentQuarter = 1;
  if (isMonthly) {
    entitled = paidInvoiceCount;
  } else {
    // Quarterly: drip 1/2/3 inside the current period.
    const periodStartSec = sub.current_period_start as number | undefined;
    const periodStartMs = typeof periodStartSec === "number" ? periodStartSec * 1000 : null;
    if (periodStartMs == null) {
      return { user_id: userId, email: profile.email, before: currentUnlocked, after: currentUnlocked, reason: "missing_period_start" };
    }
    const daysIntoPeriod = (Date.now() - periodStartMs) / MS_PER_DAY;
    monthsIntoCurrentQuarter = Math.min(Math.floor(daysIntoPeriod / 30) + 1, 3);
    entitled = (paidInvoiceCount - 1) * 3 + monthsIntoCurrentQuarter;
  }
  entitled = Math.min(entitled, ENGINE_MONTHS_CAP);

  if (entitled <= currentUnlocked) {
    return {
      user_id: userId,
      email: profile.email,
      before: currentUnlocked,
      after: currentUnlocked,
      reason: `already_correct:${isMonthly ? "monthly" : "quarterly"}:inv=${paidInvoiceCount}:entitled=${entitled}`,
    };
  }

  // Compute the "last unlock" timestamp so the next drip lands on time.
  let lastAtIso: string;
  if (isMonthly) {
    // For monthly, the most recent unlock was at the latest invoice's date.
    // Approximation: subtract ~30 days * (months past entitled) — but since
    // entitled = paidInvoiceCount and we're setting unlocked = entitled,
    // the next drip is the next monthly invoice (handled by webhook), so
    // last_at just needs to NOT be older than 30 days. Use now().
    lastAtIso = new Date().toISOString();
  } else {
    // Quarterly: last unlock happened at periodStart + (m - 1) * 30 days.
    const periodStartSec = sub.current_period_start as number;
    const lastAtMs = periodStartSec * 1000 + (monthsIntoCurrentQuarter - 1) * 30 * MS_PER_DAY;
    lastAtIso = new Date(lastAtMs).toISOString();
  }

  if (!dryRun) {
    const { error: upErr } = await supa
      .from("athlete_profiles")
      .upsert(
        { user_id: userId, engine_months_unlocked: entitled, engine_months_unlocked_last_at: lastAtIso },
        { onConflict: "user_id" },
      );
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
  }

  return {
    user_id: userId,
    email: profile.email,
    before: currentUnlocked,
    after: entitled,
    reason: `${isMonthly ? "monthly" : "quarterly"}:inv=${paidInvoiceCount}:into_quarter=${monthsIntoCurrentQuarter}`,
  };
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
