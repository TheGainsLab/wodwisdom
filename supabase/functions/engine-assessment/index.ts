/**
 * engine-assessment — writes the standing read of an Engine member's
 * conditioning (see _shared/engine-assessment.ts).
 *
 * PHASE 1 (2026-11-26): DRY RUN ONLY. It reads, asks the AI and RETURNS the
 * assessment and the facts it was written from. It stores nothing and no
 * coach is given it. The founder reads a few dozen before it is used.
 *
 * Auth: service role only.
 * Invoke: POST <fn-url>?limit=5            the 5 Engine members who trained most recently
 *         POST <fn-url>?user_ids=a,b,c     named members
 *         add &facts=true to return the facts text as well
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEngineAssessmentInputs, ENGINE_ASSESSMENT_BUILDER_VERSION, renderEngineAssessment, writeEngineAssessment } from "../_shared/engine-assessment.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function isServiceRole(header: string | null): boolean {
  const token = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SUPABASE_SERVICE_KEY) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!isServiceRole(req.headers.get("Authorization"))) return json({ error: "service role only" }, 401);
  const params = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(12, parseInt(params.get("limit") ?? "5", 10) || 5));
  const withFacts = params.get("facts") === "true";
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let userIds = (params.get("user_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  if (userIds.length === 0) {
    // The members who trained most recently, each once.
    const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
    const { data: recent } = await supa.from("engine_workout_sessions").select("user_id, created_at").eq("completed", true).order("created_at", { ascending: false }).limit(1500);
    const seen: string[] = [];
    for (const r of (recent ?? []) as Array<{ user_id: string }>) if (!seen.includes(r.user_id)) seen.push(r.user_id);
    userIds = seen.slice(offset, offset + limit);
  }

  const results = await Promise.all(userIds.map(async (userId) => {
    try {
      const facts = await buildEngineAssessmentInputs(supa, userId);
      if (!facts) return { user_id: userId, skipped: "no Engine program or no Engine data" };
      const assessment = await writeEngineAssessment(facts);
      if (!assessment) return { user_id: userId, failed: "the AI gave no usable answer", ...(withFacts ? { facts } : {}) };
      return { user_id: userId, assessment, rendered: renderEngineAssessment(assessment), ...(withFacts ? { facts } : {}) };
    } catch (e) {
      return { user_id: userId, failed: e instanceof Error ? e.message : String(e) };
    }
  }));
  return json({ dry_run: true, stored: false, builder_version: ENGINE_ASSESSMENT_BUILDER_VERSION, count: results.length, results });
});
