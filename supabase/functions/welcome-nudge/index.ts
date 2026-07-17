/**
 * welcome-nudge — lifecycle automation #1: the "free stuff in your account"
 * email for users who signed up, confirmed, and then did nothing.
 *
 * The founder was sending this by hand; the copy below IS his manual email
 * (July '26), with three edits: the "one free question left" line (only true
 * for hand-picked recipients) became "3 free questions", each feature gained
 * its door link, and the paid paragraph gained the repositioning line (Coach
 * + Nutrition included with every plan).
 *
 * Runs DAILY via pg_cron. Candidates come from welcome_nudge_candidates()
 * (SECURITY DEFINER over auth.users) — accounts 36h–7d old, confirmed, zero
 * activity, zero prior emails; the send logs to email_sends
 * (template welcome_nudge), which makes it one-shot per user and puts it on
 * the admin timeline with Resend open tracking, like every other send.
 *
 * AUTH: verify_jwt=false (pg_cron can't mint a JWT); gated on X-Cron-Key
 * (WELCOME_NUDGE_CRON_KEY), fail-closed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEmailSend, sendViaResend } from "../_shared/checkout-emails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("WELCOME_NUDGE_CRON_KEY");

const SITE = "https://www.thegainslab.com";
const SUBJECT = "The free stuff in your account";

function renderWelcome(firstName: string | null): string {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const link = (path: string, label: string) =>
    `<a href="${SITE}${path}" style="color:#0074d4;text-decoration:none;font-weight:600">${label}</a>`;
  return (
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6">` +
    `<p>${hi}</p>` +
    `<p>Thanks for creating an account. Before anything else — there's real value already sitting in it, free:</p>` +
    `<p><strong>Your Athlete History</strong> — Done the Open? ${link("/athletedata", "Link your history")} for a detailed breakdown of your performance. Retest, or try new workouts. No history? Every workout and every data feature is still yours. Start building a history!</p>` +
    `<p><strong>Your Free Fitness Evaluation</strong> — ${link("/profile", "Complete your profile")} (5 minutes) and our AI candidly analyzes your fitness: strengths, weaknesses, and training priorities. It's yours to keep — share it with your coach or build your next training block on it.</p>` +
    `<p><strong>AI Coach</strong> — ${link("/chat", "3 free questions")}, answered by an AI trained on our methodology. Complete your profile and evaluation first and the answers get personal.</p>` +
    `<p>All of that is free, already available in your account.</p>` +
    `<p><strong>When you want more:</strong> ${link("/features/engine", "Year of the Engine")} gives you 8 conditioning programs with personalized targets every training day and analytics we believe no other platform matches. ${link("/features/programs", "AI Programming")} builds fully individualized training — every block, warmup to cooldown — and evolves monthly based on what you actually log. Like a high-level coach, at a fraction of the price. Both include the AI Coach and full nutrition tracking.</p>` +
    `<p><a href="${SITE}/profile" style="display:inline-block;background:#0074d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Start with the evaluation — 5 minutes</a></p>` +
    `<p>Looking forward to working with you.</p>` +
    `<p>-Matt</p>` +
    `<p style="color:#9a9890;font-size:12px;margin-top:28px">The Gains Lab · <a href="${SITE}" style="color:#9a9890">www.thegainslab.com</a></p>` +
    `</div>`
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: candidates, error } = await supa.rpc("welcome_nudge_candidates", { p_limit: 25 });
  if (error) {
    console.error("[welcome-nudge] candidates query failed:", error);
    return new Response(JSON.stringify({ error: "candidates_failed" }), { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  for (const c of (candidates ?? []) as { user_id: string; email: string; full_name: string | null }[]) {
    const firstName = c.full_name?.trim().split(/\s+/)[0] || null;
    const messageId = await sendViaResend(c.email, SUBJECT, renderWelcome(firstName));
    // Log even failures: the email_sends row is the one-shot guard, and a
    // 'failed' row surfaces on the admin page instead of silently retrying
    // the same address forever.
    await logEmailSend(supa, c.user_id, "welcome_nudge", SUBJECT, messageId);
    if (messageId) sent++; else failed++;
  }

  console.log(`[welcome-nudge] candidates=${candidates?.length ?? 0} sent=${sent} failed=${failed}`);
  return new Response(JSON.stringify({ candidates: candidates?.length ?? 0, sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
