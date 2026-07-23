/**
 * checkout-emails — shared outbound-email infrastructure (July '26).
 *
 * Grew from the abandoned-checkout pair (recovery email + founder alert)
 * into the shared module every automated sender uses: the Resend send +
 * email_sends logging, the HTML chrome (wrap/link/button), escaping,
 * first-name extraction, and the CAN-SPAM footer (postal address +
 * per-recipient unsubscribe link backed by an HMAC token the
 * email-unsubscribe endpoint verifies).
 *
 * Senders: stripe-webhook (recovery), create-checkout (founder alert),
 * lifecycle-nudges (welcome / free-limit / eval sweeps), weekly-digest.
 */

// deno-lint-ignore-file no-explicit-any

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("ADMIN_FROM_EMAIL") || "coach@thegainslab.com";
const ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL") || FROM_EMAIL;
const SENDER_NAME = "The Gains Lab";
export const SITE = "https://www.thegainslab.com";

// CAN-SPAM requires a physical postal address in commercial email. Set the
// BUSINESS_POSTAL_ADDRESS function secret to the real address (PO box or
// registered-agent address is fine).
const POSTAL_ADDRESS = Deno.env.get("BUSINESS_POSTAL_ADDRESS") || "The Gains Lab, United States";

// Unsubscribe tokens: HMAC-SHA256(user_id) under LIFECYCLE_CRON_KEY (the
// lifecycle secret doubles as the signing key — one secret to manage). If
// the secret is unset, links can't be minted and senders omit them.
const UNSUB_SECRET = Deno.env.get("LIFECYCLE_CRON_KEY");

export const PLAN_NAMES: Record<string, string> = {
  coach: "AI Coach",
  nutrition: "AI Nutrition",
  coach_nutrition: "AI Coach + Nutrition",
  programming: "AI Programming",
  engine: "AI Year of the Engine",
  all_access: "All Access",
};

export function planName(plan: string | null | undefined): string {
  return (plan && PLAN_NAMES[plan]) || plan || "your plan";
}

// Recovery links go to the plan's FEATURE page, not /checkout — the checkout
// route needs a signed-in session, and recovery clicks usually arrive in an
// email client's browser with no session. Feature pages sell the plan AND
// check out anonymously; the webhook matches the purchase back by email.
const PLAN_LINKS: Record<string, string> = {
  coach: "/features/coaching",
  nutrition: "/features/nutrition",
  coach_nutrition: "/features/nutrition",
  programming: "/features/programs",
  engine: "/features/engine",
  all_access: "/features",
};

export function planLink(plan: string | null | undefined): string {
  return SITE + ((plan && PLAN_LINKS[plan]) || "/features");
}

// ── Escaping & names ────────────────────────────────────────────────────────

/** Escape user-controlled strings before interpolating into email HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First name from a full_name, HTML-escaped; null when unusable. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? escapeHtml(first) : null;
}

// ── HMAC unsubscribe tokens ─────────────────────────────────────────────────

async function hmacHex(value: string): Promise<string | null> {
  if (!UNSUB_SECRET) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(UNSUB_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-recipient unsubscribe URL, or null when no user / no secret. */
export async function unsubscribeUrl(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const token = await hmacHex(userId);
  if (!token) return null;
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) return null;
  return `${base}/functions/v1/email-unsubscribe?u=${userId}&t=${token}`;
}

