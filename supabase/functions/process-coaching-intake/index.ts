/**
 * process-coaching-intake — takes the athlete's free-text / voice answers to the
 * Tier-3 qualitative questions, extracts a structured coaching-intake object
 * (LLM), and persists BOTH the raw answers and the extracted object onto
 * athlete_profiles. Returns the extracted object.
 *
 * Body: { answers: Record<string, string> }  (question_key → their words)
 * Auth: user JWT (self only).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  type CoachingIntakeRaw,
  COACHING_INTAKE_VERSION,
  extractCoachingIntake,
} from "../_shared/coaching-intake.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);

    // Parse + sanitize the raw answers (question_key → text).
    const body = (await req.json().catch(() => ({}))) as { answers?: unknown };
    const rawIn = body.answers && typeof body.answers === "object" ? body.answers as Record<string, unknown> : {};
    const raw: CoachingIntakeRaw = {};
    for (const [k, v] of Object.entries(rawIn)) {
      if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim().slice(0, 4000);
    }
    if (Object.keys(raw).length === 0) return json({ error: "NO_ANSWERS" }, 400);

    // Extract → structured intake (LLM).
    const intake = await extractCoachingIntake(raw);

    // Persist raw + extracted onto the profile. Service role → RLS bypassed.
    const { error: upErr } = await supa
      .from("athlete_profiles")
      .update({
        coaching_intake_raw: raw,
        coaching_intake: intake,
        coaching_intake_version: COACHING_INTAKE_VERSION,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (upErr) {
      console.error("[process-coaching-intake] persist failed:", upErr.message);
      return json({ error: "PERSIST_FAILED" }, 500);
    }

    return json({ intake }, 200);
  } catch (err) {
    console.error("[process-coaching-intake] error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
