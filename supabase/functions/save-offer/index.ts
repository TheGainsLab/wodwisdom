/**
 * save-offer — the cancellation-save flow (Aug '26, rebuilt).
 *
 * The founder manually emails users who scheduled a cancellation, offering
 * 20% off forever. The link in that email is an app page
 * (www.thegainslab.com/stay?u=..&t=..); this function is its JSON API.
 *
 * PRICE-AGNOSTIC CONTRACT (the founder's rule): the offer is 20% off
 * WHATEVER THE USER ACTUALLY PAYS — list price, $11.11, $3.00 after some
 * other coupon, anything. Therefore:
 *   - No amount in this file is ever derived from a price/plan object.
 *     The displayed "current" number is Stripe's upcoming-invoice total —
 *     the real next bill, existing discounts included.
 *   - The accept ADDS the GAINS20 coupon to the subscription's existing
 *     discounts (full-list write: existing + GAINS20). It never replaces
 *     or removes a discount (v1 used the `coupon` param, which REPLACED a
 *     user's better coupon and RAISED their price — the cardinal sin).
 *   - After the write, the new upcoming-invoice total is re-read from
 *     Stripe and VERIFIED lower than before. If it is not, the original
 *     discount list is rolled back and the accept fails loudly. The code
 *     can only ever lower a price.
 *
 * Routes:
 *   POST json {action:"mint", user_id}  (admin JWT) → { url } app-domain link
 *   POST json {action:"status", u, t}   (link token) → read-only state+amounts
 *   POST json {action:"accept", u, t}   (link token) → the save (page button)
 *   anything else (GET/HEAD/old form POST) → 302 to the /stay page. No HTML
 *     is served from this function, and no non-JSON request can mutate.
 *
 * Token: HMAC-SHA256("save-offer:" + user_id) under LIFECYCLE_CRON_KEY.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { ALERT_EMAIL, escapeHtml, sendViaResend } from "../_shared/checkout-emails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const TOKEN_SECRET = Deno.env.get("LIFECYCLE_CRON_KEY");

const STAY_URL = "https://www.thegainslab.com/stay";

/** GAINS20 — 20% off, duration=forever, no redemption limit. */
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

// ── Stripe helpers ──────────────────────────────────────────────────────────

/** Per-request API version pin (the account default predates 2016 — verified
 *  live when `status=all` was rejected). */
const STRIPE_API_VERSION = "2023-10-16";

async function stripeGet(path: string): Promise<Record<string, unknown>> {
  const resp = await fetchWithTimeout(`https://api.stripe.com/v1/${path}`, {
    headers: {
      "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
      "Stripe-Version": STRIPE_API_VERSION,
    },
  }, 15_000);
  return await resp.json();
}

async function stripePost(path: string, params: URLSearchParams): Promise<Record<string, unknown>> {
  const resp = await fetchWithTimeout(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":"),
      "Stripe-Version": STRIPE_API_VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  }, 15_000);
  return await resp.json();
}

interface SubView {
  id: string;
  cancelScheduled: boolean;
  /** GAINS20 already on the subscription. */
  hasCoupon: boolean;
  /** Existing discount ids (di_...), preserved verbatim on accept. */
  existingDiscountIds: string[];
  currency: string;
  interval: string;
}

/** The user's live subscription, or null (lapsed). Throws on Stripe error so
 *  an API problem can never masquerade as "your subscription ended". */
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

  // Collect existing discounts: ids for the preserve-on-write list, coupon
  // ids to detect GAINS20. Handles every shape this API version can return:
  // legacy single `discount` object, `discounts` as objects, or as id strings
  // (resolved via a retrieve-with-expand; if that fails we still have the
  // raw ids to preserve — only the GAINS20 check degrades, and the
  // verify-and-rollback guard below backstops it).
  const existingDiscountIds = new Set<string>();
  let hasCoupon = false;

  const legacy = pick.discount as Record<string, unknown> | null | undefined;
  if (legacy && typeof legacy.id === "string") {
    existingDiscountIds.add(legacy.id);
    if ((legacy.coupon as Record<string, unknown> | undefined)?.id === COUPON_ID) hasCoupon = true;
  }
  const rawDiscounts = (pick.discounts ?? []) as Array<Record<string, unknown> | string>;
  const stringIds = rawDiscounts.filter((d): d is string => typeof d === "string");
  for (const d of rawDiscounts) {
    if (typeof d === "object" && typeof d.id === "string") {
      existingDiscountIds.add(d.id);
      if ((d.coupon as Record<string, unknown> | undefined)?.id === COUPON_ID) hasCoupon = true;
    }
  }
  if (stringIds.length > 0) {
    for (const id of stringIds) existingDiscountIds.add(id);
    try {
      const full = await stripeGet(`subscriptions/${pick.id}?expand[]=discounts`);
      const fullDiscounts = (full.discounts ?? []) as Array<Record<string, unknown>>;
      for (const d of fullDiscounts) {
        if ((d?.coupon as Record<string, unknown> | undefined)?.id === COUPON_ID) hasCoupon = true;
      }
    } catch { /* ids preserved above; rollback guard covers the rest */ }
  }

  const items = ((pick.items as Record<string, unknown> | undefined)?.data ?? []) as Array<Record<string, unknown>>;
  const firstPrice = items[0]?.price as Record<string, unknown> | undefined;
  const interval = ((firstPrice?.recurring as Record<string, unknown> | undefined)?.interval as string) ?? "month";
  const currency = (firstPrice?.currency as string) ?? ((pick.currency as string) ?? "usd");

  return {
    id: pick.id as string,
    cancelScheduled: pick.cancel_at_period_end === true,
    hasCoupon,
    existingDiscountIds: [...existingDiscountIds],
    currency,
    interval,
  };
}

