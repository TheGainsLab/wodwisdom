/**
 * reconcile-programming-months — daily paid-vs-delivered sweep (the suspenders).
 *
 * The belt is event-driven delivery: stripe-webhook fires generate-next-month on
 * invoice.payment_succeeded, and monthly-generation-cron drips quarterly users.
 * Both can fail silently (the June '26 incident: a monthly subscriber's paid
 * renewal never generated because the webhook's fire-and-forget call died — found
 * only when the customer emailed). This sweep doesn't care WHY delivery slipped:
 * for every active `programming` subscriber it compares months PAID (Stripe
 * invoices, same math as reconcile-engine-months) against months DELIVERED
 * (latest generated program's generated_months) and heals the gap.
 *
 * Auto-heal fires generate-next-month ONLY when the case is unambiguous:
 *   - active Stripe subscription with >= 1 paid invoice on a supported cadence,
 *   - profile is generation-ready (getTierStatus().canRunPrograms),
 *   - no generation job already pending/processing for the user,
 *   - at most ONE month per user per run (drip — the next daily run advances
 *     again if still behind; never a catch-up burst).
 * Anything ambiguous is flagged, not fired. Every run inserts an audit row into
 * programming_reconciliations, so the sweep can't itself become a silent system.
 *
 * Version-agnostic by construction: generate-next-month routes v3 → append,
 * v1/v2 → migrate to a new v3 program, no program → first-gen. Healthy users
 * (delivered >= entitled) are strict no-ops.
 *
 * Body/query: { dry_run?: boolean } or ?dry_run=true — full report, no side
 * effects (still writes the audit row, marked dry_run).
 *
 * Auth: none inside the function — gated by verify_jwt=false in config.toml and
 * the URL only being called by pg_cron (same posture and rationale as
 * monthly-generation-cron: the platform's service-key drift, sb_secret_ vs
 * legacy JWT, makes byte-comparison checks 401 legitimate callers). Worst-case
 * abuse is triggering a reconciliation that only ever moves delivery TOWARD
 * what was already paid for.
 *
 * Deploy:   supabase functions deploy reconcile-programming-months
 * Schedule: daily via pg_cron (see cron.schedule snippet in the PR/docs), after
 *           monthly-generation-cron so the quarterly drip gets first crack.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { getTierStatus } from "../_shared/tier-status.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const STRIPE_AUTH = "Basic " + btoa(STRIPE_SECRET_KEY + ":");
const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface Flagged {
  user_id: string;
  email: string | null;
  reason: string;
  delivered?: number;
  entitled?: number;
}

interface Healed {
  user_id: string;
  email: string | null;
  delivered: number;
  entitled: number;
  target_month: number;
  mode_hint: string;
}

Deno.serve(async (req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const dryRun =
    new URL(req.url).searchParams.get("dry_run") === "true" || body?.dry_run === true;

  const healed: Healed[] = [];
  const flagged: Flagged[] = [];
  const errors: Array<{ user_id: string; error: string }> = [];
  let healthy = 0;
  let checked = 0;

  try {
    const nowIso = new Date().toISOString();
    const { data: ents } = await supa
      .from("user_entitlements")
      .select("user_id")
      .eq("feature", "programming")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    const users = Array.from(new Set((ents ?? []).map((e) => e.user_id as string)));
    checked = users.length;

    for (const userId of users) {
      try {
        const outcome = await reconcileOne(supa, userId, dryRun);
        if (outcome === "healthy") healthy++;
        else if ("target_month" in outcome) healed.push(outcome);
        else flagged.push(outcome);
      } catch (e) {
        errors.push({ user_id: userId, error: (e as Error).message });
      }
    }
  } catch (e) {
    errors.push({ user_id: "*", error: (e as Error).message });
  }

  const summary = { dry_run: dryRun, checked, healthy, healed, flagged, errors };

  // Audit row — best-effort, but a failure to write it is itself loud (500).
  const { error: auditErr } = await supa
    .from("programming_reconciliations")
    .insert({ dry_run: dryRun, checked, healthy, healed, flagged, errors });

  return new Response(JSON.stringify(summary, null, 2), {
    status: auditErr ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function reconcileOne(
  // deno-lint-ignore no-explicit-any
  supa: any,
  userId: string,
  dryRun: boolean,
): Promise<"healthy" | Healed | Flagged> {
  const { data: profile } = await supa
    .from("profiles")
    .select("email, stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  const email = profile?.email ?? null;
  if (!profile?.stripe_customer_id) {
    return { user_id: userId, email, reason: "no_stripe_customer" };
  }

  // --- Ground truth: what have they PAID for? (same math as reconcile-engine-months)
  const subsResp = await fetchWithTimeout(
    `https://api.stripe.com/v1/subscriptions?customer=${profile.stripe_customer_id}&status=active&limit=1`,
    { headers: { Authorization: STRIPE_AUTH } },
    15_000,
  );
  if (!subsResp.ok) throw new Error(`stripe subs ${subsResp.status}`);
  const sub = (await subsResp.json()).data?.[0];
  if (!sub) {
    return { user_id: userId, email, reason: "no_active_subscription" };
  }

  const recurring = sub.items?.data?.[0]?.price?.recurring ?? {};
  const interval = recurring.interval as string | undefined;
  const intervalCount = (recurring.interval_count as number | undefined) ?? 1;
  const isMonthly = interval === "month" && intervalCount === 1;
  const isQuarterly =
    (interval === "month" && intervalCount === 3) ||
    (interval === "quarter" && intervalCount === 1);
  if (!isMonthly && !isQuarterly) {
    return { user_id: userId, email, reason: `unsupported_interval:${interval}x${intervalCount}` };
  }

  const invResp = await fetchWithTimeout(
    `https://api.stripe.com/v1/invoices?customer=${profile.stripe_customer_id}&subscription=${sub.id}&status=paid&limit=100`,
    { headers: { Authorization: STRIPE_AUTH } },
    15_000,
  );
  if (!invResp.ok) throw new Error(`stripe invoices ${invResp.status}`);
  const paidInvoiceCount: number = ((await invResp.json()).data ?? []).length;
  if (paidInvoiceCount === 0) {
    return { user_id: userId, email, reason: "no_paid_invoices" };
  }

  let entitled: number;
  if (isMonthly) {
    entitled = paidInvoiceCount;
  } else {
    const periodStartSec = sub.current_period_start as number | undefined;
    if (typeof periodStartSec !== "number") {
      return { user_id: userId, email, reason: "missing_period_start" };
    }
    const daysIntoPeriod = (Date.now() - periodStartSec * 1000) / MS_PER_DAY;
    const monthsIntoQuarter = Math.min(Math.floor(daysIntoPeriod / 30) + 1, 3);
    entitled = (paidInvoiceCount - 1) * 3 + monthsIntoQuarter;
  }

  // --- Delivered truth: latest generated program's cumulative month counter.
  const { data: progs } = await supa
    .from("programs")
    .select("id, generated_months, program_version")
    .eq("user_id", userId)
    .eq("source", "generated")
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = progs?.[0] ?? null;
  const delivered = latest ? (latest.generated_months as number | null) || 1 : 0;

  if (delivered >= entitled) return "healthy";

  // --- Gap found. Guards before auto-heal (ambiguity → flag, never fire):
  // A generation already in flight will close the gap on its own; firing again
  // would double-generate the same month.
  const { count: inFlight } = await supa
    .from("program_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["pending", "processing"]);
  if ((inFlight ?? 0) > 0) {
    return { user_id: userId, email, reason: "generation_in_flight", delivered, entitled };
  }

  // Profile must be generation-ready — a paying user with an incomplete Tier 3
  // (e.g. a test account) needs the operator, not a half-grounded program.
  const { data: ap } = await supa
    .from("athlete_profiles")
    .select(
      "age, height, bodyweight, gender, units, lifts, skills, conditioning, equipment, days_per_week, session_length_minutes, injuries_constraints, goal",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const tier = getTierStatus(ap ?? null);
  if (!tier.canRunPrograms) {
    const missing = [...tier.tier1.missing, ...tier.tier2.missing, ...tier.tier3.missing];
    return {
      user_id: userId,
      email,
      reason: `profile_incomplete:${missing.join(",")}`,
      delivered,
      entitled,
    };
  }

  const targetMonth = delivered + 1; // drip: one month per run, never a burst
  const modeHint = !latest ? "firstgen" : latest.program_version === "v3" ? "append" : "migrate";

  if (dryRun) {
    return { user_id: userId, email, reason: "would_heal", delivered, entitled };
  }

  // Fire-and-forget like the cron/webhook: generate-next-month keeps running
  // server-side after the 30s wait; tomorrow's run verifies the gap closed
  // (and the in-flight guard keeps today's job from being double-fired).
  try {
    await fetchWithTimeout(
      `${SUPABASE_URL}/functions/v1/generate-next-month`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "x-webhook-user-id": userId,
        },
        body: JSON.stringify(latest ? { program_id: latest.id } : {}),
      },
      30_000,
    );
  } catch (_e) {
    // Timeout ≠ failure here (the call outlives our wait); the audit row plus
    // tomorrow's sweep are the real verification.
  }

  console.log(
    `[reconcile-programming] healing user=${userId} delivered=${delivered} entitled=${entitled} target=${targetMonth} mode=${modeHint}`,
  );
  return { user_id: userId, email, delivered, entitled, target_month: targetMonth, mode_hint: modeHint };
}
