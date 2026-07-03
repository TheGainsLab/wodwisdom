/**
 * engine-join — F3 member-join bridge, wodwisdom side (GYM_PORTAL_FLOWS §F3).
 *
 * A signed-in wodwisdom member joins a gym's Engine Class via an invite token:
 *   1. records member-level consent (LEGAL-TBD copy; version pins it),
 *   2. records a light Engine intake,
 *   3. calls the affiliate `engine-enroll` fn server-to-server (shared secret) to
 *      place the member on the gym roster as INVITED.
 *
 * ADDITIVE + RETAIL-SAFE: this function NEVER touches user_entitlements. A member
 * with an active retail subscription keeps it untouched; the gym seat is a
 * separate grant that only lands on activation (via the Wholesale Grants API).
 * Linking an existing account is exactly this flow — no retail row is read or
 * written here.
 *
 * Auth: the member's own Supabase JWT (validated in code). Body:
 *   { invite_token, consent: { version, accepted }, intake?: {...} }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AFFILIATE_ENROLL_URL = Deno.env.get("AFFILIATE_ENROLL_URL");
const ENGINE_ENROLL_KEY = Deno.env.get("ENGINE_ENROLL_KEY");

const CONSENT_VERSION = "v1-legal-tbd-2026-07"; // must match the F3 UI copy version

interface JoinBody {
  invite_token?: unknown;
  consent?: { version?: unknown; accepted?: unknown };
  intake?: unknown;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !user) return json({ error: "unauthorized" }, 401);

  if (!AFFILIATE_ENROLL_URL || !ENGINE_ENROLL_KEY) {
    return json({ error: "server_misconfigured", detail: "enroll bridge not configured" }, 500);
  }

  let body: JoinBody;
  try { body = await req.json() as JoinBody; } catch { return json({ error: "invalid_json" }, 400); }

  const inviteToken = typeof body.invite_token === "string" ? body.invite_token.trim() : "";
  if (!inviteToken) return json({ error: "invalid_request", detail: "invite_token required" }, 400);

  // Consent is required and must match the version this build presented.
  const consentAccepted = body.consent?.accepted === true;
  const consentVersion = typeof body.consent?.version === "string" ? body.consent.version : "";
  if (!consentAccepted) return json({ error: "consent_required", detail: "member consent is required to join" }, 400);
  if (consentVersion !== CONSENT_VERSION) {
    return json({ error: "consent_version_mismatch", detail: `expected ${CONSENT_VERSION}` }, 409);
  }

  const intake = (body.intake && typeof body.intake === "object" && !Array.isArray(body.intake))
    ? body.intake as Record<string, unknown>
    : {};

  // Member display info for the gym roster (best-effort).
  const { data: profile } = await supa.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  const memberName = (profile?.full_name as string | null) ?? null;
  const memberEmail = (profile?.email as string | null) ?? user.email ?? null;

  // 1. Record consent first (proof captured before any downstream processing).
  await supa.from("member_consents").insert({
    user_id: user.id, consent_type: "member_engine_data", version: CONSENT_VERSION,
    payload: { user_agent: req.headers.get("user-agent") ?? null },
  });

  // 2. Enroll on the gym roster (affiliate, server-to-server). This resolves the
  //    gym behind the token; a bad token 404s here.
  let enroll: { ok: boolean; gym_name: string; class_name: string; gym_id: string; seat_status: string };
  try {
    const res = await fetch(AFFILIATE_ENROLL_URL, {
      method: "POST",
      headers: { "X-Enroll-Key": ENGINE_ENROLL_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        invite_token: inviteToken, wodwisdom_user_id: user.id,
        member_email: memberEmail, member_name: memberName,
      }),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      return json({ error: "enroll_failed", detail: parsed.detail || parsed.error || `affiliate ${res.status}` }, status);
    }
    enroll = parsed;
  } catch (e) {
    return json({ error: "enroll_unreachable", detail: (e as Error).message }, 502);
  }

  // 3. Record the gym link + intake locally (drives PWA gym context). Idempotent
  //    on (user, gym); a re-join updates without regressing.
  const { error: linkErr } = await supa.from("member_gym_links").upsert({
    user_id: user.id, gym_id: enroll.gym_id, gym_name: enroll.gym_name,
    class_name: enroll.class_name, invite_token: inviteToken,
    engine_intake: intake, status: "joined",
  }, { onConflict: "user_id,gym_id" });
  if (linkErr) return json({ error: "link_failed", detail: linkErr.message }, 500);

  // Never touched user_entitlements — access lands on seat activation (grants API).
  return json({
    joined: true,
    gym_name: enroll.gym_name,
    class_name: enroll.class_name,
    seat_status: enroll.seat_status, // 'invited' until the owner activates
  });
});
