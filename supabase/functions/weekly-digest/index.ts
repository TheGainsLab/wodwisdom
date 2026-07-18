/**
 * weekly-digest — the founder's Monday email: the week's funnel in one place.
 *
 * Reviewed 2026-07-18; fixes carried here: purchases are counted by
 * COMPLETION date (a checkout opened last week that closes this week
 * counts), truncated lists ship their true totals, email stats exclude
 * failed sends, and user-controlled strings are escaped before hitting the
 * digest HTML.
 *
 * Data: weekly_digest_stats() RPC. Recipient: ADMIN_ALERT_EMAIL. Not logged
 * to email_sends (per-USER outreach history, not internal reporting).
 *
 * AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (shared gate).
 * pg_cron: Mondays.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALERT_EMAIL, emailWrap, escapeHtml, sendViaResend, SITE } from "../_shared/checkout-emails.ts";
import { requireCronKey } from "../_shared/cron-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

interface DigestStats {
  signups_7d: number;
  acquisition: Record<string, number>;
  evals_7d: number;
  checkouts: { opened: number; people: number; completed: number; by_plan: Record<string, number> };
  recovery_wins: number;
  abandoners_total: number;
  abandoners: { email: string; plans: string[] }[];
  emails: { template: string; sent: number; opened: number; failed: number }[];
  chat_insights: { topics: Record<string, number>; feature_requests: number; complaints: number; buying_intent: number };
  thumbs_down_7d: number;
  opt_outs_total: number;
  pwa: { installed_total: number; installed_7d: number };
  active_users: { this_week: number; prior_week: number };
  engagement: {
    not_logging_total: number;
    not_logging: string[];
    ghosting_total: number;
    ghosting: string[];
  };
}

const kvLine = (obj: Record<string, number>) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${escapeHtml(k)} ×${n}`)
    .join(" · ") || "—";

const td = `style="padding:6px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px"`;
const th = `style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#888"`;

function renderDigest(s: DigestStats): string {
  const planLine = kvLine(s.checkouts.by_plan);
  const acqLine = kvLine(s.acquisition);
  const topicsLine = kvLine(s.chat_insights.topics);
  const trend = s.active_users.this_week - s.active_users.prior_week;
  const trendArrow = trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : "→ flat";

  const abandonerRows = s.abandoners.length
    ? s.abandoners.map((a) =>
        `<tr><td ${td}>${escapeHtml(a.email)}</td><td ${td}>${a.plans.map(escapeHtml).join(", ")}</td></tr>`,
      ).join("")
    : `<tr><td ${td} colspan="2">None this week 🎉</td></tr>`;
  const abandonerNote = s.abandoners_total > s.abandoners.length
    ? ` (showing ${s.abandoners.length} of ${s.abandoners_total})`
    : "";

  const emailRows = s.emails.length
    ? s.emails.map((e) => {
        const rate = e.sent > 0 ? Math.round((e.opened / e.sent) * 100) : 0;
        const failed = e.failed > 0 ? ` · <span style="color:#c0392b">${e.failed} failed</span>` : "";
        return `<tr><td ${td}>${escapeHtml(e.template)}</td><td ${td}>${e.sent}${failed}</td><td ${td}>${e.opened} (${rate}%)</td></tr>`;
      }).join("")
    : `<tr><td ${td} colspan="3">No sends this week</td></tr>`;

  const sampleLine = (total: number, sample: string[], noneText: string) =>
    total === 0
      ? noneText
      : sample.map(escapeHtml).join(", ") +
        (total > sample.length ? ` … and ${total - sample.length} more` : "");
  const notLoggingLine = sampleLine(s.engagement.not_logging_total, s.engagement.not_logging, "None");
  const ghostingLine = sampleLine(s.engagement.ghosting_total, s.engagement.ghosting, "None — everyone quiet is at least signing in");

  return emailWrap(
    `<h2 style="margin:0 0 4px">The Gains Lab — weekly digest</h2>` +
    `<p style="color:#888;font-size:13px;margin:0 0 20px">Last 7 days · generated automatically</p>` +

    `<h3 style="margin:20px 0 8px;font-size:15px">Funnel</h3>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><td ${td}>Active users (any logging)</td><td ${td}><strong>${s.active_users.this_week}</strong> vs ${s.active_users.prior_week} last week (${trendArrow})</td></tr>` +
    `<tr><td ${td}>New signups</td><td ${td}><strong>${s.signups_7d}</strong></td></tr>` +
    `<tr><td ${td}>…from</td><td ${td}>${acqLine}</td></tr>` +
    `<tr><td ${td}>Evaluations completed</td><td ${td}><strong>${s.evals_7d}</strong></td></tr>` +
    `<tr><td ${td}>Checkout: people / opens</td><td ${td}><strong>${s.checkouts.people}</strong> people · ${s.checkouts.opened} sessions</td></tr>` +
    `<tr><td ${td}>Purchases (closed this week)</td><td ${td}><strong>${s.checkouts.completed}</strong>${s.recovery_wins > 0 ? ` · <span style="color:#2ec486">${s.recovery_wins} followed a recovery email</span>` : ""}</td></tr>` +
    `<tr><td ${td}>Plans viewed</td><td ${td}>${planLine}</td></tr>` +
    `<tr><td ${td}>PWA installs</td><td ${td}><strong>${s.pwa.installed_7d}</strong> this week · ${s.pwa.installed_total} total</td></tr>` +
    `</table>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">What people ask the Coach</h3>` +
    `<p style="margin:0">Topics: ${topicsLine}</p>` +
    `<p style="margin:6px 0 0;font-size:13px;color:#5a584f">` +
    `${s.chat_insights.buying_intent} with buying intent · ${s.chat_insights.feature_requests} feature requests · ${s.chat_insights.complaints} complaints` +
    `</p>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">Abandoners${abandonerNote} — outreach list</h3>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><th ${th}>Who</th><th ${th}>Plans</th></tr>${abandonerRows}</table>` +
    `<p style="color:#888;font-size:12px;margin:6px 0 0">Opened checkout this week, never completed anything, no subscription. Recovery emails fire automatically at 24h; these are your personal-note candidates.</p>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">Lifecycle emails</h3>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><th ${th}>Template</th><th ${th}>Sent</th><th ${th}>Opened</th></tr>${emailRows}</table>` +

    `<h3 style="margin:24px 0 8px;font-size:15px">Watch items</h3>` +
    `<p>👎 Coach ratings this week: <strong>${s.thumbs_down_7d}</strong>${s.thumbs_down_7d > 0 ? ` — <a href="${SITE}/admin/ratings" style="color:#0074d4">review them</a>` : ""}` +
    ` · Email opt-outs (all time): <strong>${s.opt_outs_total}</strong></p>` +
    `<p><strong>Signing in but not logging</strong> (engaged, nothing recorded in 14d — the logging nudge works this group): <strong>${s.engagement.not_logging_total}</strong><br><span style="font-size:13px;color:#5a584f">${notLoggingLine}</span></p>` +
    `<p><strong>Ghosting</strong> (no sign-ins in 14d either — actually gone): <strong>${s.engagement.ghosting_total}</strong><br><span style="font-size:13px;color:#5a584f">${ghostingLine}</span></p>`,
    { maxWidth: 640 },
  );
}

Deno.serve(async (req) => {
  const denied = requireCronKey(req, CRON_KEY);
  if (denied) return denied;

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supa.rpc("weekly_digest_stats");
  if (error || !data) {
    console.error("[weekly-digest] stats query failed:", error);
    // Loud failure: the founder must know Monday's numbers didn't arrive.
    await sendViaResend(ALERT_EMAIL, "Weekly digest FAILED", emailWrap(
      `<p>The weekly digest query errored: ${escapeHtml(error?.message ?? "no data")}</p>`,
    ));
    return new Response(JSON.stringify({ error: "stats_failed" }), { status: 500 });
  }

  const stats = data as DigestStats;

  // Reporting foundation: persist the snapshot BEFORE sending — the trend
  // history must survive even if Resend hiccups.
  await supa.from("digest_runs").insert({ stats }).then(
    () => {},
    (e: unknown) => console.error("[weekly-digest] snapshot insert failed:", e),
  );

  const subject = `Weekly digest: ${stats.checkouts.completed} sale${stats.checkouts.completed === 1 ? "" : "s"}, ${stats.signups_7d} signup${stats.signups_7d === 1 ? "" : "s"}, ${stats.abandoners_total} abandoner${stats.abandoners_total === 1 ? "" : "s"}`;
  const messageId = await sendViaResend(ALERT_EMAIL, subject, renderDigest(stats));

  console.log(`[weekly-digest] ${messageId ? "sent" : "FAILED"} to ${ALERT_EMAIL}`);
  return new Response(JSON.stringify({ sent: Boolean(messageId) }), {
    status: messageId ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
