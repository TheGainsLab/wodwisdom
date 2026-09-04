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
  escapeHtml,
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
    `<p><strong>Your Athlete History</strong> — Done the Open? ${emailLink("/athletedata", "Link your history", "welcome_nudge")} for a detailed breakdown of your performance. Retest, or try new workouts. No history? Every workout and every data feature is still yours. Start building a history!</p>` +
    `<p><strong>Your Free Fitness Evaluation</strong> — ${emailLink("/profile", "Complete your profile", "welcome_nudge")} (5 minutes) and our AI candidly analyzes your fitness: strengths, weaknesses, and training priorities. It's yours to keep — share it with your coach or build your next training block on it.</p>` +
    `<p><strong>AI Coach</strong> — ${emailLink("/chat", "3 free questions", "welcome_nudge")}, answered by an AI trained on our methodology. Complete your profile and evaluation first and the answers get personal.</p>` +
    `<p>All of that is free, already available in your account.</p>` +
    `<p><strong>When you want more:</strong> ${emailLink("/features/engine", "Year of the Engine", "welcome_nudge")} gives you 8 conditioning programs with personalized targets every training day and analytics we believe no other platform matches. ${emailLink("/features/programs", "AI Programming", "welcome_nudge")} builds fully individualized training — every block, warmup to cooldown — and evolves monthly based on what you actually log. Like a high-level coach, at a fraction of the price. Both include the AI Coach and full nutrition tracking.</p>` +
    emailButton("/profile", "Start with the evaluation — 5 minutes", "welcome_nudge") +
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
    `<p>Here's the thing about this coach: its answers are only as good as what it knows about <em>you</em>. ${emailLink("/profile", "Complete your profile and free evaluation", "free_limit_nudge")}, and it stops giving general advice — it answers with your lifts, your conditioning, and your goals in the room.</p>` +
    `<p>And inside a training plan, it sees everything: your program, your baselines, today's session. Ask "how should I pace this?" and it's talking about <em>your</em> workout — pacing computed from <em>your</em> time trial — not a generic template. That's the version of the Coach no general-purpose AI can be.</p>` +
    `<p><strong>${emailLink("/features/engine", "Year of the Engine", "free_limit_nudge")}</strong> or <strong>${emailLink("/features/programs", "AI Programming", "free_limit_nudge")}</strong> — $29.99/mo each, both with the unlimited Coach and full nutrition tracking included.</p>` +
    `<p style="font-size:13px;color:#5a584f">(Just want unlimited questions with your profile, without a program? The ${emailLink("/features/coaching", "standalone Coach", "free_limit_nudge")} is $7.99/mo.)</p>` +
    `<p>Whatever you asked about this week — that's exactly the kind of thing it's built for, every day.</p>` +
    emailButton("/features", "See the plans", "free_limit_nudge") +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

// ── Sweep 3: evaluation follow-up ───────────────────────────────────────────

const EVAL_FOLLOWUP_SUBJECT = "Your evaluation, and what to do with it";

/**
 * Shared bottom half of both eval follow-up variants (founder copy, Sep '26).
 * One committed frame — your info + your goals → the program — instead of the
 * old three-symmetric-doors pitch; each product name deep-links to its
 * pre-selected checkout (/checkout?plan=... auto-opens the purchase flow for
 * the signed-in account these recipients all have); the button stays neutral
 * for the undecided.
 */
