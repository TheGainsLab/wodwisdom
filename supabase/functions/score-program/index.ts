/**
 * score-program — Methodology Adherence Score, Phase 1 (ADMIN-ONLY test tool).
 *
 * Scores a pasted program against the open methodology. Stateless: nothing
 * is persisted; the client holds the parsed structure between the two steps
 * so the ratification gate stays real — nothing is scored that the coach
 * (for now: the admin) hasn't confirmed.
 *
 * Actions:
 *   { action: "parse", text }      → Sonnet structures raw program text into
 *                                    days → pieces with parsed tasks. The one
 *                                    AI call in the pipeline (~1 call/upload).
 *   { action: "score", program }   → deterministic: analyzeBlocks over the
 *                                    ratified structure, then the rubric.
 *                                    Zero tokens.
 *   { action: "selftest" }         → version + env checks.
 *
 * ACCESS: admin only while this is a test tool. When it becomes a product
 * surface, this gate changes to an entitlement check — and the admin
 * invariant (no limit ever applies to an admin) carries over.
 *
 * NAMING LAW: no output of this function — scores, verdicts, findings — may
 * contain the word "CrossFit" or imply a vendor relationship.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/call-claude.ts";
import { analyzeBlocks, type BlockInput } from "../_shared/analyzer.ts";
import { buildMovementsContext, type MovementsRow } from "../_shared/build-movements-context.ts";
import { scoreMethodology } from "../_shared/methodology-rubric.ts";

const FUNCTION_VERSION = "2026-10-19.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const MAX_TEXT_CHARS = 60_000;

const PIECE_TYPES = ["strength", "metcon", "skills", "accessory", "warm-up", "cool-down", "mobility", "other"] as const;
type PieceType = typeof PIECE_TYPES[number];

interface ParsedTask {
  movement: string;
  sets?: number | null;
  reps?: number | string | null;
  weight?: number | null;
  percentage?: number | null;
  category?: "weighted" | "bodyweight" | "monostructural" | null;
}
interface Piece { type: PieceType; text: string; tasks: ParsedTask[]; notes?: string }
interface Day { week_num: number; day_num: number; label?: string; pieces: Piece[] }
interface Program { days: Day[] }

const PARSE_SYSTEM = `You convert a coach's raw training program text into a strict JSON structure. Output ONLY JSON, no prose, no code fences.

Schema:
{"days":[{"week_num":1,"day_num":1,"label":"Monday","pieces":[{"type":"metcon","text":"<the piece's text, verbatim from the input>","tasks":[{"movement":"deadlift","sets":5,"reps":5,"weight":225,"category":"weighted"}],"notes":"<only if something was unreadable>"}]}]}

Rules:
- "type" is exactly one of: strength, metcon, skills, accessory, warm-up, cool-down, mobility, other.
  strength = barbell/loaded sets-across work; metcon = conditioning with a format (AMRAP, For Time, EMOM, rounds, intervals); skills = technique or gymnastics practice; accessory = assistance/isolation work.
- "text" preserves the piece's own lines VERBATIM — it is quoted back to the coach as evidence. Never paraphrase it.
- One tasks entry per distinct movement in the piece. "movement" is the common lowercase name ("deadlift", "pull-up", "kettlebell swing", "row").
- "weight" is the prescribed load as a number (use the heavier/male load when two are given, e.g. 135 from "135/95"); "percentage" when prescribed as % of a max; omit both for bodyweight and set "category":"bodyweight". Running, rowing, biking, jumping rope, swimming → "category":"monostructural".
- "reps" may be a number or a scheme string like "21-15-9".
- week_num/day_num: number days in order; start a new week_num when the text says so (Week 2, W2) — otherwise everything is week 1.
- Never invent movements, loads, or pieces that are not in the text. Anything you cannot read goes in "notes" on the piece.
- If the text contains no recognizable training program, return {"days":[]}.`;

function json(body: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Coerce the model's output into a validated Program, dropping junk. */
function validateProgram(raw: unknown): Program {
  const days: Day[] = [];
  const rawDays = (raw as { days?: unknown })?.days;
  if (!Array.isArray(rawDays)) return { days };
  for (const d of rawDays) {
    if (!d || typeof d !== "object") continue;
    const dd = d as Record<string, unknown>;
    const pieces: Piece[] = [];
    for (const p of Array.isArray(dd.pieces) ? dd.pieces : []) {
      if (!p || typeof p !== "object") continue;
      const pp = p as Record<string, unknown>;
      const type = PIECE_TYPES.includes(pp.type as PieceType) ? pp.type as PieceType : "other";
      const text = typeof pp.text === "string" ? pp.text : "";
      if (!text.trim()) continue;
      const tasks: ParsedTask[] = [];
      for (const t of Array.isArray(pp.tasks) ? pp.tasks : []) {
        if (!t || typeof t !== "object") continue;
        const tt = t as Record<string, unknown>;
        if (typeof tt.movement !== "string" || !tt.movement.trim()) continue;
        tasks.push({
          movement: tt.movement.trim().toLowerCase(),
          sets: typeof tt.sets === "number" ? tt.sets : null,
          reps: typeof tt.reps === "number" || typeof tt.reps === "string" ? tt.reps : null,
          weight: typeof tt.weight === "number" ? tt.weight : null,
          percentage: typeof tt.percentage === "number" ? tt.percentage : null,
          category: tt.category === "weighted" || tt.category === "bodyweight" || tt.category === "monostructural"
            ? tt.category : null,
        });
      }
      pieces.push({
        type, text, tasks,
        ...(typeof pp.notes === "string" && pp.notes.trim() ? { notes: pp.notes.trim() } : {}),
      });
    }
    if (pieces.length === 0) continue;
    days.push({
      week_num: typeof dd.week_num === "number" && dd.week_num > 0 ? dd.week_num : 1,
      day_num: typeof dd.day_num === "number" && dd.day_num > 0 ? dd.day_num : days.length + 1,
      ...(typeof dd.label === "string" && dd.label.trim() ? { label: dd.label.trim() } : {}),
      pieces,
    });
  }
  return { days };
}