/** The REAL amount of the next bill, in cents — Stripe's upcoming invoice
 *  total, all current discounts included. The only source of displayed
 *  numbers. Throws on error. */
async function upcomingTotal(customerId: string, subscriptionId: string): Promise<number> {
  const res = await stripeGet(`invoices/upcoming?customer=${customerId}&subscription=${subscriptionId}`);
  if ((res as { error?: { message?: string } }).error) {
    throw new Error(`Stripe upcoming-invoice failed: ${(res as { error?: { message?: string } }).error?.message ?? "unknown"}`);
  }
  const total = res.total;
  if (typeof total !== "number") throw new Error("Stripe upcoming-invoice returned no total");
  return total;
}

function fmtMoney(cents: number, currency: string): string {
  const sym = currency === "usd" ? "$" : `${currency.toUpperCase()} `;
  return `${sym}${(cents / 100).toFixed(2)}`;
}

interface ProfileRow {
  email: string | null;
  full_name: string | null;
  stripe_customer_id: string | null;
}

/**
 * The accept. Writes existing discounts + GAINS20 (never replacing anything)
 * + un-cancel + attribution stamp in one call, then VERIFIES against
 * Stripe's re-read upcoming total. If the new total is not lower, the
 * original discount list is restored and the accept fails. Returns the
 * verified new total in cents.
 */
