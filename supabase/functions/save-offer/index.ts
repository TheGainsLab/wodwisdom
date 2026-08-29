/**
 * save-offer — the one-click(ish) cancellation-save flow (Aug '26).
 *
 * The founder manually emails users who scheduled a cancellation over price,
 * offering 20% off forever (Stripe coupon GAINS20 / g0E6izH8). This endpoint
 * powers the link he pastes into that personal note:
 *
 *   GET  ?u=<user_id>&t=<hmac>   → landing page: current price vs. 20%-off
 *                                  price, one "Keep my subscription" button.
 *                                  The GET never mutates anything — email
 *                                  security scanners follow links, so the
 *                                  mutation lives behind the POST.
 *   POST (form: u, t)            → the accept: cancel_at_period_end=false +
 *                                  coupon applied + metadata stamp, then the
 *                                  confirmation page. Idempotent — re-clicks
 *                                  re-show confirmation.
 *   POST (JSON {action:"mint", user_id}, admin JWT)
 *                                → { url } — the signed link, for the admin
 *                                  "Copy save-offer link" button.
 *
 * Token: HMAC-SHA256("save-offer:" + user_id) under LIFECYCLE_CRON_KEY —
 * same secret as unsubscribe links, distinct purpose prefix so the two token
 * families are not interchangeable.
 *
 * States: scheduled-cancel → offer; active-no-cancel → offer (clicking still
 * grants the promised discount even if they un-canceled via the portal
 * first); coupon already on the sub → "already active"; no live subscription
 * → "offer window has passed, reply to the email" (a lapsed user is a
 * different conversation, deliberately NOT an automated re-subscribe flow).
 *
 * Attribution: the accept stamps metadata.save_offer_accepted_at in the SAME
 * subscription update, so stripe-webhook's cancel-flip branch can tell a
 * link-accept from a portal un-cancel and skip its generic founder alert
 * (this function sends the richer one).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { ALERT_EMAIL, escapeHtml, sendViaResend } from "../_shared/checkout-emails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const TOKEN_SECRET = Deno.env.get("LIFECYCLE_CRON_KEY");

/** GAINS20 — 20% off, duration=forever, no redemption limit. Created in the
 *  Stripe dashboard Jun '26; the same coupon the founder applied by hand. */
const COUPON_ID = "g0E6izH8";
const DISCOUNT_PCT = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Token mint/verify (purpose-prefixed HMAC) ───────────────────────────────

async function mintToken(userId: string): Promise<string | null> {
  if (!TOKEN_SECRET) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`save-offer:${userId}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyToken(userId: string, token: string): Promise<boolean> {
  const expected = await mintToken(userId);
  if (!expected || expected.length !== token.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return r === 0;
}

// ── Stripe helpers (raw REST, same pattern as create-portal-session) ────────

async function stripeGet(path: string): Promise<Record<string, unknown>> {
  const resp = await fetchWithTimeout(`https://api.stripe.com/v1/${path}`, {
    headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
  }, 15_000);
  return await resp.json();
}

async function stripePost(path: string, params: URLSearchParams): Promise<Record<string, unknown>> {
  const resp = await fetchWithTimeout(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  }, 15_000);
  return await resp.json();
}

interface SubView {
  id: string;
  cancelScheduled: boolean;
  hasCoupon: boolean;
  amountCents: number;
  currency: string;
  interval: string;
}

/** The user's live subscription, or null (lapsed / never subscribed). Prefers
 *  a scheduled-cancel sub, then any live one. THROWS on a Stripe API error —
 *  the caller renders the error page, never the lapsed page, so an API
 *  problem can't silently read as "your subscription ended". (v1 expanded
 *  data.discounts in the list call; older pinned API versions reject that
 *  expansion, which surfaced as exactly that misread.) */
