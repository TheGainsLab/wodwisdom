/**
 * wholesale-grants — the Wholesale Grants API (BILLING_MECHANICS_SPEC §7).
 *
 * The seam where gym billing (affiliate-intelligence, its own Stripe + tenancy)
 * writes member ACCESS into wodwisdom's user_entitlements. The affiliate portal
 * is the first consumer; this is the second instance of the data-service's
 * versioned, consumer-keyed, tenant-bound auth discipline (the first is
 * engine-generate — both share _shared/consumer-auth.ts, no third copy).
 *
 *   POST   /wholesale/v1/grants   grant a feature to a member for a gym
 *   DELETE /wholesale/v1/grants   revoke a gym's grant(s) for a member
 *
 * Body (both): { user_id, gym_id, feature?, expires_at? }. user_id + gym_id are
 * UUIDs (gym_id = the gym's affiliate community id).
 *   - gym_id is the tenant; the presented X-Service-Key must be authorized for it
 *     (admin key = any tenant; a consumer key = only its bound tenant(s)).
 *   - Idempotent by (user_id, gym_id, feature): re-POST returns the same row,
 *     re-DELETE returns removed:0. Enforced by the unique index
 *     ux_entitlements_user_feature_grantedby (granted_by = gym_id).
 *   - Grants are ADDITIVE and source-scoped: writes/deletes touch ONLY
 *     source_kind='gym_grant' rows for this gym. Retail (source_kind='retail_stripe')
 *     and admin rows are never read, written, or deleted here. Access is the UNION
 *     of active entitlements across all sources (see _shared/entitlements.ts).
 *   - expires_at (POST): ABSENT means "don't touch a stored expiry" (a retry
 *     never silently makes a time-boxed grant permanent); explicit null CLEARS it;
 *     an ISO timestamp SETS it.
 *   - feature (DELETE): absent or explicit "*" = revoke ALL this gym's grants for
 *     the member; a concrete allowlisted feature = revoke just that one. A
 *     non-string feature is a 400 — a type bug must not escalate a scoped revoke.
 *
 * v1 scope: env-var keys (WHOLESALE_SERVICE_KEY / WHOLESALE_CONSUMER_KEYS), no
 * DB-backed key registry or rate limiting yet (the data-service pattern; Phase 4).
 * NO BATCH SHAPE YET (deferred, review 🟡): one grant per call. The first consumer
 * (F2 seat activation) is interactive/per-member, so this is fine; a bulk reconcile
 * path should add a { user_ids: [...] } array-upsert variant — see spec §7. The
 * open question a batch must resolve is partial failure (one bad user_id FK-fails
 * the whole array upsert), so it's a deliberate design step, not a free add.
 *
 * NO SUSPEND/RESUME VERB (dunning, review 🔴): §9's day-14 payment-failure pause
 * is F9's job and uses DELETE + re-grant (accepting that a suspension isn't
 * audit-distinct from an ordinary revoke in v1) — recorded in BILLING_MECHANICS_SPEC
 * §7/§9. If that audit distinction is needed, add a status/suspended_at column
 * with F9, not here.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { ALLOWED_GRANT_FEATURES } from "../_shared/entitlements.ts";
import { buildGrantRow } from "../_shared/grant-row.ts";
import { raiseEngineMonthsFromGrant } from "../_shared/engine-months-drip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "wholesale-grants",
});

// The gym-channel features a grant may unlock (BILLING_MECHANICS_SPEC §7 mapping).
// Allowlisted so a leaked tenant-bound key can't mint arbitrary retail features. The
// list is shared with the Engine Class gate (_shared/entitlements.ts) so issuing and
// gating can't desync. Remote-member all-access bundle (F11) deferred.
const ALLOWED_GRANT_FEATURES_SET = new Set<string>(ALLOWED_GRANT_FEATURES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GrantBody {
  user_id?: unknown;
  gym_id?: unknown;
  feature?: unknown;
  expires_at?: unknown;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST" && req.method !== "DELETE") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // ── Auth: constant-time, tenant-bound (shared with engine-generate) ─────────
  if (!auth.configured()) return json({ error: "config_missing_wholesale_key" }, 500);
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authResult = await auth.authorize(presentedKey);
  if (!authResult) return json({ error: "forbidden" }, 401);
  const { authz, fingerprint: keyFp } = authResult;

  // ── Parse + validate the envelope ───────────────────────────────────────────
  let body: GrantBody;
  try {
    body = await req.json() as GrantBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(userId)) {
    return json({ error: "invalid_request", detail: "user_id must be a uuid" }, 400);
  }
  if (!UUID_RE.test(gymId)) {
    return json({ error: "invalid_request", detail: "gym_id must be a uuid" }, 400);
  }

  // Tenant binding — the key must be authorized for this gym (tenant).
  if (!auth.authorizes(authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }

  // feature: distinguish absent / explicit "*" (revoke-all, DELETE only) from a
  // concrete allowlisted feature. A present-but-non-string feature is a 400 — a
  // type bug must never coerce to "" and escalate a scoped revoke into revoke-all.
  const featureRaw = body.feature;
  let feature = "";        // "" = the revoke-all sentinel (DELETE only)
  let revokeAll = false;
  if (featureRaw === undefined || featureRaw === null) {
    revokeAll = true;
  } else if (typeof featureRaw !== "string") {
    return json({ error: "invalid_request", detail: "feature must be a string" }, 400);
  } else if (featureRaw === "*") {
    revokeAll = true;
  } else {
    feature = featureRaw;
    if (!ALLOWED_GRANT_FEATURES_SET.has(feature)) {
      return json({
        error: "invalid_request",
        detail: `feature must be one of: ${[...ALLOWED_GRANT_FEATURES_SET].join(", ")}`,
      }, 400);
    }
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── POST: grant (idempotent upsert on (user_id, feature, granted_by)) ───────
  if (req.method === "POST") {
    if (revokeAll || !feature) {
      return json({ error: "invalid_request", detail: "a concrete feature is required for grant" }, 400);
    }

    // expires_at: ABSENT -> omit from the upsert (a retry must not clobber a
    // stored expiry to NULL and silently make a time-boxed grant permanent);
    // explicit null -> clear; ISO timestamp -> set.
    const hasExpires = Object.prototype.hasOwnProperty.call(body, "expires_at");
    let expiresProvided = false;
    let expiresAt: string | null = null;
    if (hasExpires) {
      if (body.expires_at === null) {
        expiresProvided = true;
      } else if (typeof body.expires_at === "string" && !isNaN(Date.parse(body.expires_at))) {
        expiresProvided = true;
        expiresAt = new Date(body.expires_at).toISOString();
      } else {
        return json({ error: "invalid_request", detail: "expires_at must be an ISO timestamp or null" }, 400);
      }
    }

    // Pure row builder (grant-row.ts) — deliberately omits granted_at so an idempotent
    // re-grant (reactivation) preserves the ORIGINAL grant timestamp the gym months
    // drip keys on. The 'gym_' source prefix + granted_by tenant column are set there.
    const row = buildGrantRow({ userId, gymId, feature, expiresProvided, expiresAt });

    const { data, error } = await supa
      .from("user_entitlements")
      .upsert(row, { onConflict: "user_id,feature,granted_by" })
      .select("id, user_id, feature, source_kind, granted_by, granted_at, expires_at")
      .single();

    if (error) {
      // 23503 = FK violation (unknown user_id) → 404; anything else → 500.
      const status = error.code === "23503" ? 404 : 500;
      console.error("[wholesale-grants] grant failed:", error);
      return json({ error: status === 404 ? "user_not_found" : "grant_failed", detail: error.message }, status);
    }

    console.log(JSON.stringify({
      at: "wholesale-grants", event: "grant", key_fp: keyFp,
      scope: authz === "*" ? "admin" : "bound", gym_id: gymId, feature, user_id: userId,
    }));

    // Decision 9(i): a gym `engine` grant IS the retail Engine seat. SEED the member's
    // engine_months_unlocked to their grant-based target at activation (only-raise), so a
    // fresh seat shows Month 1 immediately — the QR-at-the-front-desk moment can't show a
    // fully-locked dashboard until the (hourly) cron happens to run. Best-effort: a seed
    // failure must NOT fail the grant — the cron heals it. Same shared write the cron uses.
    let months_seeded: number | undefined;
    if (feature === "engine") {
      const g = data as { granted_at: string };
      const res = await raiseEngineMonthsFromGrant(supa, userId, g.granted_at, new Date().toISOString());
      if (res.error) console.error("[wholesale-grants] engine months seed failed (cron will heal):", userId, res.error);
      else months_seeded = res.target;
    }

    return json({ granted: true, entitlement: data, ...(months_seeded != null ? { months_seeded } : {}) });
  }

  // ── DELETE: revoke this gym's grant(s) — never retail (§7 revocation rule) ───
  let q = supa
    .from("user_entitlements")
    .delete()
    .eq("user_id", userId)
    .eq("source_kind", "gym_grant")
    .eq("granted_by", gymId);
  // revokeAll (feature absent or "*") -> no feature filter; else scope to the one.
  if (!revokeAll) q = q.eq("feature", feature);

  const { data, error } = await q.select("id, feature");
  if (error) {
    console.error("[wholesale-grants] revoke failed:", error);
    return json({ error: "revoke_failed", detail: error.message }, 500);
  }

  console.log(JSON.stringify({
    at: "wholesale-grants", event: "revoke", key_fp: keyFp,
    scope: authz === "*" ? "admin" : "bound", gym_id: gymId,
    feature: feature || "*", user_id: userId, removed: data?.length ?? 0,
  }));
  return json({ revoked: true, removed: data?.length ?? 0, features: (data ?? []).map((r) => r.feature) });
});
