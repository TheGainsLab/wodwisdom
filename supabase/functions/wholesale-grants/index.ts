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
 * Body (both): { user_id, gym_id, feature?, expires_at? }.
 *   - gym_id is the tenant; the presented X-Service-Key must be authorized for it
 *     (admin key = any tenant; a consumer key = only its bound tenant(s)).
 *   - Idempotent by (user_id, gym_id, feature): re-POST returns the same row,
 *     re-DELETE returns removed:0. Enforced by the unique index
 *     ux_entitlements_user_feature_grantedby (granted_by = gym_id).
 *   - Grants are ADDITIVE and source-scoped: writes/deletes touch ONLY
 *     source_kind='gym_grant' rows for this gym. Retail (source_kind='retail_stripe')
 *     and admin rows are never read, written, or deleted here. Access is the UNION
 *     of active entitlements across all sources (see _shared/entitlements.ts).
 *
 * v1 scope: env-var keys (WHOLESALE_SERVICE_KEY / WHOLESALE_CONSUMER_KEYS), no
 * DB-backed key registry or rate limiting yet (the data-service pattern; Phase 4).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "wholesale-grants",
});

// The gym-channel features a grant may unlock (BILLING_MECHANICS_SPEC §7 mapping).
// Allowlisted so a leaked tenant-bound key can't mint arbitrary retail features.
//   Engine Class seat  -> engine_cohort   (2a)
//   Programmer roster  -> gym_programming (2b)
// Remote-member all-access bundle (F11) is deferred; add its keys here when built.
const ALLOWED_GRANT_FEATURES = new Set(["engine_cohort", "gym_programming"]);

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
  const authz = await auth.authorizeKey(presentedKey);
  if (!authz) return json({ error: "forbidden" }, 401);

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
  if (!gymId) {
    return json({ error: "invalid_request", detail: "gym_id required" }, 400);
  }

  // Tenant binding — the key must be authorized for this gym (tenant).
  if (!auth.authorizes(authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }

  // feature: required for POST; optional for DELETE (omit = revoke all this gym's
  // grants for the member).
  const feature = typeof body.feature === "string" ? body.feature : "";
  if (feature && !ALLOWED_GRANT_FEATURES.has(feature)) {
    return json({
      error: "invalid_request",
      detail: `feature must be one of: ${[...ALLOWED_GRANT_FEATURES].join(", ")}`,
    }, 400);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const keyFp = await auth.fingerprint(presentedKey);

  // ── POST: grant (idempotent upsert on (user_id, feature, granted_by)) ───────
  if (req.method === "POST") {
    if (!feature) {
      return json({ error: "invalid_request", detail: "feature required for grant" }, 400);
    }
    let expiresAt: string | null = null;
    if (body.expires_at != null) {
      if (typeof body.expires_at !== "string" || isNaN(Date.parse(body.expires_at))) {
        return json({ error: "invalid_request", detail: "expires_at must be an ISO timestamp" }, 400);
      }
      expiresAt = new Date(body.expires_at).toISOString();
    }

    const { data, error } = await supa
      .from("user_entitlements")
      .upsert({
        user_id: userId,
        feature,
        // `source` = gym_id (not a constant): the LEGACY UNIQUE(user_id, feature,
        // source) is still enforced, so two gyms granting the same feature to the
        // same member (a member in two Engine-Class gyms — §7 revokes per gym)
        // must differ here. It mirrors granted_by; source_kind carries the category.
        source: gymId,
        source_kind: "gym_grant",
        granted_by: gymId,
        expires_at: expiresAt,
      }, { onConflict: "user_id,feature,granted_by" })
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
    return json({ granted: true, entitlement: data });
  }

  // ── DELETE: revoke this gym's grant(s) — never retail (§7 revocation rule) ───
  let q = supa
    .from("user_entitlements")
    .delete()
    .eq("user_id", userId)
    .eq("source_kind", "gym_grant")
    .eq("granted_by", gymId);
  if (feature) q = q.eq("feature", feature);

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
