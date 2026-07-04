/**
 * engine-class-view — F5 free read-only gym view (GYM_PORTAL_FLOWS §F5).
 *
 * A signed-in member sees TODAY's shared Engine Class workout, block-formatted, with
 * logging + personalization visibly locked ("Ask the front desk for your version").
 * The in-gym conversion funnel; ZERO AI cost — a renderer over the cohort program
 * #551 already produces.
 *
 * GATE (decided, #550 review): status='joined' link AND an active engine_cohort-family
 * entitlement granted_by that gym — never the link alone (see gate.ts). engine_cohort_
 * programs is service-role only, so this endpoint reads the shared program server-side
 * and returns only today's blocks (Rx form) — never the whole 4-week program.
 *
 * Auth: verify_jwt=true (gateway verifies the member JWT); we decode the user id.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decodeJwtSub } from "../_shared/engine-class/auth.ts";
import { resolveMemberGym } from "../_shared/engine-class/gate.ts";
import { loadLatestProgram } from "../_shared/engine-class/queries.ts";
import { selectTodaysWorkout } from "../_shared/engine-class/select-workout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SUPABASE_KEY);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userId = decodeJwtSub(authHeader.replace("Bearer ", ""));
  if (!userId) return json({ error: "unauthorized" }, 401);

  const nowIso = new Date().toISOString();

  try {
    // Gate: joined + active family entitlement. A member who does NOT pass sees only
    // a leak-safe teaser (no programming content) — this is the "ask the front desk"
    // conversion state. Never render the gym's programming without the entitlement
    // (ex-members / cancelled gyms would otherwise see it forever).
    const gym = await resolveMemberGym(svc, userId, nowIso);
    if (!gym) {
      return json({
        access: "none",
        cta: "Ask the front desk to activate your Engine Class seat — then today's class workout shows up here and you can log results.",
      });
    }

    const program = await loadLatestProgram(svc, gym.gym_id);
    if (!program) {
      return json({ access: "gym", gym_name: gym.gym_name, class_name: gym.class_name, workout: null,
        message: "Your gym's Engine Class program hasn't been generated yet." });
    }

    const workout = selectTodaysWorkout(program.shared_output, program.created_at, nowIso);
    if (!workout) {
      return json({ access: "gym", gym_name: gym.gym_name, class_name: gym.class_name, workout: null,
        message: "No class workout scheduled." });
    }

    // Gated member: today's shared Rx workout. Loads are Rx (personalization — the
    // per-member scaled numbers in engine_member_scaling — is a follow-up; not shown
    // here in v1). A seat member can log their result (F4 leaderboard input).
    return json({
      access: "gym",
      gym_name: gym.gym_name,
      class_name: gym.class_name,
      cohort_program_id: program.id,
      can_log: true,
      personalization_available: false, // v1: Rx only; scaled loads are a follow-up
      workout: {
        week_num: workout.week_num,
        day_num: workout.day_num,
        modality: workout.modality,
        score_type: workout.score_type,
        blocks: workout.blocks, // Rx (shared) — no per-member scaled numbers yet
      },
    });
  } catch (e) {
    console.error("[engine-class-view]", userId, e);
    return json({ error: "view_failed", detail: (e as Error).message }, 500);
  }
});
