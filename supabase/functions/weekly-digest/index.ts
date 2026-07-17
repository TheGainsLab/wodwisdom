/**
 * weekly-digest — the founder's Monday email: the week's funnel in one place.
 *
 * Replaces the manual archaeology of July '26 (curling Stripe events,
 * cross-referencing expired sessions against completions by hand) with an
 * automated report from the platform's own tables: signups, evaluations,
 * checkout opens/completions + conversion, the abandoner worklist,
 * per-template lifecycle-email performance (sent/opened), thumbs-down
 * ratings, and quiet subscribers (churn watch).
 *
 * Data: weekly_digest_stats() RPC (SECURITY DEFINER). Recipient:
 * ADMIN_ALERT_EMAIL (falls back to ADMIN_FROM_EMAIL) — same address as the
 * high-intent alerts. Not logged to email_sends (that table is per-USER
 * outreach history; this is internal reporting).
 *
 * AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (shared with
 * lifecycle-nudges — one secret, several schedules). pg_cron: Mondays.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALERT_EMAIL, sendViaResend } from "../_shared/checkout-emails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

interface DigestStats {
  signups_7d: number;
  evals_7d: number;
  checkouts: { opened: number; people: number; completed: number; by_plan: Record<string, number> };
  abandoners: { email: string; plans: string[] }[];
  emails: { template: string; sent: number; opened: number }[];
  thumbs_down_7d: number;
  quiet_subscribers: string[];
}

const td = `style="padding:6px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px"`;
const th = `style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#888"`;

function renderDigest(s: DigestStats): string {
  const conv = s.checkouts.people > 0
    ? Math.round((s.checkouts.completed / s.checkouts.people) * 100)
    : 0;
  const planLine = Object.entries(s.checkouts.by_plan)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ×${n}`)
    .join(" · ") || "—";

  const abandonerRows = s.abandoners.length
    ? s.abandoners.map((a) => `<tr><td ${td}>${a.email}</td><td ${td}>${a.plans.join(", ")}</td></tr>`).join("")
    : `<tr><td ${td} colspan="2">None this week 🎉</td></tr>`;

  const emailRows = s.emails.length
    ? s.emails.map((e) => {
        const rate = e.sent > 0 ? Math.round((e.opened / e.sent) * 100) : 0;
        return `<tr><td ${td}>${e.template}</td><td ${td}>${e.sent}</td><td ${td}>${e.opened} (${rate}%)</td></tr>`;
      }).join("")
    : `<tr><td ${td} colspan="3">No sends this week</td></tr>`;

  const quiet = s.quiet_subscribers.length
    ? s.quiet_subscribers.join(", ")
    : "None — every subscriber trained in the last 14 days 💪";

  return (
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6">` +
    `<h2 style="margin:0 0 4px">The Gains Lab — weekly digest</h2>` +
    `<p style="color:#888;font-size:13px;margin:0 0 20px">Last 7 days · generated automatically</p>` +

    `<h3 style="margin:20px 0 8px;font-size:15px">Funnel</h3>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><td ${td}>New signups</td><td ${td}><strong>${s.signups_7d}</strong></td></tr>` +
    `<tr><td ${td}>Evaluations completed</td><td ${td}><strong>${s.evals_7d}</strong></td></tr>` +
    `<tr><td ${td}>Checkout: people / opens</td><td ${td}><strong>${s.checkouts.people}</strong> people · ${s.checkouts.opened} sessions</td></tr>` +
    `<tr><td ${td}>Purchases</td><td ${td}><strong>${s.checkouts.completed}</strong> (${conv}% of checkout people)</td></tr>` +
    `<tr><td ${td}>Plans viewed</td><td ${td}>${planLine}</td></tr>` +
    `</table>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">Abandoners (outreach list)</h3>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><th ${th}>Who</th><th ${th}>Plans</th></tr>${abandonerRows}</table>` +
    `<p style="color:#888;font-size:12px;margin:6px 0 0">Opened checkout this week, never completed anything, no subscription. Recovery emails fire automatically at 24h; these are your personal-note candidates.</p>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">Lifecycle emails</h3>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><th ${th}>Template</th><th ${th}>Sent</th><th ${th}>Opened</th></tr>${emailRows}</table>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">Watch items</h3>` +
    `<p>👎 Coach ratings this week: <strong>${s.thumbs_down_7d}</strong>${s.thumbs_down_7d > 0 ? ` — <a href="https://www.thegainslab.com/admin/ratings" style="color:#0074d4">review them</a>` : ""}</p>` +
    `<p>Quiet subscribers (no training logged in 14 days): <strong>${s.quiet_subscribers.length}</strong><br><span style="font-size:13px;color:#5a584f">${quiet}</span></p>` +

    `<p style="color:#9a9890;font-size:12px;margin-top:28px">Weekly digest · <a href="https://www.thegainslab.com/admin/activity" style="color:#9a9890">full activity feed</a></p>` +
    `</div>`
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supa.rpc("weekly_digest_stats");
  if (error || !data) {
    console.error("[weekly-digest] stats query failed:", error);
    return new Response(JSON.stringify({ error: "stats_failed" }), { status: 500 });
  }

  const stats = data as DigestStats;
  const subject = `Weekly digest: ${stats.checkouts.completed} sale${stats.checkouts.completed === 1 ? "" : "s"}, ${stats.signups_7d} signup${stats.signups_7d === 1 ? "" : "s"}, ${stats.abandoners.length} abandoner${stats.abandoners.length === 1 ? "" : "s"}`;
  const messageId = await sendViaResend(ALERT_EMAIL, subject, renderDigest(stats));

  console.log(`[weekly-digest] ${messageId ? "sent" : "FAILED"} to ${ALERT_EMAIL}`);
  return new Response(JSON.stringify({ sent: Boolean(messageId) }), {
    headers: { "Content-Type": "application/json" },
  });
});
