/**
 * gym-seat-claim — the member claims a seat token (identity model Phase 2, P2a).
 * See affiliate-intelligence docs/IDENTITY_PHASE_2_DESIGN.md §3.2/§5/§6.
 *
 * The member is PRESENT (they tapped the claim link and are signed in), so there is
 * no admin account-minting — this is ordinary signup/login (the `/claim/<token>` PWA
 * page runs it) followed by this bind. The member ends with a durable, member-owned
 * credential, so revocation degrades to dormancy, never orphaning (IDENTITY_MODEL §5.5).
 *
 * Binds the pending grant (looked up by token — no affiliate round-trip, the gym is
 * already on the row) as a `gym_grant` entitlement source on the caller's account,
 * records consent (granted|declined, versioned — §6), and links the member to the gym.
 *
 * Auth: verify_jwt=true (gateway verifies the member JWT; we decode the sub).
 * Body: { token, consent_accepted: boolean }.
 *
 * Idempotent: same user re-claiming re-runs the full bind (entitlement upsert,
 * consent, link — all idempotent), so a retry after a partial failure heals; a
 * DIFFERENT user presenting an already-claimed token is refused (single-use — the
 * accepted possession-is-identity boundary, §5.1).
 *
 * Write order is CAS-FIRST: the grant row is compare-and-swapped pending→claimed
 * BEFORE any entitlement write. A racer who loses the CAS therefore never writes an
 * entitlement at all — the alternative (bind first, delete on loss) is unsafe because
 * the idempotent upsert may have touched a grant the loser already held legitimately
 * via another token, and deleting it would strip real access.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildGrantRow } from "../_shared/grant-row.ts";
import { ENGINE_DRIP_FEATURES } from "../_shared/entitlements.ts";
import { raiseEngineMonthsFromGrant } from "../_shared/engine-months-drip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Server-owned consent copy version — the single source of the version recorded, so a
// legal-copy swap can't cause a client-pinned-version skew (engine-join's discipline).
// Bump this string when the claim-page consent copy changes (IDENTITY_MODEL §6).
const CONSENT_VERSION = "gymclaim-v1-2026-07-11";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

/** Map a granted feature to its per-service data-sharing consent type (IDENTITY_MODEL
 *  §6). Injuries/health is always a SEPARATE type (future), never bundled here. */
function consentTypeFor(feature: string): string {
  if (feature === "nutrition") return "member_nutrition_data";
  return "member_engine_data"; // engine / gym_engine / engine_cohort / engine_class_view
}