/** The confirm-card summary: what was read, for the coach to ratify. */
function buildReadBack(program: Program) {
  const byType: Record<string, number> = {};
  const notes: string[] = [];
  let pieceCount = 0;
  for (const d of program.days) {
    for (const p of d.pieces) {
      pieceCount++;
      byType[p.type] = (byType[p.type] || 0) + 1;
      if (p.notes) notes.push(`${d.label || `Day ${d.day_num}`}: ${p.notes}`);
      if (p.tasks.length === 0 && !["warm-up", "cool-down", "mobility", "other"].includes(p.type)) {
        notes.push(`${d.label || `Day ${d.day_num}`}: no movements read from a ${p.type} piece — check it.`);
      }
    }
  }
  const weeks = new Set(program.days.map((d) => d.week_num)).size;
  return { days: program.days.length, weeks, pieces: pieceCount, by_type: byType, notes };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "selftest") {
      return json({
        version: FUNCTION_VERSION,
        anthropic_key: !!ANTHROPIC_API_KEY,
        service_key: !!SERVICE_KEY,
      }, 200, cors);
    }

    // ── Auth: admin only while this is a test tool ───────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization header" }, 401, cors);

    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData, error: userErr } = await supa.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Invalid token" }, 401, cors);

    const { data: profile } = await supa
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") {
      return json({ error: "Admin only (for now)" }, 403, cors);
    }

    // ── Parse: the one AI call — raw text → ratifiable structure ────────
    if (body.action === "parse") {
      if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500, cors);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json({ error: "text is required" }, 400, cors);
      if (text.length > MAX_TEXT_CHARS) {
        return json({ error: `Program text too long (${text.length} chars; max ${MAX_TEXT_CHARS})` }, 400, cors);
      }

      const rawOut = await callClaude({
        apiKey: ANTHROPIC_API_KEY,
        system: PARSE_SYSTEM,
        userContent: text,
        maxTokens: 8192,
        timeoutMs: 120_000,
      });
      const jsonText = rawOut.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        console.error("[score-program] parse: model returned non-JSON:", rawOut.slice(0, 300));
        return json({ error: "The parse did not return valid structure — try again or trim the text." }, 502, cors);
      }
      const program = validateProgram(parsed);
      if (program.days.length === 0) {
        return json({ error: "No training days could be read from that text." }, 422, cors);
      }
      return json({ program, read_back: buildReadBack(program), version: FUNCTION_VERSION }, 200, cors);
    }

    // ── Score: deterministic — ratified structure → stats → rubric ──────
    if (body.action === "score") {
      const program = validateProgram(body.program);
      if (program.days.length === 0) return json({ error: "program with at least one day is required" }, 400, cors);

      // Day order: week then day; sort_order is the day's index so the
      // analyzer's consecutive-day overlap detection lines up with it.
      const orderedDays = [...program.days].sort((a, b) =>
        a.week_num - b.week_num || a.day_num - b.day_num);

      const blocks: BlockInput[] = [];
      orderedDays.forEach((day, dayIndex) => {
        for (const piece of day.pieces) {
          blocks.push({
            block_type: piece.type,
            block_text: piece.text,
            parsed_tasks: piece.tasks.length > 0
              ? piece.tasks.map((t) => ({ ...t }) as Record<string, unknown>)
              : null,
            sort_order: dayIndex,
            week_num: day.week_num,
            day_num: day.day_num,
          });
        }
      });

      const { data: movementsData, error: mErr } = await supa
        .from("movements")
        .select("canonical_name, display_name, modality, category, aliases, competition_count");
      if (mErr) return json({ error: `movements load failed: ${mErr.message}` }, 500, cors);

      const movementsContext = buildMovementsContext((movementsData || []) as MovementsRow[]);
      const analysis = analyzeBlocks(blocks, movementsContext);

      const windowDays = orderedDays.length;
      const windowWeeks = new Set(orderedDays.map((d) => d.week_num)).size;
      const rubric = scoreMethodology(
        analysis,
        { days: windowDays, weeks: windowWeeks },
        movementsContext.essentialCanonicals.size,
      );

      // Overlap day labels come back as "Days N–M" keyed on day index;
      // map them to the coach's own day labels for the report.
      const dayLabels = orderedDays.map((d, i) => d.label || `Day ${i + 1}`);

      return json({ analysis, rubric, day_labels: dayLabels, version: FUNCTION_VERSION }, 200, cors);
    }

    return json({ error: "Unknown action" }, 400, cors);
  } catch (e) {
    console.error("[score-program] error:", e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500, getCorsHeaders(req));
  }
});