function evalFollowupWaysForward(): string {
  return (
    `<p>An assessment you don't act on is just interesting reading. The real value comes when we combine what we know about you with what you want to accomplish.</p>` +
    `<p>There are a few ways forward:</p>` +
    `<p><strong>${emailLink("/checkout?plan=programming", "AI Programming", "eval_followup")}</strong> builds your full program around your evaluation and your goals — strength, skills, accessories and MetCons, plus personalized warmups, cooldowns and mobility. AI Coach is there throughout to guide your training.</p>` +
    `<p><strong>${emailLink("/checkout?plan=engine", "Year of the Engine", "eval_followup")}</strong> is for athletes who want to focus on conditioning. Choose from 8 different programs based on your goals and schedule, then the AI personalizes the path within that program based on your strengths and weaknesses. Your targets are calibrated to you and recalibrated as you improve.</p>` +
    `<p><strong>${emailLink("/checkout?plan=all_access", "All Access", "eval_followup")}</strong> combines both — complete programming plus Year of the Engine — our most comprehensive personalized training, at around the same price as most group programs.</p>` +
    `<p>The evaluation tells us where you are. You tell us where you want to go. We build the training between the two.</p>` +
    // Deliberately NOT a button: the product links above are the primary
    // CTAs (straight into pre-selected checkout), and a button here would
    // out-click them. This is the fallback for the undecided — quiet, and
    // it funnels back to a page whose whole job is CTAs.
    `<p style="font-size:13px;color:#5a584f">Still deciding? ${emailLink("/features", "Learn more about each program", "eval_followup")}.</p>` +
    `<p>-Matt</p>`
  );
}

function renderEvalFollowup(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>A few days ago our AI took an honest look at your fitness — your lifting, your skills, and your engine. ${emailLink("/profile", "It's still there in your account", "eval_followup")} whenever you want to re-read it.</p>` +
    evalFollowupWaysForward(),
    { unsubUrl },
  );
}

// Eval-aware variant: quotes the athlete's own evaluation back at them —
// the headline verdict and the top priority — so the email reads as a coach
// following up on a real assessment, not a template. Falls back to the
// generic render when the structured evaluation isn't available.
function renderEvalFollowupAware(
  firstName: string | null,
  unsubUrl: string | null,
  headline: string,
  topPriority: string | null,
): string {
  const priorityBlock = topPriority
    ? `<p>And the highest-return work it found:</p>` +
      `<p style="border-left:3px solid #ccc;padding-left:12px;color:#5a584f">${escapeHtml(topPriority)}</p>`
    : "";
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>A few days ago our AI took an honest look at your fitness — your lifting, your skills, and your engine. Here's the one-line verdict it reached:</p>` +
    `<p style="border-left:3px solid #ccc;padding-left:12px;color:#5a584f"><strong>${escapeHtml(headline)}</strong></p>` +
    priorityBlock +
    evalFollowupWaysForward(),
    { unsubUrl },
  );
}

/** First 1–2 sentences of a coach-prose bullet, capped so the email quote
 *  stays a quote and not a reprint. */
function excerptSentences(text: string, maxChars = 240): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > maxChars) break;
    out = out ? out + " " + s : s;
    if (out.length > maxChars) break;
  }
  return out || text.slice(0, maxChars);
}

/** Eval follow-up sweep: same candidates RPC + guards as the other sweeps,
 *  but each send is personalized from the lead's own evaluation. */