async function performAccept(
  customerId: string,
  prof: ProfileRow,
  userId: string,
  sub: SubView,
  currentTotal: number,
): Promise<number> {
  const params = new URLSearchParams();
  params.set("cancel_at_period_end", "false");
  sub.existingDiscountIds.forEach((id, i) => params.set(`discounts[${i}][discount]`, id));
  params.set(`discounts[${sub.existingDiscountIds.length}][coupon]`, COUPON_ID);
  params.set("metadata[save_offer_accepted_at]", new Date().toISOString());
  const updated = await stripePost(`subscriptions/${sub.id}`, params);
  if ((updated as { error?: { message?: string } }).error) {
    throw new Error(`subscription update failed: ${(updated as { error?: { message?: string } }).error?.message ?? "unknown"}`);
  }

  // Verify with Stripe's own math. The price may only go DOWN.
  const newTotal = await upcomingTotal(customerId, sub.id);
  if (newTotal >= currentTotal) {
    // Roll back to exactly the discounts they had; leave cancel flag as-is
    // (un-canceling alone never hurts them) but report failure.
    const rb = new URLSearchParams();
    if (sub.existingDiscountIds.length === 0) rb.set("discounts", "");
    else sub.existingDiscountIds.forEach((id, i) => rb.set(`discounts[${i}][discount]`, id));
    await stripePost(`subscriptions/${sub.id}`, rb).catch(() => {});
    console.error(
      `[save-offer] VERIFY FAILED user=${userId} sub=${sub.id}: total ${currentTotal} -> ${newTotal} (not lower); rolled back`,
    );
    throw new Error("post-accept verification failed: price did not decrease");
  }

  const who = prof.full_name ? `${prof.full_name} (${prof.email ?? userId})` : (prof.email ?? userId);
  try {
    await sendViaResend(
      ALERT_EMAIL,
      `Save offer ACCEPTED: ${prof.email ?? userId}`,
      `<p><strong>${escapeHtml(who)}</strong> clicked the save link and kept their subscription.</p>` +
      `<p>${sub.cancelScheduled ? "Cancellation removed. " : "Subscription was already active. "}` +
      `Next invoice: <strong>${fmtMoney(currentTotal, sub.currency)}</strong> → ` +
      `<strong>${fmtMoney(newTotal, sub.currency)}</strong>/${sub.interval} (verified in Stripe), permanently.</p>` +
      `<p><a href="https://www.thegainslab.com/admin/users/${userId}">Open their admin page →</a></p>`,
    );
  } catch (e) {
    console.error("[save-offer] acceptance alert failed (non-fatal):", e);
  }
  console.log(
    `[save-offer] accepted: user=${userId} sub=${sub.id} total ${currentTotal} -> ${newTotal} cancelWasScheduled=${sub.cancelScheduled}`,
  );
  return newTotal;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const url = new URL(req.url);

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "POST" && (req.headers.get("Content-Type") ?? "").includes("application/json")) {
    try {
      const body = await req.json().catch(() => ({}));
      const action = body?.action;

      if (action === "mint") {
        if (!UUID_RE.test(body?.user_id ?? "")) return json({ error: "Bad request" }, 400);
        const authHeader = req.headers.get("Authorization") ?? "";
        const { data: { user } } = await supa.auth.getUser(authHeader.replace("Bearer ", ""));
        if (!user) return json({ error: "Unauthorized" }, 401);
        const { data: me } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (me?.role !== "admin") return json({ error: "Not authorized" }, 403);
        const token = await mintToken(body.user_id);
        if (!token) return json({ error: "Signing secret not configured" }, 500);
        return json({ url: `${STAY_URL}?u=${body.user_id}&t=${token}` });
      }

      if (action === "status" || action === "accept") {
        const uid = String(body?.u ?? "");
        const tok = String(body?.t ?? "");
        if (!UUID_RE.test(uid) || !tok || !(await verifyToken(uid, tok))) {
          return json({ error: "invalid_link" }, 403);
        }
        if (!STRIPE_SECRET_KEY) return json({ error: "server" }, 500);
        const { data: prof } = await supa
          .from("profiles")
          .select("email, full_name, stripe_customer_id")
          .eq("id", uid)
          .maybeSingle();
        if (!prof?.stripe_customer_id) return json({ state: "lapsed" });
        const sub = await findLiveSubscription(prof.stripe_customer_id);
        if (!sub) return json({ state: "lapsed" });

        // The one true current number: their actual next bill.
        const currentTotal = await upcomingTotal(prof.stripe_customer_id, sub.id);
        const base = {
          current_cents: currentTotal,
          // The PROMISE (20% off what they pay). The accept verifies against
          // Stripe's real result and refuses if it doesn't come true.
          discounted_cents: Math.round(currentTotal * (100 - DISCOUNT_PCT) / 100),
          currency: sub.currency,
          interval: sub.interval,
          discount_pct: DISCOUNT_PCT,
          cancel_scheduled: sub.cancelScheduled,
        };
        const already = sub.hasCoupon && !sub.cancelScheduled;
        if (action === "status" || already) {
          return json({ state: already ? "already" : "offer", ...base });
        }
        if (sub.hasCoupon) {
          // Coupon present but cancellation scheduled: just un-cancel; the
          // discount they already have stays exactly as-is.
          const p = new URLSearchParams();
          p.set("cancel_at_period_end", "false");
          p.set("metadata[save_offer_accepted_at]", new Date().toISOString());
          const upd = await stripePost(`subscriptions/${sub.id}`, p);
          if ((upd as { error?: unknown }).error) return json({ error: "server" }, 500);
          return json({ state: "accepted", ...base, new_total_cents: currentTotal });
        }
        const newTotal = await performAccept(prof.stripe_customer_id, prof, uid, sub, currentTotal);
        return json({ state: "accepted", ...base, new_total_cents: newTotal });
      }

      return json({ error: "Bad request" }, 400);
    } catch (e) {
      console.error("[save-offer] json route failed:", e);
      return json({ error: "server" }, 500);
    }
  }

  // Anything else — a clicked old-style link, a scanner's GET/HEAD probe, a
  // stray form POST — redirects to the app page. Nothing here mutates.
  const u = url.searchParams.get("u") ?? "";
  const t = url.searchParams.get("t") ?? "";
  const dest = u && t ? `${STAY_URL}?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}` : STAY_URL;
  return new Response(null, { status: 302, headers: { ...cors, "Location": dest } });
});
