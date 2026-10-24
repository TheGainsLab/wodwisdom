/**
 * apply-profile-update — resolves a chat profile-update proposal.
 *
 * The coach proposed a profile diff (logged in profile_update_proposals
 * BEFORE the card rendered); the athlete tapped Apply or Not now. This fn
 * resolves that logged row exactly once: on apply it writes the diff to
 * athlete_profiles (append-only goal, replace injuries, set days_per_week)
 * and marks the outcome; on decline it just marks the outcome. Mirrors
 * apply-block-edit's shape.
 *
 * Auth: the athlete's own token; the proposal must belong to them and be
 * unresolved. Service role performs the writes.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  applyProposalToProfile,
  type ProfileCurrent,
  type ProfileProposal,
} from "../_shared/profile-update.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData, error: authErr } = await supa.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return json({ error: "Invalid token" }, 401);

    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    const action = body.action === "apply" || body.action === "decline" ? body.action : null;
    if (!proposalId || !action) return json({ error: "proposal_id and action (apply|decline) required" }, 400);

    const { data: row, error: rowErr } = await supa
      .from("profile_update_proposals")
      .select("id, user_id, current, proposal, outcome")
      .eq("id", proposalId)
      .maybeSingle();
    if (rowErr || !row) return json({ error: "Proposal not found" }, 404);
    if (row.user_id !== user.id) return json({ error: "Not your proposal" }, 403);
    if (row.outcome) return json({ error: `Already ${row.outcome}`, outcome: row.outcome }, 409);

    if (action === "apply") {
      const applyErr = await applyProposalToProfile(
        supa, user.id, row.current as ProfileCurrent, row.proposal as ProfileProposal,
      );
      if (applyErr) return json({ error: `Apply failed: ${applyErr}` }, 500);
    }

    await supa
      .from("profile_update_proposals")
      .update({ outcome: action === "apply" ? "applied" : "declined", resolved_at: new Date().toISOString() })
      .eq("id", proposalId);

    return json({ ok: true, outcome: action === "apply" ? "applied" : "declined" });
  } catch (e) {
    console.error("[apply-profile-update] error:", e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
