/**
 * parse-activity — free-text outside-workout entry → structured JSON.
 *
 * The entry primitive of the activities feature (and the long-term AI Logger
 * platform): the athlete types "45 min trail ride, hilly, felt hard, avg HR
 * 152" and gets back a structured card to CONFIRM before anything saves.
 * Parse-only: this function never writes — the client saves the confirmed
 * row via RLS. Same free-text→AI→structured→show-back idiom as
 * parse-injuries-constraints.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/call-claude.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const ACTIVITY_TYPES = ["ride", "run", "swim", "row", "ski", "hike", "walk", "strength", "sport", "mobility", "test", "other"] as const;

const SYSTEM_PROMPT =
  `You parse a short free-text description of a workout an athlete did into strict JSON. ` +
  `Extract ONLY what the text states or clearly implies — never invent numbers.\n\n` +
  `Output ONLY a JSON object (no prose, no fences) with these fields:\n` +
  `- activity_type: one of ${JSON.stringify(ACTIVITY_TYPES)} (best fit; "test" when the text describes a max-effort benchmark test)\n` +
  `- duration_minutes: number | null\n` +
  `- distance: number | null, distance_unit: string | null (as the athlete stated: km, mi, m)\n` +
  `- rpe: number 1-10 | null (map effort words: easy/zone 2≈4, moderate≈6, hard≈8, max≈10 — only when effort is described)\n` +
  `- avg_hr: number | null, peak_hr: number | null\n` +
  `- summary: one short line restating the activity (e.g. "Trail ride, 45 min, hilly, hard effort")\n` +
  `- is_benchmark: boolean — true ONLY for a deliberate max-effort test with a measurable result (FTP test, 1RM test, 5k time trial, max rep test)\n` +
  `- benchmark: null, or when is_benchmark: { "name": short stable test name (e.g. "bike erg 20:00 FTP", "5k run", "max strict pull-ups"), "value": number, "unit": string (W, kg, lb, reps, seconds — for times, use seconds) }\n`;

const json = (body: unknown, cors: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && isFinite(v) && v > lo && v < hi ? Math.round(v * 100) / 100 : null;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, cors, 401);
    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { user }, error: authErr } = await supa.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, cors, 401);

    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";
    if (text.length < 3) return json({ error: "text is required" }, cors, 400);
    if (!ANTHROPIC_API_KEY) return json({ error: "AI not configured" }, cors, 500);

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: SYSTEM_PROMPT,
      userContent: text,
      maxTokens: 400,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "Could not parse that — try rewording" }, cors, 422);
    // deno-lint-ignore no-explicit-any
    let p: any;
    try {
      p = JSON.parse(match[0]);
    } catch {
      return json({ error: "Could not parse that — try rewording" }, cors, 422);
    }

    // Server-side validation/clamping — the client renders this verbatim into
    // the confirm card, so it must already be sane.
    const activityType = ACTIVITY_TYPES.includes(p?.activity_type) ? p.activity_type : "other";
    const isBenchmark = p?.is_benchmark === true && p?.benchmark && typeof p.benchmark.name === "string" && typeof p.benchmark.value === "number";
    const parsed = {
      activity_type: activityType,
      duration_minutes: num(p?.duration_minutes, 0, 1440),
      distance: num(p?.distance, 0, 100000),
      distance_unit: typeof p?.distance_unit === "string" ? p.distance_unit.slice(0, 10) : null,
      rpe: num(p?.rpe, 0, 11),
      avg_hr: num(p?.avg_hr, 39, 251),
      peak_hr: num(p?.peak_hr, 39, 251),
      summary: typeof p?.summary === "string" ? p.summary.slice(0, 200) : text.slice(0, 120),
      is_benchmark: isBenchmark,
      benchmark: isBenchmark
        ? {
            name: String(p.benchmark.name).slice(0, 80),
            value: num(p.benchmark.value, 0, 10_000_000) ?? 0,
            unit: typeof p.benchmark.unit === "string" ? p.benchmark.unit.slice(0, 20) : "",
          }
        : null,
    };
    if (parsed.is_benchmark && (!parsed.benchmark || parsed.benchmark.value <= 0)) {
      parsed.is_benchmark = false;
      parsed.benchmark = null;
    }

    return json({ parsed }, cors);
  } catch (e) {
    console.error("[parse-activity] error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, cors, 500);
  }
});
