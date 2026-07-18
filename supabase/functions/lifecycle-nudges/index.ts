/**
 * lifecycle-nudges — the daily lifecycle-email sweep (July '26; reviewed).
 *
 * ONE pg_cron job, ONE secret, N sweeps. Each sweep is: a candidates RPC
 * (SECURITY DEFINER, window-bounded, opt-out- and cadence-aware — see the
 * migration for the full safety model), a founder-voiced template rendered
 * with the SHARED chrome (escaped names, unsubscribe link, postal footer),
 * a Resend send, and an email_sends log (one-shot guard — failed rows are
 * ignored by the RPCs, so transient failures retry next run).
 *
 * Sweeps:
 *   1. welcome_nudge — signed up, confirmed, did NOTHING for 36h (7d cap).
 *   2. free_limit_nudge — exhausted the 3 free Coach questions within 7d,
 *      never paid (churned subscribers are excluded — they never had a
 *      "free limit" to hit).
 *   3. eval_followup — completed the free evaluation 2–7d ago, stalled.
 *
 * Failure surfacing: a sweep whose RPC errors is reported in the response
 * (HTTP 500) AND fires a founder alert email — a broken sweep must never be
 * indistinguishable from "no candidates today".
 *
 * AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (shared gate in
 * _shared/cron-auth.ts), fail-closed.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ALERT_EMAIL,
  emailButton,
  emailLink,
  emailWrap,
  firstNameOf,
  logEmailSend,
  sendViaResend,
  unsubscribeUrl,
} from "../_shared/checkout-emails.ts";
import { requireCronKey } from "../_shared/cron-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

const hi = (firstName: string | null) => (firstName ? `Hi ${firstName},` : "Hi,");

// ── Sweep 1: welcome nudge ──────────────────────────────────────────────────

const WELCOME_SUBJECT = "The free stuff in your account";

function renderWelcome(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>Thanks for creating an account. Before anything else — there's real value already sitting in it, free:</p>` +
    `<p><strong>Your Athlete History</strong> — Done the Open? ${emailLink("/athletedata", "Link your history")} for a detailed breakdown of your performance. Retest, or try new workouts. No history? Every workout and every data feature is still yours. Start building a history!</p>` +
    `<p><strong>Your Free Fitness Evaluation</strong> — ${emailLink("/profile", "Complete your profile")} (5 minutes) and our AI candidly analyzes your fitness: strengths, weaknesses, and training priorities. It's yours to keep — share it with your coach or build your next training block on it.</p>` +
    `<p><strong>AI Coach</strong> — ${emailLink("/chat", "3 free questions")}, answered by an AI trained on our methodology. Complete your profile and evaluation first and the answers get personal.</p>` +
    `<p>All of that is free, already available in your account.</p>` +
    `<p><strong>When you want more:</strong> ${emailLink("/features/engine", "Year of the Engine")} gives you 8 conditioning programs with personalized targets every training day and analytics we believe no other platform matches. ${emailLink("/features/programs", "AI Programming")} builds fully individualized training — every block, warmup to cooldown — and evolves monthly based on what you actually log. Like a high-level coach, at a fraction of the price. Both include the AI Coach and full nutrition tracking.</p>` +
    emailButton("/profile", "Start with the evaluation — 5 minutes") +
    `<p>Looking forward to working with you.</p>` +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

// ── Sweep 2: free-limit nudge ───────────────────────────────────────────────

const FREE_LIMIT_SUBJECT = "You used all three — that's the idea";

function renderFreeLimit(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>You've asked your three free AI Coach questions. That's what they were there for — I hope the answers were useful.</p>` +
    `<p>Here's the thing about this coach: its answers are only as good as what it knows about <em>you</em>. ${emailLink("/profile", "Complete your profile and free evaluation")}, and it stops giving general advice — it answers with your lifts, your conditioning, and your goals in the room.</p>` +
    `<p>And inside a training plan, it sees everything: your program, your baselines, today's session. Ask "how should I pace this?" and it's talking about <em>your</em> workout — pacing computed from <em>your</em> time trial — not a generic template. That's the version of the Coach no general-purpose AI can be.</p>` +
    `<p><strong>${emailLink("/features/engine", "Year of the Engine")}</strong> or <strong>${emailLink("/features/programs", "AI Programming")}</strong> — $29.99/mo each, both with the unlimited Coach and full nutrition tracking included.</p>` +
    `<p style="font-size:13px;color:#5a584f">(Just want unlimited questions with your profile, without a program? The ${emailLink("/features/coaching", "standalone Coach")} is $7.99/mo.)</p>` +
    `<p>Whatever you asked about this week — that's exactly the kind of thing it's built for, every day.</p>` +
    emailButton("/features", "See the plans") +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

// ── Sweep 3: evaluation follow-up ───────────────────────────────────────────

const EVAL_FOLLOWUP_SUBJECT = "Your evaluation, and what to do with it";

function renderEvalFollowup(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>A few days ago our AI took an honest look at your fitness — your lifting, your skills, and your engine. ${emailLink("/profile", "It's still there in your account")} whenever you want to re-read it.</p>` +
    `<p>Here's the question that matters: what happens with it now? An assessment you don't act on is just interesting reading. The whole reason we built the evaluation is that it feeds directly into training:</p>` +
    `<p><strong>If your engine was the flag</strong> — ${emailLink("/features/engine", "Year of the Engine")} turns that into 8 conditioning programs with targets calibrated to <em>your</em> baseline, recalibrated as you improve.</p>` +
    `<p><strong>If lifting or skills need the work</strong> — ${emailLink("/features/programs", "AI Programming")} builds your whole program around exactly those gaps, and rebuilds it monthly based on what you log.</p>` +
    `<p><strong>If the honest answer is "more than one thing"</strong> — ${emailLink("/features", "All Access")} is both programs under one subscription: your conditioning and your strength and skills, trained at the same time. At $49.99/mo it's the best value on the board — everything for less than two plans.</p>` +
    `<p>Each plan is $29.99/mo on its own, and every plan includes the unlimited AI Coach and full nutrition tracking. Whichever fits, it starts from the evaluation you already did. The work of knowing where you stand is done. The next step is training on it.</p>` +
    emailButton("/features", "Pick your plan") +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

// ── Sweep 4: logging nudge ──────────────────────────────────────────────────
// The everywhere-problem (founder): users who train but never log. Targets
// entitled Engine/Programming users who signed in this week but haven't
// logged a session in 14+ days — engaged, just not recording. The pitch is
// coaching, not nagging: this product's targets literally adapt to logs.

const LOGGING_SUBJECT = "Your training only counts if the engine sees it";

function renderLoggingNudge(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>You've been in the app lately — good. But I don't see results logged from recent sessions, and in this system that matters more than bookkeeping: <strong>your targets calibrate off what you log.</strong> No logs, no adaptation — the program slowly turns into a generic template, which is exactly what you're not paying for.</p>` +
    `<p>It doesn't need to be precise. A rough time or output after each session is enough for the engine to work with.</p>` +
    emailButton("/training-log", "Log your last session") +
    `<p>And if something about logging is slowing you down — too many steps, wrong units, anything — reply and tell me. I'll fix it.</p>` +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

// ── The sweep runner ────────────────────────────────────────────────────────

interface Candidate { user_id: string; email: string; full_name: string | null }
interface SweepResult { candidates: number; sent: number; failed: number; error?: string }

async function runSweep(
  supa: SupabaseClient,
  rpc: string,
  templateKey: string,
  subject: string,
  render: (firstName: string | null, unsubUrl: string | null) => string,
): Promise<SweepResult> {
  const { data, error } = await supa.rpc(rpc, { p_limit: 25 });
  if (error) {
    console.error(`[lifecycle-nudges] ${rpc} failed:`, error);
    return { candidates: 0, sent: 0, failed: 0, error: `${rpc}: ${error.message}` };
  }
  let sent = 0;
  let failed = 0;
  for (const c of (data ?? []) as Candidate[]) {
    const unsubUrl = await unsubscribeUrl(c.user_id);
    const messageId = await sendViaResend(c.email, subject, render(firstNameOf(c.full_name), unsubUrl));
    // Failed sends log with status='failed' — the RPCs ignore those rows,
    // so tomorrow's run retries instead of permanently suppressing.
    await logEmailSend(supa, c.user_id, templateKey, subject, messageId);
    if (messageId) sent++; else failed++;
  }
  return { candidates: (data ?? []).length, sent, failed };
}

Deno.serve(async (req) => {
  const denied = requireCronKey(req, CRON_KEY);
  if (denied) return denied;

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const welcome = await runSweep(supa, "welcome_nudge_candidates", "welcome_nudge", WELCOME_SUBJECT, renderWelcome);
  const freeLimit = await runSweep(supa, "free_limit_candidates", "free_limit_nudge", FREE_LIMIT_SUBJECT, renderFreeLimit);
  const evalFollowup = await runSweep(supa, "eval_followup_candidates", "eval_followup", EVAL_FOLLOWUP_SUBJECT, renderEvalFollowup);
  // Sweep #4 emails SUBSCRIBERS — a different relationship than prospect
  // nudges (founder distinction, 2026-07-18: OK emailing users, undecided on
  // emailing paying customers). Dormant until ENABLE_SUBSCRIBER_NUDGES is
  // set to 'true' (function secret) and the function redeployed.
  const subscriberNudgesOn = Deno.env.get("ENABLE_SUBSCRIBER_NUDGES") === "true";
  const logging = subscriberNudgesOn
    ? await runSweep(supa, "logging_nudge_candidates", "logging_nudge", LOGGING_SUBJECT, renderLoggingNudge)
    : { candidates: 0, sent: 0, failed: 0 } as SweepResult;

  const results = { welcome, free_limit: freeLimit, eval_followup: evalFollowup, logging };
  const errors = Object.values(results).map((r) => r.error).filter(Boolean) as string[];

  // A broken sweep must be LOUD: alert the founder and return non-200 so the
  // failure is visible in cron run history, not just a console line.
  if (errors.length > 0) {
    await sendViaResend(
      ALERT_EMAIL,
      "Lifecycle sweep FAILED",
      emailWrap(`<p>One or more lifecycle sweeps errored today:</p><ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul><p>No emails go out from a broken sweep until this is fixed.</p>`),
    );
  }

  console.log(
    `[lifecycle-nudges] welcome: ${welcome.sent}/${welcome.candidates} sent` +
    ` | free_limit: ${freeLimit.sent}/${freeLimit.candidates} sent` +
    ` | eval_followup: ${evalFollowup.sent}/${evalFollowup.candidates} sent` +
    ` | logging: ${logging.sent}/${logging.candidates} sent` +
    (errors.length ? ` | ERRORS: ${errors.join("; ")}` : ""),
  );
  return new Response(JSON.stringify(results), {
    status: errors.length > 0 ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
