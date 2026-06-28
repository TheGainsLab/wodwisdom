/**
 * profile-analysis-v2/index.ts
 *
 * The v2 profile-analysis edge function — admin-gated for Phase 1.
 * Produces a structured coaching evaluation of the athlete's profile,
 * not a 4-week program.
 *
 * Pipeline (simpler than generate-program-v2 — no audit loop, no
 * safety review):
 *
 *   1. Auth + admin gate.
 *   2. buildWriterPayload(supa, userId) — same shared payload.
 *   3. Call Claude with V2_PROFILE_ANALYSIS_SYSTEM_PROMPT +
 *      EMIT_EVALUATION_TOOL forced via tool_choice.
 *   4. Parse the tool_use response into EvaluationOutput.
 *   5. Save to profile_evaluations (evaluation_version='v2',
 *      structured_evaluation jsonb).
 *   6. Return the evaluation + saved row id.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildWriterPayload } from "../_shared/build-writer-payload.ts";
import {
  type CoachStateContent,
  evaluationFromCoachState,
} from "../_shared/coach-state.ts";
import { generateAndPersistCoachState } from "../_shared/generate-coach-state.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Render the derived evaluation into the prose `analysis` column the program
 *  generator reads (build-writer-payload). Keeps the generator working
 *  unchanged in Step 2 — its narrative is now provably derived from the typed
 *  CoachState. Markdown, athlete/coach voice. */
function renderAnalysisProse(cs: CoachStateContent): string {
  const ev = evaluationFromCoachState(cs);
  const lines: string[] = [];
  lines.push(`**${ev.headline_takeaway}**`, "");
  lines.push(ev.detailed_analysis, "");
  if (ev.strengths.length) {
    lines.push("### Strengths", ...ev.strengths.map((s) => `- ${s}`), "");
  }
  if (ev.weaknesses_and_priorities.length) {
    lines.push("### Priorities", ...ev.weaknesses_and_priorities.map((s) => `- ${s}`), "");
  }
  if (ev.recommendations.length) {
    lines.push("### Recommendations", ...ev.recommendations.map((s) => `- ${s}`), "");
  }
  return lines.join("\n").trim();
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1. Auth.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 2. Admin gate — Phase 1 admins-only.
    const { data: adminProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (adminProfile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden", message: "v2 is admin-only during Phase 1 testing." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // 2b. Target athlete — admin may evaluate any user via body.user_id; defaults
    //     to the caller. `force` (the "Re-run" override) bypasses reuse-if-current.
    let body: { user_id?: string; force?: boolean } = {};
    if (req.method === "POST") body = await req.json().catch(() => ({}));
    const targetUserId = body.user_id ?? user.id;
    const force = body.force === true;

    const t0 = Date.now();

    // 3. Build the writer payload (same shared module).
    console.log(`[profile-analysis-v2] building payload for user ${targetUserId}`);
    const payload = await buildWriterPayload(supa, targetUserId);
    console.log(
      `[profile-analysis-v2] payload built (competition_linked=${payload.competition != null} vocabulary_size=${payload.vocabulary.length})`,
    );

    // 4. Get the CoachState (judgment) — reuse-if-current by (athlete_model_version,
    //    coach_state_builder_version); generate + persist on a miss or when forced
    //    ("Re-run"). Shared with the program generator's coach_state stage, so eval
    //    and program build CoachState identically. The persisted snapshot IS the
    //    source of truth.
    const { coach_state: coachState, version: coachStateVersion, reused } =
      await generateAndPersistCoachState(supa, targetUserId, payload, { force });
    console.log(
      `[profile-analysis-v2] coach_state v${coachStateVersion} (reused=${reused}, refs athlete_model v${payload.athlete_model.version})`,
    );

    // 5. Derive the athlete-facing evaluation FROM the typed CoachState (the
    //     eval renders from the decisions, so it can't drift) and persist it to
    //     profile_evaluations: structured_evaluation keeps the existing UI shape,
    //     analysis keeps the prose the program generator reads (Step 2 leaves
    //     the generator untouched — it consumes the typed object in Step 3).
    const evaluation = evaluationFromCoachState(coachState);
    let evaluationId: string | null = null;
    try {
      const { data: row, error: insErr } = await supa
        .from("profile_evaluations")
        .insert({
          user_id: targetUserId,
          evaluation_version: "v2",
          structured_evaluation: evaluation,
          analysis: renderAnalysisProse(coachState),
          profile_snapshot: {
            basics: payload.basics,
            training_context: payload.training_context,
            competition_linked: payload.competition != null,
            athlete_model_version: payload.athlete_model.version,
            coach_state_version: coachStateVersion,
          },
        })
        .select("id")
        .single();
      if (insErr || !row) {
        console.error("[profile-analysis-v2] save failed:", insErr);
      } else {
        evaluationId = row.id as string;
        console.log(`[profile-analysis-v2] persisted evaluation ${evaluationId}`);
      }
    } catch (saveErr) {
      // Permissive — admin can still inspect the output JSON in Phase 1.
      console.error("[profile-analysis-v2] save threw:", saveErr);
    }

    const elapsedMs = Date.now() - t0;
    console.log(`[profile-analysis-v2] success in ${elapsedMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        elapsed_ms: elapsedMs,
        evaluation_id: evaluationId,
        coach_state_version: coachStateVersion,
        athlete_model_version: payload.athlete_model.version,
        coach_state: coachState,
        evaluation,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[profile-analysis-v2] unhandled:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(
      JSON.stringify({ error: "EVALUATION_FAILED", message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
