/**
 * lifecycle-nudges — the daily lifecycle-email sweep (July '26).
 *
 * ONE pg_cron job, ONE secret, N sweeps. Each sweep is: a candidates RPC
 * (SECURITY DEFINER, window-bounded so the historical user base is
 * physically invisible), a founder-voiced template, a send via the shared
 * Resend helpers, and an email_sends log (template_key = the sweep name) —
 * which is simultaneously the one-shot guard, the admin-timeline entry, and
 * the open-tracking hook.
 *
 * Sweeps:
 *   1. welcome_nudge — signed up, confirmed, did NOTHING for 36h (7d cap).
 *      The founder's manual "free stuff in your account" email, automated.
 *   2. free_limit_nudge — asked the 3rd (last) free AI Coach question within
 *      the past 7 days and holds no entitlement. The highest-intent moment
 *      in the funnel: they were USING the product when it said no. Pitch
 *      leads with context ("answers are only as good as what it knows about
 *      you") → training plans first, standalone Coach as a parenthetical.
 *
 * AUTH: verify_jwt=false (pg_cron can't mint a JWT); gated on X-Cron-Key
 * (LIFECYCLE_CRON_KEY), fail-closed.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEmailSend, sendViaResend } from "../_shared/checkout-emails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

const SITE = "https://www.thegainslab.com";

const link = (path: string, label: string) =>
  `<a href="${SITE}${path}" style="color:#0074d4;text-decoration:none;font-weight:600">${label}</a>`;
const button = (path: string, label: string) =>
  `<p><a href="${SITE}${path}" style="display:inline-block;background:#0074d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
const wrap = (inner: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6">${inner}<p style="color:#9a9890;font-size:12px;margin-top:28px">The Gains Lab · <a href="${SITE}" style="color:#9a9890">www.thegainslab.com</a></p></div>`;
const hi = (firstName: string | null) => (firstName ? `Hi ${firstName},` : "Hi,");

// ── Sweep 1: welcome nudge ──────────────────────────────────────────────────

const WELCOME_SUBJECT = "The free stuff in your account";

function renderWelcome(firstName: string | null): string {
  return wrap(
    `<p>${hi(firstName)}</p>` +
    `<p>Thanks for creating an account. Before anything else — there's real value already sitting in it, free:</p>` +
    `<p><strong>Your Athlete History</strong> — Done the Open? ${link("/athletedata", "Link your history")} for a detailed breakdown of your performance. Retest, or try new workouts. No history? Every workout and every data feature is still yours. Start building a history!</p>` +
    `<p><strong>Your Free Fitness Evaluation</strong> — ${link("/profile", "Complete your profile")} (5 minutes) and our AI candidly analyzes your fitness: strengths, weaknesses, and training priorities. It's yours to keep — share it with your coach or build your next training block on it.</p>` +
    `<p><strong>AI Coach</strong> — ${link("/chat", "3 free questions")}, answered by an AI trained on our methodology. Complete your profile and evaluation first and the answers get personal.</p>` +
    `<p>All of that is free, already available in your account.</p>` +
    `<p><strong>When you want more:</strong> ${link("/features/engine", "Year of the Engine")} gives you 8 conditioning programs with personalized targets every training day and analytics we believe no other platform matches. ${link("/features/programs", "AI Programming")} builds fully individualized training — every block, warmup to cooldown — and evolves monthly based on what you actually log. Like a high-level coach, at a fraction of the price. Both include the AI Coach and full nutrition tracking.</p>` +
    button("/profile", "Start with the evaluation — 5 minutes") +
    `<p>Looking forward to working with you.</p>` +
    `<p>-Matt</p>`,
  );
}

// ── Sweep 2: free-limit nudge ───────────────────────────────────────────────

const FREE_LIMIT_SUBJECT = "You used all three — that's the idea";

function renderFreeLimit(firstName: string | null): string {
  return wrap(
    `<p>${hi(firstName)}</p>` +
    `<p>You've asked your three free AI Coach questions. That's what they were there for — I hope the answers were useful.</p>` +
    `<p>Here's the thing about this coach: its answers are only as good as what it knows about <em>you</em>. ${link("/profile", "Complete your profile and free evaluation")}, and it stops giving general advice — it answers with your lifts, your conditioning, and your goals in the room.</p>` +
    `<p>And inside a training plan, it sees everything: your program, your baselines, today's session. Ask "how should I pace this?" and it's talking about <em>your</em> workout — pacing computed from <em>your</em> time trial — not a generic template. That's the version of the Coach no general-purpose AI can be.</p>` +
    `<p><strong>${link("/features/engine", "Year of the Engine")}</strong> or <strong>${link("/features/programs", "AI Programming")}</strong> — $29.99/mo each, both with the unlimited Coach and full nutrition tracking included.</p>` +
    `<p style="font-size:13px;color:#5a584f">(Just want unlimited questions with your profile, without a program? The ${link("/features/coaching", "standalone Coach")} is $7.99/mo.)</p>` +
    `<p>Whatever you asked about this week — that's exactly the kind of thing it's built for, every day.</p>` +
    button("/features", "See the plans") +
    `<p>-Matt</p>`,
  );
}

// ── The sweep runner ────────────────────────────────────────────────────────

interface Candidate { user_id: string; email: string; full_name: string | null }

async function runSweep(
  supa: SupabaseClient,
  rpc: string,
  templateKey: string,
  subject: string,
  render: (firstName: string | null) => string,
): Promise<{ candidates: number; sent: number; failed: number }> {
  const { data, error } = await supa.rpc(rpc, { p_limit: 25 });
  if (error) {
    console.error(`[lifecycle-nudges] ${rpc} failed:`, error);
    return { candidates: 0, sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const c of (data ?? []) as Candidate[]) {
    const firstName = c.full_name?.trim().split(/\s+/)[0] || null;
    const messageId = await sendViaResend(c.email, subject, render(firstName));
    // Log even failures: the email_sends row is the one-shot guard, and a
    // 'failed' row surfaces on the admin page instead of silently retrying
    // the same address forever.
    await logEmailSend(supa, c.user_id, templateKey, subject, messageId);
    if (messageId) sent++; else failed++;
  }
  return { candidates: (data ?? []).length, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const welcome = await runSweep(supa, "welcome_nudge_candidates", "welcome_nudge", WELCOME_SUBJECT, renderWelcome);
  const freeLimit = await runSweep(supa, "free_limit_candidates", "free_limit_nudge", FREE_LIMIT_SUBJECT, renderFreeLimit);

  console.log(
    `[lifecycle-nudges] welcome: ${welcome.sent}/${welcome.candidates} sent` +
    ` | free_limit: ${freeLimit.sent}/${freeLimit.candidates} sent`,
  );
  return new Response(JSON.stringify({ welcome, free_limit: freeLimit }), {
    headers: { "Content-Type": "application/json" },
  });
});