/** Decode a Supabase JWT payload. Signature verified upstream (verify_jwt=true). */
function decodeJwtSub(token: string): string | null {
  try {
    const b64 = token.split(".")[1];
    if (!b64) return null;
    const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(norm + "=".repeat((4 - (norm.length % 4)) % 4))) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userId = decodeJwtSub(authHeader.replace("Bearer ", ""));
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: { token?: unknown; consent_accepted?: unknown; peek?: unknown };
  try { body = await req.json() as typeof body; } catch { return json({ error: "invalid_json" }, 400); }

  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_RE.test(token)) return json({ error: "invalid_request", detail: "token invalid" }, 400);

  // ── peek: what is this token, without binding? Drives the claim page's "CrossFit
  //    Southie is giving you Nutrition" header + early expiry/used feedback. No consent
  //    needed. Reports a claimable flag so the page can show the right state. ──────
  if (body.peek === true) {
    const { data: g, error } = await svc
      .from("gym_seat_grants")
      .select("feature, gym_name, status, expires_at, claimed_user_id")
      .eq("token", token).maybeSingle();
    if (error) return json({ error: "read_failed", detail: error.message }, 500);
    if (!g) return json({ error: "not_found" }, 404);
    const isExpired = g.status === "expired" ||
      (g.status === "pending" && new Date(g.expires_at as string).getTime() < Date.now());
    const alreadyByMe = g.status === "claimed" && g.claimed_user_id === userId;
    const claimable = g.status === "pending" && !isExpired;
    return json({
      feature: g.feature, gym_name: g.gym_name ?? null,
      status: isExpired ? "expired" : g.status,
      claimable, already_claimed_by_me: alreadyByMe,
    });
  }
  // Consent is a required explicit decision (true = share, false = decline). Declining
  // still claims the service — consent is orthogonal, never a gate (IDENTITY_MODEL §4/§6).
  if (typeof body.consent_accepted !== "boolean") {
    return json({ error: "invalid_request", detail: "consent_accepted (boolean) required" }, 400);
  }
  const consentAccepted = body.consent_accepted;
  const consentValue = consentAccepted ? "granted" : "declined";

  // ── Load the pending grant (token is the key; the gym is on the row) ────────
  const { data: grant, error: readErr } = await svc
    .from("gym_seat_grants")
    .select("id, token, gym_id, feature, status, expires_at, claimed_user_id")
    .eq("token", token).maybeSingle();
  if (readErr) return json({ error: "read_failed", detail: readErr.message }, 500);
  if (!grant) return json({ error: "not_found", detail: "unknown or retired claim link" }, 404);

  const gymIdStr = String(grant.gym_id);
  const feature = grant.feature as string;

  // Terminal / conflicting states.
  if (grant.status === "revoked" || grant.status === "unbound") {
    return json({ error: "not_claimable", detail: `this seat is ${grant.status}`, status: grant.status }, 409);
  }
  const expired = grant.status === "expired" ||
    (grant.status === "pending" && new Date(grant.expires_at as string).getTime() < Date.now());
  if (expired) {
    // Persist the expiry lazily (mirror the poll) — best-effort.
    await svc.from("gym_seat_grants").update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", grant.id).eq("status", "pending").then(() => {}, () => {});
    return json({ error: "expired", detail: "this claim link has expired — ask your gym to resend it" }, 410);
  }
  if (grant.status === "claimed" && grant.claimed_user_id !== userId) {
    // Single-use: a different account already claimed this token.
    return json({ error: "already_claimed", detail: "this seat has already been claimed" }, 409);
  }

  // `already` = this member re-presenting a token they own. The re-claim does NOT
  // short-circuit: it re-runs the full idempotent bind below, so a retry after a
  // post-CAS failure (entitlement/consent write died) heals instead of stranding.
  const already = grant.status === "claimed";

  if (grant.status === "pending") {
    // ── CAS pending→claimed FIRST (before any entitlement write), so two concurrent
    //    claims can't both bind and the loser never leaves a stray entitlement. ─────
    const { data: claimedRows, error: claimErr } = await svc
      .from("gym_seat_grants")
      .update({
        status: "claimed", claimed_user_id: userId, claimed_at: new Date().toISOString(),
        consent: consentValue, updated_at: new Date().toISOString(),
      })
      .eq("id", grant.id).eq("status", "pending")
      .select("id");
    if (claimErr) return json({ error: "claim_failed", detail: claimErr.message }, 500);
    if (!claimedRows || claimedRows.length === 0) {
      // Another write won between our read and CAS. Re-read to report honestly — and
      // if the winner was a concurrent request from THIS member, fall through to the
      // idempotent bind rather than refusing our own seat.
      const { data: now } = await svc.from("gym_seat_grants")
        .select("claimed_user_id, status").eq("id", grant.id).maybeSingle();
      if (now?.claimed_user_id !== userId) {
        if (now?.status === "revoked" || now?.status === "unbound") {
          return json({ error: "not_claimable", detail: `this seat is ${now.status}`, status: now.status }, 409);
        }
        return json({ error: "already_claimed", detail: "this seat has already been claimed" }, 409);
      }
    }
  }

  // ── Bind (owner-only: the grant row is claimed by this member — CAS won, re-claim,
  //    or lost-to-self). Write the gym_grant entitlement (no expiry — a claimed seat
  //    has no cutoff; deactivation sets one later). Idempotent upsert. ──────────────
  const row = buildGrantRow({ userId, gymId: gymIdStr, feature, expiresProvided: false, expiresAt: null });
  const { data: ent, error: grantErr } = await svc
    .from("user_entitlements")
    .upsert(row, { onConflict: "user_id,feature,granted_by" })
    .select("granted_at")
    .single();
  if (grantErr) {
    // The grant row is already claimed by this member, so the page's retry lands in
    // the re-claim path above and re-runs this bind — self-healing, never stranded.
    console.error("[gym-seat-claim] entitlement upsert failed:", grantErr);
    return json({ error: "claim_failed", detail: grantErr.message }, 500);
  }

  if (already) {
    // Re-claim: refresh the grant row's consent mirror (a fresh claim wrote it in the CAS).
    await svc.from("gym_seat_grants")
      .update({ consent: consentValue, updated_at: new Date().toISOString() }).eq("id", grant.id)
      .then(() => {}, () => {});
  }

  // Consent (versioned, gym-attributed) + gym link. If this fails after the bind, the
  // member still has access; report so the page can retry (idempotent).
  const consentWarn = await recordConsentAndLink(userId, gymIdStr, feature, consentValue, req.headers.get("user-agent"));

  // Engine drip parity: seed engine_months to the grant-based target so a fresh engine
  // seat shows Month 1 immediately (mirror wholesale-grants). Best-effort; cron heals.
  if ((ENGINE_DRIP_FEATURES as readonly string[]).includes(feature)) {
    const g = ent as { granted_at: string };
    const seed = await raiseEngineMonthsFromGrant(svc, userId, g.granted_at, new Date().toISOString());
    if (seed.error) console.error("[gym-seat-claim] engine months seed failed (cron heals):", userId, seed.error);
  }

  if (!already) {
    console.log(JSON.stringify({ at: "gym-seat-claim", event: "claim", gym_id: gymIdStr, feature, consent: consentValue }));
  }
  return json({
    claimed: true, ...(already ? { already: true } : {}), feature, consent: consentValue,
    ...(consentWarn ? { warning: consentWarn } : {}),
  });
});

/** Record the versioned consent decision (mutable — upsert updates status on
 *  re-decision) + the gym link. Returns a warning string on non-fatal failure. */
async function recordConsentAndLink(
  userId: string, gymId: string, feature: string, consentValue: "granted" | "declined", userAgent: string | null,
): Promise<string | null> {
  let warn: string | null = null;
  const { error: consentErr } = await svc.from("member_consents").upsert({
    user_id: userId, consent_type: consentTypeFor(feature), version: CONSENT_VERSION, gym_id: gymId,
    status: consentValue,
    // accepted_at is deliberately ABSENT: the insert takes the column DEFAULT now(),
    // and on a re-decision the DO UPDATE can't touch an absent column — the FIRST
    // decision time survives for dispute audits (the F3 migration's requirement).
    // The LATEST decision time rides in payload.decided_at alongside status.
    payload: { user_agent: userAgent, source: "gym-seat-claim", decided_at: new Date().toISOString() },
  }, { onConflict: "user_id,consent_type,version,gym_id" });
  if (consentErr) { console.error("[gym-seat-claim] consent write failed:", consentErr); warn = "consent_write_failed"; }

  const { error: linkErr } = await svc.from("member_gym_links").upsert({
    user_id: userId, gym_id: gymId, status: "joined", left_at: null,
  }, { onConflict: "user_id,gym_id" });
  if (linkErr) { console.error("[gym-seat-claim] link write failed:", linkErr); warn = warn ?? "link_write_failed"; }
  return warn;
}
