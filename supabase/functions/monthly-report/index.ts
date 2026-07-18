/**
 * monthly-report — the founder's 1st-of-month email: last month's money.
 *
 * Reads monthly_revenue_stats() (the billing_events ledger — capture item A
 * put the data in; this reads it out): purchases by plan/currency, voluntary
 * vs involuntary churn, average tenure of the departed, payment failures,
 * refunds, disputes, plan changes.
 *
 * AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (shared gate).
 * pg_cron: 1st of the month.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALERT_EMAIL, emailWrap, escapeHtml, sendViaResend } from "../_shared/checkout-emails.ts";
import { requireCronKey } from "../_shared/cron-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

interface RevenueStats {
  month: string;
  purchases: { count: number; by_plan: Record<string, number>; by_currency: Record<string, number> };
  churn: { voluntary: number; involuntary: number; avg_tenure_days: number | null };
  payment_failures: number;
  refunds: { count: number; amount_cents: number };
  disputes: number;
  plan_changes: number;
}

const td = `style="padding:6px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px"`;

const kvLine = (obj: Record<string, number>) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${escapeHtml(k)} ×${n}`)
    .join(" · ") || "—";

function renderReport(s: RevenueStats): string {
  const netChange = s.purchases.count - s.churn.voluntary - s.churn.involuntary;
  const net = netChange > 0 ? `+${netChange}` : `${netChange}`;
  return emailWrap(
    `<h2 style="margin:0 0 4px">The Gains Lab — ${s.month} revenue report</h2>` +
    `<p style="color:#888;font-size:13px;margin:0 0 20px">Previous calendar month · from the billing ledger</p>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><td ${td}>New subscriptions</td><td ${td}><strong>${s.purchases.count}</strong></td></tr>` +
    `<tr><td ${td}>…by plan</td><td ${td}>${kvLine(s.purchases.by_plan)}</td></tr>` +
    `<tr><td ${td}>…by currency</td><td ${td}>${kvLine(s.purchases.by_currency)}</td></tr>` +
    `<tr><td ${td}>Churn — chose to leave</td><td ${td}><strong>${s.churn.voluntary}</strong>${s.churn.avg_tenure_days != null ? ` (avg tenure ${s.churn.avg_tenure_days} days)` : ""}</td></tr>` +
    `<tr><td ${td}>Churn — payment died</td><td ${td}><strong>${s.churn.involuntary}</strong></td></tr>` +
    `<tr><td ${td}>Net subscriber change</td><td ${td}><strong>${net}</strong></td></tr>` +
    `<tr><td ${td}>Payment failures (attempts)</td><td ${td}>${s.payment_failures}</td></tr>` +
    `<tr><td ${td}>Refunds</td><td ${td}>${s.refunds.count} (${(s.refunds.amount_cents / 100).toFixed(2)})</td></tr>` +
    `<tr><td ${td}>Disputes</td><td ${td}>${s.disputes}</td></tr>` +
    `<tr><td ${td}>Plan changes</td><td ${td}>${s.plan_changes}</td></tr>` +
    `</table>` +
    `<p style="color:#888;font-size:12px;margin-top:12px">Ledger began 2026-07-18 — the first full month is August; earlier months under-report.</p>`,
    { maxWidth: 640 },
  );
}

Deno.serve(async (req) => {
  const denied = requireCronKey(req, CRON_KEY);
  if (denied) return denied;

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supa.rpc("monthly_revenue_stats");
  if (error || !data) {
    console.error("[monthly-report] stats query failed:", error);
    await sendViaResend(ALERT_EMAIL, "Monthly report FAILED", emailWrap(
      `<p>The monthly revenue query errored: ${escapeHtml(error?.message ?? "no data")}</p>`,
    ));
    return new Response(JSON.stringify({ error: "stats_failed" }), { status: 500 });
  }

  const stats = data as RevenueStats;
  const subject = `${stats.month} revenue: ${stats.purchases.count} new, ${stats.churn.voluntary + stats.churn.involuntary} churned`;
  const messageId = await sendViaResend(ALERT_EMAIL, subject, renderReport(stats));

  console.log(`[monthly-report] ${messageId ? "sent" : "FAILED"} to ${ALERT_EMAIL}`);
  return new Response(JSON.stringify({ sent: Boolean(messageId) }), {
    status: messageId ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