async function findLiveSubscription(customerId: string): Promise<SubView | null> {
  const res = await stripeGet(`subscriptions?customer=${customerId}&status=all&limit=10`);
  if ((res as { error?: { message?: string } }).error) {
    throw new Error(`Stripe subscriptions list failed: ${(res as { error?: { message?: string } }).error?.message ?? "unknown"}`);
  }
  const subs = (res.data ?? []) as Array<Record<string, unknown>>;
  const LIVE = new Set(["active", "trialing", "past_due"]);
  const live = subs.filter((s) => LIVE.has(s.status as string));
  if (live.length === 0) return null;
  const pick = live.find((s) => s.cancel_at_period_end === true) ?? live[0];

  // Coupon check, tolerant of every API-version shape: legacy single
  // `discount` object; `discounts` as objects; `discounts` as id strings
  // (retrieve-with-expand inside a try — if THAT fails, assume no coupon:
  // worst case we re-apply the same coupon, which is a no-op in effect).
  let hasCoupon = false;
  const legacy = pick.discount as Record<string, unknown> | null | undefined;
  if ((legacy?.coupon as Record<string, unknown> | undefined)?.id === COUPON_ID) hasCoupon = true;
  const discounts = (pick.discounts ?? []) as Array<Record<string, unknown> | string>;
  if (!hasCoupon && discounts.length > 0) {
    if (typeof discounts[0] === "object") {
      hasCoupon = discounts.some((d) =>
        typeof d === "object" && (d.coupon as Record<string, unknown> | undefined)?.id === COUPON_ID
      );
    } else {
      try {
        const full = await stripeGet(`subscriptions/${pick.id}?expand[]=discounts`);
        const fullDiscounts = (full.discounts ?? []) as Array<Record<string, unknown>>;
        hasCoupon = fullDiscounts.some((d) => (d?.coupon as Record<string, unknown> | undefined)?.id === COUPON_ID);
      } catch {
        hasCoupon = false;
      }
    }
  }

  const items = ((pick.items as Record<string, unknown> | undefined)?.data ?? []) as Array<Record<string, unknown>>;
  let amountCents = 0;
  let interval = "month";
  let currency = (pick.currency as string) ?? "usd";
  for (const it of items) {
    const price = it.price as Record<string, unknown> | undefined;
    const unit = (price?.unit_amount as number | null) ?? 0;
    const qty = (it.quantity as number | null) ?? 1;
    amountCents += unit * qty;
    const rec = price?.recurring as Record<string, unknown> | undefined;
    if (rec?.interval) interval = rec.interval as string;
    if (price?.currency) currency = price.currency as string;
  }

  return {
    id: pick.id as string,
    cancelScheduled: pick.cancel_at_period_end === true,
    hasCoupon,
    amountCents,
    currency,
    interval,
  };
}

function fmtMoney(cents: number, currency: string): string {
  const sym = currency === "usd" ? "$" : `${currency.toUpperCase()} `;
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ── Pages ───────────────────────────────────────────────────────────────────

function page(title: string, inner: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${title}</title></head>` +
    `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 24px;color:#1a1a1a;text-align:center">` +
    `<div style="font-weight:800;letter-spacing:1px;font-size:14px;color:#5a584f;margin-bottom:28px">THE GAINS LAB</div>` +
    inner +
    `</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

const p = (s: string) => `<p style="color:#5a584f;line-height:1.6">${s}</p>`;

function offerPage(sub: SubView, userId: string, token: string): Response {
  const now = fmtMoney(sub.amountCents, sub.currency);
  const discounted = fmtMoney(Math.round(sub.amountCents * (100 - DISCOUNT_PCT) / 100), sub.currency);
  const per = `/${sub.interval}`;
  const situation = sub.cancelScheduled
    ? `Your subscription is currently set to cancel at the end of this billing period.`
    : `Your subscription is active.`;
  const action = sub.cancelScheduled
    ? `Click below to keep your subscription and lock in <strong>${DISCOUNT_PCT}% off, permanently</strong>.`
    : `Click below to lock in the <strong>${DISCOUNT_PCT}% off, permanently</strong>, as offered.`;
  return page(
    "Your offer from The Gains Lab",
    `<h2 style="margin-bottom:8px">Stay at ${DISCOUNT_PCT}% off — forever</h2>` +
    p(situation) +
    p(`${action}`) +
    `<div style="margin:24px 0;font-size:18px"><span style="text-decoration:line-through;color:#9a9890">${now}${per}</span>` +
    ` &nbsp;→&nbsp; <strong>${discounted}${per}</strong></div>` +
    `<form method="POST" action="">` +
    `<input type="hidden" name="u" value="${escapeHtml(userId)}">` +
    `<input type="hidden" name="t" value="${escapeHtml(token)}">` +
    `<button type="submit" style="background:#0074d4;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Keep my subscription</button>` +
    `</form>` +
    p(`<span style="font-size:12px">The discount applies from your next invoice and never expires. Questions? Just reply to the email.</span>`),
  );
}

function confirmationPage(sub: SubView): Response {
  const discounted = fmtMoney(Math.round(sub.amountCents * (100 - DISCOUNT_PCT) / 100), sub.currency);
  return page(
    "You're all set",
    `<h2 style="margin-bottom:8px">You're all set 🎉</h2>` +
    p(`Your subscription continues at <strong>${discounted}/${sub.interval}</strong> — ${DISCOUNT_PCT}% off, permanently, starting with your next invoice.`) +
    p(`Glad you're staying. See you in the gym.`),
  );
}

function alreadyPage(sub: SubView): Response {
  const discounted = fmtMoney(Math.round(sub.amountCents * (100 - DISCOUNT_PCT) / 100), sub.currency);
  return page(
    "Discount already active",
    `<h2 style="margin-bottom:8px">Your discount is already active</h2>` +
    p(`Your subscription continues at <strong>${discounted}/${sub.interval}</strong> — nothing more to do.`),
  );
}

