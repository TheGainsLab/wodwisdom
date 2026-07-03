/**
 * engine-join — F3 member-join bridge, wodwisdom side (GYM_PORTAL_FLOWS §F3).
 *
 * A signed-in wodwisdom member joins a gym's Engine Class via an invite token:
 *   1. enrolls the member on the gym roster (affiliate `engine-enroll`, s2s) — this
 *      resolves the gym behind the token and returns gym_id; the call carries a
 *      CONSENT ASSERTION (consent_version) so the affiliate can persist/attribute
 *      it and gate activation on it (the joint seam decision with affiliate #5),
 *   2. records member-level consent (gym-attributed, checked, dedup-on-retry),
 *   3. records the light Engine intake (merged, never regressing stored fields).
 *
 * The member's consent CLICK precedes everything (it's in the request payload);
 * what the affiliate receives with the PII is the consent ASSERTION, so PII never
 * reaches the roster without an accompanying consent claim.
 *
 * ADDITIVE + RETAIL-SAFE: never touches user_entitlements. Linking an existing
 * account is just this flow signed in; the retail subscription is untouched. The
 * gym seat grant lands separately on activation.
 *
 * Auth: verify_jwt=true (the gateway verifies the member JWT by signature — no
 * per-request GoTrue round trip); we decode the verified token for the user id.
 * Body: { invite_token, consent: { accepted }, intake? }. The server is the single
 * source of the consent VERSION it records (no client-pinned version → no
 * cache-skew 409 outage on the legal-copy swap).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AFFILIATE_ENROLL_URL = Deno.env.get("AFFILIATE_ENROLL_URL");
const ENGINE_ENROLL_KEY = Deno.env.get("ENGINE_ENROLL_KEY");
const ENROLL_TIMEOUT_MS = 12_000;

// Server-owned consent version (the single source of truth recorded + asserted).
const CONSENT_VERSION = "v1-legal-tbd-2026-07";
const CONSENT_TYPE = "member_engine_data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Service-role client, hoisted to module scope (reused across invocations).
const svc = createClient(SUPABASE_URL, SUPABASE_KEY);

interface JoinBody {
  invite_token?: unknown;
  consent?: { accepted?: unknown };
  intake?: unknown;
}

/** Decode a Supabase JWT payload. Signature is verified upstream (verify_jwt=true),
 *  so we only extract claims here. */
function decodeJwtSub(token: string): { sub: string | null; email: string | null } {
  try {
    const b64 = token.split(".")[1];
    if (!b64) return { sub: null, email: null };
    const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
    const claims = JSON.parse(json) as { sub?: string; email?: string };
    return { sub: claims.sub ?? null, email: claims.email ?? null };
  } catch {
    return { sub: null, email: null };
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
  const { sub: userId, email: jwtEmail } = decodeJwtSub(authHeader.replace("Bearer ", ""));
  if (!userId) return json({ error: "unauthorized" }, 401);

  if (!AFFILIATE_ENROLL_URL || !ENGINE_ENROLL_KEY) {
    return json({ error: "server_misconfigured", detail: "enroll bridge not configured" }, 500);
  }

  let body: JoinBody;
  try { body = await req.json() as JoinBody; } catch { return json({ error: "invalid_json" }, 400); }

  const inviteToken = typeof body.invite_token === "string" ? body.invite_token.trim() : "";
  if (!inviteToken) return json({ error: "invalid_request", detail: "invite_token required" }, 400);
  if (body.consent?.accepted !== true) {
    return json({ error: "consent_required", detail: "member consent is required to join" }, 400);
  }

  // Provided intake fields ONLY (so a re-join with blanks never wipes stored data).
  const rawIntake = (body.intake && typeof body.intake === "object" && !Array.isArray(body.intake))
    ? body.intake as Record<string, unknown> : {};
  const providedIntake: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawIntake)) {
    if (v !== null && v !== undefined && v !== "") providedIntake[k] = v;
  }

  // Member display info for the gym roster (best-effort).
  const { data: profile } = await svc.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const memberName = (profile?.full_name as string | null) ?? null;
  const memberEmail = (profile?.email as string | null) ?? jwtEmail ?? null;

  // 1. Enroll on the gym roster (affiliate, s2s). Carries the consent assertion.
  //    A bad token 404s here BEFORE any local write, so failed joins never pollute
  //    the consent log.
  let res: Response;
  try {
    res = await fetchWithTimeout(AFFILIATE_ENROLL_URL, {
      method: "POST",
      headers: { "X-Enroll-Key": ENGINE_ENROLL_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        invite_token: inviteToken, wodwisdom_user_id: userId,
        member_email: memberEmail, member_name: memberName,
        consent_version: CONSENT_VERSION, // seam assertion (affiliate persists + gates activation)
      }),
    }, ENROLL_TIMEOUT_MS);
  } catch (e) {
    return json({ error: "enroll_unreachable", detail: (e as Error).message }, 502);
  }
  // Parse OUTSIDE the fetch try so a non-JSON gateway body isn't misreported.
  const enrollText = await res.text();
  let enroll: Record<string, unknown> = {};
  try { enroll = enrollText ? JSON.parse(enrollText) : {}; } catch { /* non-JSON upstream body */ }
  if (!res.ok) {
    const status = res.status === 404 ? 404 : 502;
    return json({ error: "enroll_failed", detail: (enroll.detail || enroll.error || `affiliate ${res.status}`) as string }, status);
  }
  const gymId = typeof enroll.gym_id === "string" ? enroll.gym_id : "";
  if (!UUID_RE.test(gymId)) {
    // Contract drift — never write a link with a bad gym_id (NOT NULL / F5 keys off it).
    return json({ error: "enroll_bad_response", detail: "affiliate did not return a valid gym_id" }, 502);
  }
  const gymName = (enroll.gym_name as string | null) ?? null;
  const className = (enroll.class_name as string | null) ?? null;
  const seatStatus = (enroll.seat_status as string | null) ?? "invited";

  // 2. Record consent — CHECKED + gym-attributed + dedup on retry. If it fails
  //    after a successful enroll we do NOT report success (the member retries;
  //    enroll is idempotent, consent dedups). The INVITED seat grants no access,
  //    and the affiliate gates activation on the consent assertion sent above.
  const { error: consentErr } = await svc.from("member_consents").upsert({
    user_id: userId, consent_type: CONSENT_TYPE, version: CONSENT_VERSION, gym_id: gymId,
    payload: { user_agent: req.headers.get("user-agent") ?? null },
  }, { onConflict: "user_id,consent_type,version,gym_id", ignoreDuplicates: true });
  if (consentErr) {
    console.error("[engine-join] consent write failed after enroll:", consentErr);
    return json({ error: "consent_write_failed", detail: "please try again" }, 500);
  }

  // 3. Record the gym link + intake locally (drives PWA gym context). Merge intake
  //    over any stored values so a blank re-join never regresses gender/bodyweight.
  const { data: existing } = await svc.from("member_gym_links")
    .select("engine_intake").eq("user_id", userId).eq("gym_id", gymId).maybeSingle();
  const mergedIntake = { ...((existing?.engine_intake as Record<string, unknown>) ?? {}), ...providedIntake };

  const { error: linkErr } = await svc.from("member_gym_links").upsert({
    user_id: userId, gym_id: gymId, gym_name: gymName, class_name: className,
    engine_intake: mergedIntake, status: "joined", left_at: null,
  }, { onConflict: "user_id,gym_id" });
  if (linkErr) return json({ error: "link_failed", detail: linkErr.message }, 500);

  return json({ joined: true, gym_name: gymName, class_name: className, seat_status: seatStatus });
});