/** Verify an unsubscribe token minted by unsubscribeUrl. */
export async function verifyUnsubscribeToken(userId: string, token: string): Promise<boolean> {
  const expected = await hmacHex(userId);
  if (!expected || expected.length !== token.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return r === 0;
}

// ── HTML chrome ─────────────────────────────────────────────────────────────

/** UTM-tag a site path so clicks (and any signup/purchase they lead to)
 *  attribute back to the specific email template that sent them. */
export function tagged(path: string, campaign: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${SITE}${path}${sep}utm_source=gainslab_email&utm_medium=email&utm_campaign=${campaign}`;
}

export const emailLink = (path: string, label: string, campaign = "email") =>
  `<a href="${tagged(path, campaign)}" style="color:#0074d4;text-decoration:none;font-weight:600">${label}</a>`;

export const emailButton = (path: string, label: string, campaign = "email") =>
  `<p><a href="${tagged(path, campaign)}" style="display:inline-block;background:#0074d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;

/**
 * The shared email shell: brand footer with the CAN-SPAM postal address and,
 * when provided, the recipient's unsubscribe link.
 */
export function emailWrap(inner: string, opts: { unsubUrl?: string | null; maxWidth?: number } = {}): string {
  const width = opts.maxWidth ?? 560;
  const unsub = opts.unsubUrl
    ? ` · <a href="${opts.unsubUrl}" style="color:#9a9890">unsubscribe</a>`
    : "";
  return (
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:${width}px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6">` +
    inner +
    `<p style="color:#9a9890;font-size:12px;margin-top:28px">${SENDER_NAME} · <a href="${SITE}" style="color:#9a9890">${SITE.replace("https://", "")}</a>${unsub}<br>${escapeHtml(POSTAL_ADDRESS)}</p>` +
    `</div>`
  );
}

// ── Send + log ──────────────────────────────────────────────────────────────

/** POST one email through Resend. Returns the message id, or null on failure
 *  (logged, never thrown — automated emails are always best-effort). */
export async function sendViaResend(
  to: string,
  subject: string,
  html: string,
): Promise<string | null> {
  if (!RESEND_API_KEY) {
    console.error("[checkout-emails] RESEND_API_KEY not configured; skipping send");
    return null;
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SENDER_NAME} <${FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
        reply_to: FROM_EMAIL,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error("[checkout-emails] Resend error:", err);
      return null;
    }
    const data = await resp.json();
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error("[checkout-emails] Resend call failed:", e);
    return null;
  }
}

/** Log a send to email_sends (admin user page history, timeline, dedup).
 *  user_id is NOT NULL there, so account-less sends are simply not logged.
 *  Failed sends log with status='failed' — candidate RPCs ignore those rows,
 *  so a transient failure retries on the next run instead of suppressing. */
export async function logEmailSend(
  supa: any,
  userId: string | null,
  templateKey: string,
  subject: string,
  messageId: string | null,
): Promise<void> {
  if (!userId) return;
  try {
    await supa.from("email_sends").insert({
      user_id: userId,
      template_key: templateKey,
      subject,
      resend_message_id: messageId,
      status: messageId ? "sent" : "failed",
    });
  } catch (e) {
    console.error("[checkout-emails] email_sends log failed:", e);
  }
}

// ── The checkout emails themselves ──────────────────────────────────────────

/** The prospect-facing recovery email (checkout.session.expired). */
export function buildRecoveryEmail(plan: string, unsubUrl: string | null = null): { subject: string; html: string } {
  const name = planName(plan);
  const subject = `Still thinking about ${name}?`;
  const html = emailWrap(
    `<p>Hey — saw you were checking out <strong>${name}</strong> and didn't finish signing up. No pressure; just wanted to make sure nothing got in your way.</p>` +
    `<p>One thing that trips people up: if the payment page asks you to <em>"confirm it's you"</em> with a code sent to a phone number, that's Stripe's saved-info feature (Link) — not us. You can skip it entirely by clicking <strong>"Pay without Link"</strong> at the bottom of that box and entering your card normally.</p>` +
    `<p><a href="${planLink(plan)}?utm_source=gainslab_email&utm_medium=email&utm_campaign=checkout_recovery" style="display:inline-block;background:#0074d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Pick up where you left off</a></p>` +
    `<p>Questions about the program? Just reply to this email — it comes straight to me.</p>`,
    { unsubUrl },
  );
  return { subject, html };
}

// ── Cancellation lifecycle emails (July '26) ────────────────────────────────
// Transactional account-state emails — sent by stripe-webhook at the two
// cancellation moments (scheduled / effective). No unsubscribe link: these
// confirm account changes, they don't market. All copy founder-approved.

const CANCEL_REPLY_LINE = `<p>Changed your mind, or something we could've done better? Just reply. We read all incoming emails.</p>`;

function greeting(fullName: string | null | undefined): string {
  const first = firstNameOf(fullName);
  return `<p>Hi ${first ?? "there"},</p>`;
}

function fmtDateSec(sec: number | null | undefined): string | null {
  if (typeof sec !== "number" || !isFinite(sec)) return null;
  return new Date(sec * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Ack when a cancellation is scheduled (cancel_at_period_end flips true). */
export function buildCancelScheduledEmail(args: {
  fullName: string | null;
  plan: string | null;
  lapseSec: number | null;
}): { subject: string; html: string } {
  const lapse = fmtDateSec(args.lapseSec);
  const subject = lapse ? `Your cancellation is set for ${lapse}` : "Your cancellation is scheduled";
  const html = emailWrap(
    greeting(args.fullName) +
    `<p>Confirming: your subscription is set to end${lapse ? ` on <strong>${lapse}</strong>` : " at the end of your billing period"}, and you won't be charged again. Until then, nothing changes — you have full access, so every training day between now and then is yours.</p>` +
    `<p>After that, your account stays put: your training history, PRs, and program position are all saved. If you ever come back, you'll pick up exactly where you left off — not from zero.</p>` +
    CANCEL_REPLY_LINE,
  );
  return { subject, html };
}

/** Confirmation when a scheduled cancellation is removed. */
export function buildCancelUnscheduledEmail(args: { fullName: string | null }): { subject: string; html: string } {
  const subject = "Your cancellation has been removed";
  const html = emailWrap(
    greeting(args.fullName) +
    `<p>Good news made official: your scheduled cancellation has been removed and your subscription continues as normal. Glad you're staying.</p>` +
    `<p>If anything prompted the wobble, we'd genuinely like to hear it — just reply. We read all incoming emails.</p>`,
  );
  return { subject, html };
}

/** Goodbye when the subscription actually ends. Two forks: voluntary
 *  (they scheduled it) vs involuntary (dunning exhausted → auto-cancel). */
export function buildGoodbyeEmail(args: {
  fullName: string | null;
  plan: string | null;
  involuntary: boolean;
}): { subject: string; html: string } {
  const link = `${planLink(args.plan)}?utm_source=gainslab_email&utm_medium=email&utm_campaign=${args.involuntary ? "card_failed_comeback" : "goodbye_comeback"}`;
  const button = `<p><a href="${link}" style="display:inline-block;background:#0074d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${args.involuntary ? "Resubscribe and pick up where you left off" : "Come back anytime"}</a></p>`;
  if (args.involuntary) {
    const subject = "Your card declined — your progress is safe";
    const html = emailWrap(
      greeting(args.fullName) +
      `<p>Your renewal didn't go through — the card on file was declined and the automatic retries couldn't recover it, so your access paused today. That's the only thing that happened; nothing was lost.</p>` +
      `<p>Your training history, PRs, and program position are all saved. Resubscribe with a working card and you're back at your next training day the moment it goes through:</p>` +
      button +
      `<p>If the decline looks wrong on your end, just reply. We read all incoming emails.</p>`,
    );
    return { subject, html };
  }
  const subject = "Your subscription has ended — your progress hasn't";
  const html = emailWrap(
    greeting(args.fullName) +
    `<p>Your subscription wrapped up today, as scheduled. Thanks for training with us.</p>` +
    `<p>Everything you built is saved on your account — history, PRs, and your spot in the program. If you return next month or next year, you'll start from where you actually are, not from day 1.</p>` +
    `<p>The door's open anytime:</p>` +
    button,
  );
  return { subject, html };
}

/** The founder-facing high-intent alert (2nd checkout open within 24h). */
export function buildIntentAlertEmail(args: {
  email: string | null;
  userId: string | null;
  plans: string[];
  attemptCount: number;
}): { subject: string; html: string } {
  const who = args.email ? escapeHtml(args.email) : (args.userId ?? "unknown");
  const plansLine = args.plans.map(planName).map(escapeHtml).join(", ") || "unknown plan";
  const subject = `High-intent checkout: ${args.email ?? args.userId ?? "unknown"} (${args.plans.map(planName).join(", ") || "unknown plan"})`;
  const timelineLink = args.userId
    ? `<p><a href="${SITE}/admin/users/${args.userId}/timeline">Open their admin timeline →</a></p>`
    : "";
  const html = emailWrap(
    `<p><strong>${who}</strong> has opened checkout <strong>${args.attemptCount}×</strong> in the last 24 hours without completing.</p>` +
    `<p>Plans viewed: ${plansLine}.</p>` +
    timelineLink +
    `<p style="color:#5a584f">This is the same-day window — a personal note converts better than the automated recovery email they'll get at the 24h mark.</p>`,
  );
  return { subject, html };
}

export { ALERT_EMAIL };
