/**
 * gym-seat-grant — the token-keyed seat grant seam (identity model Phase 2, P2a).
 * See affiliate-intelligence docs/IDENTITY_PHASE_2_DESIGN.md.
 *
 * The affiliate mints an opaque per-seat token and drives it here, server-to-server.
 * NO member account is involved until the member CLAIMS (gym-seat-claim). This is a
 * NEW endpoint deployed ALONGSIDE the user-id wholesale-grants path — that path stays
 * pristine through the migration window (retired in Phase 5).
 *
 * The ONLY thing that crosses the seam is the token; the affiliate never sees a
 * wodwisdom user id (IDENTITY_MODEL §1.3–1.5).
 *
 * Auth: the WHOLESALE consumer-key family (tenant-bound; a gym's key touches only its
 * own gym_id) — same discipline as wholesale-grants.
 *
 * POST { gym_id, action, ... }:
 *   create  { token, feature }  -> record a PENDING grant (30-day TTL). Idempotent by
 *                                  token: re-create returns the existing row.
 *   revoke  { token }           -> claimed: remove the gym_grant entitlement for the
 *                                  bound user; pending: cancel. status -> revoked.
 *   status  { tokens: [...] }   -> per-token { status, consent } — the affiliate POLLS
 *                                  this (pull, not push; IDENTITY_MODEL §4). Lazily
 *                                  flips an expired pending grant to 'expired'.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { ALLOWED_GRANT_FEATURES } from "../_shared/entitlements.ts";
import { classifyRevoke, pollStatus } from "../_shared/gym-seat-state.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-seat-grant",
});

const ALLOWED_FEATURES = new Set<string>(ALLOWED_GRANT_FEATURES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A token is opaque; bound the length so a junk body can't blow up a query. ≥128-bit
// handles are 22+ chars (base64url) or 32 (hex/UUID-no-dash) — accept a generous range.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (IDENTITY_MODEL §5.1)

const GRANT_COLS =
  "id, token, gym_id, feature, gym_name, status, expires_at, claimed_user_id, claimed_at, consent";

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: constant-time, tenant-bound (wholesale key family) ────────────────
  if (!auth.configured()) return json({ error: "config_missing_wholesale_key" }, 500);
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authResult = await auth.authorize(presentedKey);
  if (!authResult) return json({ error: "forbidden" }, 401);
  const { authz, fingerprint: keyFp } = authResult;

  let body: { gym_id?: unknown; action?: unknown; token?: unknown; feature?: unknown; tokens?: unknown; gym_name?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(gymId)) return json({ error: "invalid_request", detail: "gym_id must be a uuid" }, 400);
  if (!auth.authorizes(authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }
  const action = typeof body.action === "string" ? body.action : "";

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const token = typeof body.token === "string" ? body.token : "";
    if (!TOKEN_RE.test(token)) return json({ error: "invalid_request", detail: "token must be a 20–128 char url-safe string" }, 400);
    const feature = typeof body.feature === "string" ? body.feature : "";
    if (!ALLOWED_FEATURES.has(feature)) {
      return json({ error: "invalid_request", detail: `feature must be one of: ${[...ALLOWED_FEATURES].join(", ")}` }, 400);
    }

    // Optional display context (the gym's own name — not member PII; §1.5).
    const gymName = typeof body.gym_name === "string" ? body.gym_name.slice(0, 120) : null;

    // Idempotent by token. Insert; on unique conflict, return the existing row (only
    // if it belongs to this gym — a token collision across gyms is a hard error).
    const nowMs = Date.now();
    const expiresAt = new Date(nowMs + PENDING_TTL_MS).toISOString();
    const { data: inserted, error: insErr } = await supa
      .from("gym_seat_grants")
      .insert({ token, gym_id: gymId, feature, gym_name: gymName, expires_at: expiresAt })
      .select(GRANT_COLS)
      .maybeSingle();

    if (insErr) {
      if (insErr.code === "23505") {
        // Token already exists — return it if it's this gym's, else refuse.
        const { data: existing } = await supa.from("gym_seat_grants").select(GRANT_COLS).eq("token", token).maybeSingle();
        if (existing && existing.gym_id === gymId) {
          return json({ created: false, grant: existing }, 200);
        }
        return json({ error: "token_conflict", detail: "token already in use" }, 409);
      }
      console.error("[gym-seat-grant] create failed:", insErr);
      return json({ error: "create_failed", detail: insErr.message }, 500);
    }

    console.log(JSON.stringify({ at: "gym-seat-grant", event: "create", key_fp: keyFp, gym_id: gymId, feature }));
    return json({ created: true, grant: inserted }, 201);
  }

  // ── revoke ──────────────────────────────────────────────────────────────────
  if (action === "revoke") {
    const token = typeof body.token === "string" ? body.token : "";
    if (!TOKEN_RE.test(token)) return json({ error: "invalid_request", detail: "token must be a 20–128 char url-safe string" }, 400);

    // Read → (delete entitlement if claimed) → CAS the status flip FROM THE STATUS WE
    // READ. Without the CAS, a claim landing between the read (pending — delete branch
    // skipped) and the update would bind an entitlement that survives under a row
    // marked 'revoked'. On a lost CAS we re-read and redo, so the claimed branch runs.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: grant, error: readErr } = await supa
        .from("gym_seat_grants").select(GRANT_COLS).eq("token", token).eq("gym_id", gymId).maybeSingle();
      if (readErr) return json({ error: "read_failed", detail: readErr.message }, 500);
      if (!grant) return json({ error: "not_found" }, 404);

      const decision = classifyRevoke(grant.status as string, grant.claimed_user_id as string | null);

      // Idempotent: already revoked/unbound -> report done.
      if (decision.kind === "already_done") {
        return json({ revoked: true, already: true, status: decision.status });
      }

      // If claimed, remove ONLY this gym's grant of this feature for the bound user
      // (never retail, never another gym — same scoping as wholesale-grants DELETE).
      if (decision.kind === "remove_entitlement") {
        const { error: delErr } = await supa
          .from("user_entitlements").delete()
          .eq("user_id", grant.claimed_user_id)
          .eq("source_kind", "gym_grant")
          .eq("granted_by", gymId)
          .eq("feature", grant.feature);
        if (delErr) {
          console.error("[gym-seat-grant] entitlement delete failed:", delErr);
          return json({ error: "revoke_failed", detail: delErr.message }, 500);
        }
        // NOTE: member_gym_links is per-(user,gym), not per-service; a member may hold
        // other services from this gym, so revoking one seat does NOT end the link.
        // Ending the link when a member has no remaining gym services is a later refinement.
      }

      const { data: updRows, error: updErr } = await supa
        .from("gym_seat_grants")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", grant.id).eq("status", grant.status)
        .select("id");
      if (updErr) return json({ error: "revoke_failed", detail: updErr.message }, 500);
      if (updRows && updRows.length > 0) {
        console.log(JSON.stringify({ at: "gym-seat-grant", event: "revoke", key_fp: keyFp, gym_id: gymId, feature: grant.feature }));
        return json({ revoked: true, was: grant.status });
      }
      // Status moved under us (a claim landed mid-revoke) — loop re-reads and redoes.
    }
    return json({ error: "conflict", detail: "grant state kept changing during revoke — retry" }, 409);
  }

  // ── status (the poll) ─────────────────────────────────────────────────────
  if (action === "status") {
    const tokens = Array.isArray(body.tokens) ? body.tokens.filter((t): t is string => typeof t === "string") : [];
    if (tokens.length === 0) return json({ error: "invalid_request", detail: "tokens must be a non-empty array" }, 400);
    if (tokens.length > 500) return json({ error: "invalid_request", detail: "at most 500 tokens per poll" }, 400);

    const { data: rows, error } = await supa
      .from("gym_seat_grants")
      .select("token, status, consent, expires_at")
      .eq("gym_id", gymId)
      .in("token", tokens);
    if (error) return json({ error: "read_failed", detail: error.message }, 500);

    // Lazily flip expired pending grants (report + persist), so a lapsed claim window
    // shows as 'expired' not 'pending'.
    const nowMs = Date.now();
    const toExpire: string[] = [];
    const statuses = (rows ?? []).map((r) => {
      // pollStatus maps claimed->active and folds in expiry (IDENTITY_MODEL §4). Track
      // pending grants that just lapsed so we persist the flip below.
      const status = pollStatus(r.status as string, r.expires_at as string, nowMs);
      if ((r.status as string) === "pending" && status === "expired") toExpire.push(r.token as string);
      return { token: r.token as string, status, consent: r.consent as string };
    });
    if (toExpire.length > 0) {
      await supa.from("gym_seat_grants")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("gym_id", gymId).in("token", toExpire).eq("status", "pending")
        .then(() => {}, (e) => console.error("[gym-seat-grant] lazy-expire failed:", e));
    }

    // Tokens the caller asked about that we don't have -> 'unknown' (so the affiliate
    // can distinguish "never created" from a real state).
    const known = new Set(statuses.map((s) => s.token));
    for (const t of tokens) if (!known.has(t)) statuses.push({ token: t, status: "unknown", consent: "not_yet" });

    return json({ statuses });
  }

  return json({ error: "invalid_request", detail: "action must be create|revoke|status" }, 400);
});