function lapsedPage(): Response {
  return page(
    "This offer window has passed",
    `<h2 style="margin-bottom:8px">This offer window has passed</h2>` +
    p(`Your subscription has already ended, so this link can't restore it automatically. Reply to the email and we'll sort you out directly.`),
  );
}

function invalidPage(): Response {
  return page(
    "Invalid link",
    `<h2 style="margin-bottom:8px">This link didn't check out</h2>` +
    p(`The link is incomplete or expired. Reply to the email and we'll take care of it by hand.`),
    403,
  );
}

function errorPage(): Response {
  return page(
    "Something went wrong",
    `<h2 style="margin-bottom:8px">Something went wrong</h2>` +
    p(`We couldn't process that just now. Reply to the email and we'll apply the offer by hand.`),
    500,
  );
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const url = new URL(req.url);

  // ── Admin mint route (JSON POST with a user JWT) ──────────────────────────
  if (req.method === "POST" && (req.headers.get("Content-Type") ?? "").includes("application/json")) {
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.action !== "mint" || !UUID_RE.test(body?.user_id ?? "")) {
        return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const authHeader = req.headers.get("Authorization") ?? "";
      const { data: { user } } = await supa.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      const { data: me } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (me?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Not authorized" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const token = await mintToken(body.user_id);
      if (!token) return new Response(JSON.stringify({ error: "Signing secret not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      return new Response(
        JSON.stringify({ url: `${SUPABASE_URL}/functions/v1/save-offer?u=${body.user_id}&t=${token}` }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    } catch (e) {
      console.error("[save-offer] mint failed:", e);
      return new Response(JSON.stringify({ error: "Mint failed" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
  }

  // ── Public link routes (GET = landing page, form POST = accept) ───────────
  let userId = url.searchParams.get("u") ?? "";
  let token = url.searchParams.get("t") ?? "";
  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    userId = (form?.get("u") as string | null) ?? userId;
    token = (form?.get("t") as string | null) ?? token;
  }
  if (!UUID_RE.test(userId) || !token || !(await verifyToken(userId, token))) return invalidPage();
  if (!STRIPE_SECRET_KEY) return errorPage();

  try {
    const { data: prof } = await supa
      .from("profiles")
      .select("email, full_name, stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();
    if (!prof?.stripe_customer_id) return lapsedPage();

    const sub = await findLiveSubscription(prof.stripe_customer_id);
    if (!sub) return lapsedPage();
    if (sub.hasCoupon && !sub.cancelScheduled) return alreadyPage(sub);

    if (req.method === "GET") return offerPage(sub, userId, token);

    // ── Accept (form POST): un-cancel + coupon + attribution stamp, one call.
    const params = new URLSearchParams();
    params.set("cancel_at_period_end", "false");
    if (!sub.hasCoupon) params.set("coupon", COUPON_ID);
    params.set("metadata[save_offer_accepted_at]", new Date().toISOString());
    const updated = await stripePost(`subscriptions/${sub.id}`, params);
    if ((updated as { error?: { message?: string } }).error) {
      console.error("[save-offer] subscription update failed:", (updated as { error?: unknown }).error);
      return errorPage();
    }

    // Founder alert — the rich, attributed one (stripe-webhook sees the
    // metadata stamp in the same event and skips its generic save alert).
    const who = prof.full_name ? `${prof.full_name} (${prof.email ?? userId})` : (prof.email ?? userId);
    const discounted = fmtMoney(Math.round(sub.amountCents * (100 - DISCOUNT_PCT) / 100), sub.currency);
    try {
      await sendViaResend(
        ALERT_EMAIL,
        `Save offer ACCEPTED: ${prof.email ?? userId}`,
        `<p><strong>${escapeHtml(who)}</strong> clicked the save link and kept their subscription.</p>` +
        `<p>${sub.cancelScheduled ? "Cancellation removed and " : "Subscription was already active; "}` +
        `${DISCOUNT_PCT}% coupon applied — new price <strong>${discounted}/${sub.interval}</strong>, forever.</p>` +
        `<p><a href="https://www.thegainslab.com/admin/users/${userId}">Open their admin page →</a></p>`,
      );
    } catch (e) {
      console.error("[save-offer] acceptance alert failed (non-fatal):", e);
    }

    console.log(`[save-offer] accepted: user=${userId} sub=${sub.id} cancelWasScheduled=${sub.cancelScheduled} couponApplied=${!sub.hasCoupon}`);
    return confirmationPage(sub);
  } catch (e) {
    console.error("[save-offer] failed:", e);
    return errorPage();
  }
});
