/**
 * checkout-emails — the abandoned-checkout email pair (July 2026 funnel work).
 *
 * Two sends, both born from the mrs.hart1122 incident (six live checkout
 * sessions, zero payment attempts — blocked at Stripe Link's "confirm it's
 * you" OTP wall):
 *
 *   1. Recovery email to the prospect — fired by stripe-webhook when a
 *      checkout.session.expired event lands (24h after the session opened).
 *      Includes the "Pay without Link" tip permanently.
 *   2. High-intent alert to the founder — fired by create-checkout the moment
 *      an identity opens its SECOND checkout within 24h. Same-day signal, not
 *      a day-late one.
 *
 * Sends ride the existing Resend integration (RESEND_API_KEY; the
 * admin-send-email pattern) and are logged to email_sends when the user is
 * known, so they show on the admin user detail page and dedup naturally.
 */

// deno-lint-ignore-file no-explicit-any

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("ADMIN_FROM_EMAIL") || "coach@thegainslab.com";
const ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL") || FROM_EMAIL;
const SENDER_NAME = "The Gains Lab";
const SITE = "https://www.thegainslab.com";

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

/** POST one email through Resend. Returns the message id, or null on failure
 *  (logged, never thrown — checkout emails are always best-effort). */
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

/** Log a send to email_sends (admin user page history + dedup). user_id is
 *  NOT NULL there, so account-less sends are simply not logged. */
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

const WRAP = (inner: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6">${inner}<p style="color:#9a9890;font-size:12px;margin-top:28px">The Gains Lab · <a href="${SITE}" style="color:#9a9890">${SITE.replace("https://", "")}</a></p></div>`;

/** The prospect-facing recovery email (checkout.session.expired). */
export function buildRecoveryEmail(plan: string): { subject: string; html: string } {
  const name = planName(plan);
  const subject = `Still thinking about ${name}?`;
  const html = WRAP(
    `<p>Hey — saw you were checking out <strong>${name}</strong> and didn't finish signing up. No pressure; just wanted to make sure nothing got in your way.</p>` +
    `<p>One thing that trips people up: if the payment page asks you to <em>"confirm it's you"</em> with a code sent to a phone number, that's Stripe's saved-info feature (Link) — not us. You can skip it entirely by clicking <strong>"Pay without Link"</strong> at the bottom of that box and entering your card normally.</p>` +
    `<p><a href="${SITE}/checkout" style="display:inline-block;background:#0074d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Pick up where you left off</a></p>` +
    `<p>Questions about the program? Just reply to this email — it comes straight to me.</p>`,
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
  const who = args.email ?? args.userId ?? "unknown";
  const plansLine = args.plans.map(planName).join(", ") || "unknown plan";
  const subject = `High-intent checkout: ${who} (${plansLine})`;
  const timelineLink = args.userId
    ? `<p><a href="${SITE}/admin/users/${args.userId}/timeline">Open their admin timeline →</a></p>`
    : "";
  const html = WRAP(
    `<p><strong>${who}</strong> has opened checkout <strong>${args.attemptCount}×</strong> in the last 24 hours without completing.</p>` +
    `<p>Plans viewed: ${plansLine}.</p>` +
    timelineLink +
    `<p style="color:#5a584f">This is the same-day window — a personal note converts better than the automated recovery email they'll get at the 24h mark.</p>`,
  );
  return { subject, html };
}

export { ALERT_EMAIL };
