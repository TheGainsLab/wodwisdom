/**
 * checkout-claim-account — turn a paid Stripe Checkout session into a
 * signed-in account, with no form and no confirmation email.
 *
 * Founder decision 2026-11-11: a buyer who pays on the website should not
 * then have to "create an account" and confirm an email. Stripe has just
 * billed that address; that is the proof. The buyer sets a password on the
 * completion page while signed in (CheckoutCompletePage), and goes straight
 * to the intake for what they bought.
 *
 * Flow (called by the completion page with the session_id from the return
 * URL, signed out):
 *   1. Verify the session with Stripe: paid, complete, recent.
 *   2. Single-use: the checkout_attempts breadcrumb for this session flips
 *      to 'claimed'; a second call is refused (409).
 *   3. Find the account by email (profiles, case-insensitive) or create it
 *      with the email marked confirmed.
 *   4. Make sure the purchase is attached: the webhook usually got there
 *      first (pending_subscriptions for a new email, a direct grant for an
 *      existing one); if not yet, claim it ourselves and wait briefly.
 *   5. Mint a one-time magic-link token for that email and return it; the
 *      page signs the browser in with it, then asks for a password.
 *
 * Risk accepted: for the session's claim window the Stripe session id in
 * the return URL is a sign-in credential. It is a long random id only the
 * paying browser receives, the claim is single-use, and the token it
 * yields is single-use and short-lived.
 *
 * verify_jwt = false (the caller is signed out). Never returns the token
 * for a session that is unpaid, stale, or already claimed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** How long after payment the session may still be claimed. */
const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How long to wait for the webhook to attach the purchase before giving up (the page copes either way). */
const ENTITLEMENT_WAIT_MS = 8_000;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "POST only" }, 405);

  try {
    const { session_id } = await req.json().catch(() => ({}));
    if (!session_id || typeof session_id !== "string") return json(cors, { error: "Missing session_id" }, 400);
    if (!STRIPE_SECRET_KEY) return json(cors, { error: "Stripe not configured" }, 500);

    // 1. Verify with Stripe.
    const resp = await fetchWithTimeout(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`, {
      headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") },
    }, 15_000);
    const session = await resp.json();
    if (session.error) return json(cors, { error: session.error.message }, 400);

    const email: string | null = session.customer_email || session.customer_details?.email || null;
    const plan: string | null = session.metadata?.plan ?? null;
    const subscriptionId: string | null = session.subscription ?? null;
    if (!email) return json(cors, { error: "No email on this checkout session" }, 400);
    if (session.status !== "complete" || session.payment_status !== "paid") {
      return json(cors, { error: "Checkout session is not paid", plan, email }, 402);
    }
    const createdMs = typeof session.created === "number" ? session.created * 1000 : 0;
    if (!createdMs || Date.now() - createdMs > CLAIM_WINDOW_MS) {
      return json(cors, { error: "Checkout session is too old to claim; sign in instead", plan, email }, 410);
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 2. Single-use. The breadcrumb row is written by create-checkout for
    //    every checkout; flip it to 'claimed' and refuse a second claim.
    const { data: attempt } = await supa
      .from("checkout_attempts").select("id, status").eq("stripe_session_id", session_id).maybeSingle();
    if (attempt?.status === "claimed") {
      return json(cors, { error: "already_claimed", plan, email }, 409);
    }
    if (attempt) {
      await supa.from("checkout_attempts").update({ status: "claimed" }).eq("id", attempt.id);
    } else {
      await supa.from("checkout_attempts").insert({
        stripe_session_id: session_id, email, plan, status: "claimed", completed_at: new Date().toISOString(),
      }).then(() => {}, () => {});
    }

    // 3. Find or create the account.
    const { data: existing } = await supa
      .from("profiles").select("id").ilike("email", email).limit(1);
    let userId: string | null = existing?.[0]?.id ?? null;
    let newAccount = false;
    if (!userId) {
      const { data: created, error: cErr } = await supa.auth.admin.createUser({
        email,
        email_confirm: true, // Stripe just billed this address
        user_metadata: { acquisition: "checkout" },
      });
      if (cErr || !created?.user) {
        // Race with a signup from the same email: look it up once more.
        const { data: again } = await supa.from("profiles").select("id").ilike("email", email).limit(1);
        userId = again?.[0]?.id ?? null;
        if (!userId) return json(cors, { error: cErr?.message ?? "Could not create account" }, 500);
      } else {
        userId = created.user.id;
        newAccount = true;
      }
    }

    // 4. Make sure the purchase is attached to the account. The webhook may
    //    still be in flight; try the claim and poll briefly.
    let entitled = false;
    const deadline = Date.now() + ENTITLEMENT_WAIT_MS;
    while (true) {
      const q = supa.from("user_entitlements").select("id", { count: "exact", head: true }).eq("user_id", userId);
      const { count } = subscriptionId ? await q.eq("source", subscriptionId) : await q;
      if ((count ?? 0) > 0) { entitled = true; break; }
      await supa.rpc("_do_claim_pending_subscription", { p_user_id: userId, p_email: email }).then(() => {}, () => {});
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!entitled) console.warn(`[checkout-claim-account] purchase not yet attached for session ${session_id}; the reconciler / sign-in claim will finish it`);

    // 5. One-time sign-in token for the page.
    const { data: link, error: lErr } = await supa.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (lErr || !tokenHash) return json(cors, { error: lErr?.message ?? "Could not create sign-in token" }, 500);

    return json(cors, { token_hash: tokenHash, email, plan, new_account: newAccount, entitled });
  } catch (e) {
    console.error("[checkout-claim-account]", e);
    return json(cors, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