async function runEvalFollowupSweep(supa: SupabaseClient): Promise<SweepResult> {
  const { data, error } = await supa.rpc("eval_followup_candidates", { p_limit: 25 });
  if (error) {
    console.error(`[lifecycle-nudges] eval_followup_candidates failed:`, error);
    return { candidates: 0, sent: 0, failed: 0, error: `eval_followup_candidates: ${error.message}` };
  }
  let sent = 0;
  let failed = 0;
  for (const c of (data ?? []) as Candidate[]) {
    const { data: evalRow } = await supa
      .from("profile_evaluations")
      .select("structured_evaluation")
      .eq("user_id", c.user_id)
      .eq("status", "complete")
      .eq("initiated_by", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const se = (evalRow?.structured_evaluation ?? null) as
      | { headline_takeaway?: string; weaknesses_and_priorities?: string[] }
      | null;
    const headline = se?.headline_takeaway?.trim() || null;
    const topPriority = se?.weaknesses_and_priorities?.[0]
      ? excerptSentences(se.weaknesses_and_priorities[0])
      : null;

    const unsubUrl = await unsubscribeUrl(c.user_id);
    const html = headline
      ? renderEvalFollowupAware(firstNameOf(c.full_name), unsubUrl, headline, topPriority)
      : renderEvalFollowup(firstNameOf(c.full_name), unsubUrl);
    const messageId = await sendViaResend(c.email, EVAL_FOLLOWUP_SUBJECT, html);
    await logEmailSend(supa, c.user_id, "eval_followup", EVAL_FOLLOWUP_SUBJECT, messageId);
    if (messageId) sent++; else failed++;
  }
  return { candidates: (data ?? []).length, sent, failed };
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
    emailButton("/training-log", "Log your last session", "logging_nudge") +
    `<p>And if something about logging is slowing you down — too many steps, wrong units, anything — reply and tell me. I'll fix it.</p>` +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

// ── Sweeps 5+6: returner resume nudges ──────────────────────────────────────
// A re-subscriber's next month is PAUSED until they review their numbers (the
// stripe webhook sets programming_resume_pending_at; the Athlete page shows
// the Build button). These are service messages about a paid deliverable —
// "your month is waiting on your tap" — not marketing, so they run
// unconditionally (no ENABLE_SUBSCRIBER_NUDGES gate). Day 2 and day 5; the
// reconciler auto-builds at day 7 regardless.

const RESUME_1_SUBJECT = "Your next month is ready to build";

function renderResume1(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>Welcome back — great to have you training with us again.</p>` +
    `<p>One thing before your next month gets built: it's generated from your numbers, and yours have been sitting untouched since you were last here. Two minutes to ${emailLink("/profile", "review them", "resume_nudge_1")} — update anything that changed, confirm what didn't — then hit <strong>Build my next month</strong> and your program is minutes away.</p>` +
    emailButton("/profile", "Review my numbers & build", "resume_nudge_1") +
    `<p>If everything's still accurate, it's literally one tap.</p>` +
    `<p>-Matt</p>`,
    { unsubUrl },
  );
}

const RESUME_2_SUBJECT = "Still holding your month — one tap to build it";

function renderResume2(firstName: string | null, unsubUrl: string | null): string {
  return emailWrap(
    `<p>${hi(firstName)}</p>` +
    `<p>Your next training month is paid for and waiting — I just don't want to build it from stale numbers. ${emailLink("/profile", "Take a quick look at your profile", "resume_nudge_2")}, adjust anything that changed while you were away, and tap <strong>Build my next month</strong>.</p>` +
    emailButton("/profile", "Build my next month", "resume_nudge_2") +
    `<p>If I don't hear from you in the next couple of days I'll build it from what's on file, so you don't lose the month either way — but it'll be better if you look first.</p>` +
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
  rpcArgs: Record<string, unknown> = {},
): Promise<SweepResult> {
  const { data, error } = await supa.rpc(rpc, { p_limit: 25, ...rpcArgs });
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
  const evalFollowup = await runEvalFollowupSweep(supa);
  // Sweep #4 emails SUBSCRIBERS — a different relationship than prospect
  // nudges (founder distinction, 2026-07-18: OK emailing users, undecided on
  // emailing paying customers). Dormant until ENABLE_SUBSCRIBER_NUDGES is
  // set to 'true' (function secret) and the function redeployed.
  const subscriberNudgesOn = Deno.env.get("ENABLE_SUBSCRIBER_NUDGES") === "true";
  const logging = subscriberNudgesOn
    ? await runSweep(supa, "logging_nudge_candidates", "logging_nudge", LOGGING_SUBJECT, renderLoggingNudge)
    : { candidates: 0, sent: 0, failed: 0 } as SweepResult;
  const resume1 = await runSweep(supa, "resume_nudge_candidates", "resume_nudge_1", RESUME_1_SUBJECT, renderResume1,
    { p_template_key: "resume_nudge_1", p_min_days: 2 });
  const resume2 = await runSweep(supa, "resume_nudge_candidates", "resume_nudge_2", RESUME_2_SUBJECT, renderResume2,
    { p_template_key: "resume_nudge_2", p_min_days: 5 });

  const results = { welcome, free_limit: freeLimit, eval_followup: evalFollowup, logging, resume_1: resume1, resume_2: resume2 };
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
