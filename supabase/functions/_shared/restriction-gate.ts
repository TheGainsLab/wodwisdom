/**
 * restriction-gate.ts — a written week never ships with a movement the
 * athlete's injuries or avoid list rule out. Fully automatic: no alert, no
 * human, no withheld week.
 *
 * Why (2026-11-23): an athlete wrote "Runners Knee, no lunges or back squats"
 * and confirmed an avoid list containing "running", "400m run", "mile run".
 * His program, built three minutes later, held "Run" ten times in cool-down
 * and mobility blocks. The only enforcing check compared spellings ("run" is
 * not "running"), a failed repair shipped with the residual logged, and the
 * one reviewer that reads MEANING (safety-review.ts) could only log.
 *
 * The gate (as changed 2026-11-26, founder: "code should not be checking AI
 * judgment"; "if the AI messes it up, we'll fix the AI"):
 *   1. JUDGE by meaning — on EVERY week, for EVERY athlete, an AI reads the
 *      finished output against everything the athlete has said about their
 *      body (injury box, signup answers, notes to the coach) and their avoid
 *      list, every block included, and names each conflict WITH a replacement.
 *   2. APPLY — code puts the AI's replacement in at the position the AI gave,
 *      under the name the AI gave. Code does not compare the name with the
 *      avoid list, with the movement list, or with what was there before.
 *      Then the judge reads the result again.
 *   3. A movement the AI flagged but gave no replacement for is put to the AI
 *      once more; if it still names none, the movement is removed. That is
 *      still the AI's judgment being applied (it said the movement cannot
 *      stay), never a match on a name.
 * The week then saves as normal.
 *
 * REMOVED 2026-11-26: the "second look" (code searching the week for avoid-list
 * names and their stemmed variants, and removing them), the refusal of an AI
 * replacement that was not an exact spelling from the movement list or that
 * matched an avoid-list name, the hiding of list names from the AI, and the
 * skipping of a finding whose echoed name differed from the row. If the AI
 * cannot be reached, the week ships as the writer wrote it; the writer was
 * given the same restrictions.
 */

import type { MovementPrescription, WriterOutput } from "./v2-output-schema.ts";
import { MODELS } from "./model-profiles.ts";
import { COUNTS_TOWARD_INSTRUCTION, COUNTS_TOWARD_VALUES, storedCountsToward } from "./counts-toward.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.sonnet;

const NO_INJURY_RE = /^(none|no|nothing|no injuries|n\/a|none\.)$/i;

export interface Restrictions {
  /** The athlete's own injury / constraint text, as written. */
  injuriesText: string | null;
  /** The avoid list in force (injury-derived + equipment-derived). */
  doNotProgram: string[];
  /** Everything ELSE the athlete has said that may bear on their body — the
   *  signup answers and their notes to the coach. An injury is not always in
   *  the injury box: one athlete left it empty and wrote "pain in shoulder"
   *  under "anything else" (2026-11-23). */
  otherWords?: string[];
  /** Stored substitutes from the injury parse. */
  suggestedSubs: Array<{ instead_of: string; use: string }>;
  /** The movement list: spellings to use when a replacement is on it.
   *  Guidance for the AI; code never checks a name against it. */
  vocabulary: string[];
}

export interface Finding {
  week_num: number;
  day_num: number;
  block_index: number;
  movement_index: number;
  movement: string;
  reason: string;
  replacement?: {
    movement?: string;
    sets?: number;
    reps?: number;
    time_seconds?: number;
    distance?: number;
    distance_unit?: "ft" | "m";
    calories?: number;
    scaling_note?: string;
    /** What the replacement counts toward (counts-toward.ts), from the AI. */
    counts_toward?: string;
  } | null;
}

export interface GateReport {
  /** Human-readable lines, one per change made. */
  actions: string[];
  /** How many times the judge answered. 0 = unreachable. */
  reviews: number;
  /** True when the judge could not be reached on some round. */
  judgeUnavailable: boolean;
}

// ── Reading the athlete's restrictions ─────────────────────────────────────

export function hasInjuryText(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t !== "" && !NO_INJURY_RE.test(t);
}

/**
 * The restriction stated for a prompt: first, absolute, in the athlete's own
 * words. Shared by the writer's rules and the judge so both read the same text.
 * Returns "" when there is nothing to state.
 */
export function restrictionsForPrompt(
  injuriesText: string | null | undefined,
  doNotProgram: string[] | null | undefined,
  otherWords?: string[] | null,
): string {
  const list = (doNotProgram ?? []).filter((m) => typeof m === "string" && m.trim() !== "");
  const injured = hasInjuryText(injuriesText);
  const other = (otherWords ?? []).map((w) => (w ?? "").trim()).filter(Boolean);
  if (!injured && list.length === 0 && other.length === 0) return "";
  const lines = ["ABSOLUTE RESTRICTIONS — these outrank every other rule, the skeleton, and any composed metcon:"];
  if (injured) lines.push(`  Under injuries the athlete wrote, in their own words: "${(injuriesText ?? "").trim()}"`);
  if (other.length > 0) {
    lines.push("  Elsewhere the athlete told us (read these for ANY pain, injury or physical limit — an injury is not always written in the injury box):");
    for (const w of other) lines.push(`    - ${w}`);
  }
  if (list.length > 0) lines.push(`  Never program: ${list.join(", ")}.`);
  // NO EXAMPLES HERE, EVER (founder, 2026-11-26: "Remove them and never put
  // them back"). This text sits directly under the athlete's own words. It
  // used to carry two worked examples ("no running" bans Run, Shuttle Run...;
  // "pain in shoulder on muscle-ups" means no handstand push-ups). The AI read
  // them as facts about the athlete in front of it: a member with no injury
  // had handstand push-ups and a shuttle run taken out "because the athlete
  // reported shoulder pain" and "running is banned". Rules only, with no
  // movement, body part or injury named. A test fails if one comes back.
  lines.push(
    "  - A listed movement is ruled out in EVERY form and under EVERY name: any distance, load, tempo or variation of it.",
    "  - This covers EVERY block: warm-up, mobility, skills, strength, accessory, metcon and cool-down alike.",
    "  - Do NOT scale, shorten or lighten a ruled-out movement — REPLACE it with a different movement that does not go against what the athlete said.",
    "  - If the athlete's words rule out something the list does not name, their words win.",
    "  - Pain in a body part restricts that body part, not only the movement they mentioned it with.",
    "  - The lines above are everything this athlete has said. Do not add a restriction they did not state.",
  );
  return lines.join("\n");
}

/**
 * What the athlete said outside the injury box, as labelled lines: the parts
 * of their signup answers that can carry a physical limit, and their notes to
 * the coach. Kept in their words; nothing is interpreted here.
 */
export function athleteWordsElsewhere(
  // deno-lint-ignore no-explicit-any
  intake: any,
  coachNotes?: string[] | null,
): string[] {
  const out: string[] = [];
  const add = (label: string, v: unknown) => {
    const items = Array.isArray(v) ? v : [v];
    for (const it of items) if (typeof it === "string" && it.trim() !== "") out.push(`${label}: "${it.trim()}"`);
  };
  if (intake && typeof intake === "object") {
    add("Injuries or limitations (signup)", intake.constraints?.injuries);
    add("Avoiding (signup)", intake.preferences?.avoid);
    add("Recovery (signup)", intake.response?.recovery_notes);
    add("Schedule or equipment (signup)", intake.constraints?.schedule_equipment_notes);
    add("Anything else (signup)", intake.freeform_notes);
  }
  add("Note to the coach", coachNotes ?? []);
  return out;
}

// ── Walking the output ─────────────────────────────────────────────────────

type Loc = { week_num: number; day_num: number; block_index: number; movement_index: number };
type AnyBlock = { block_type?: string; movements?: MovementPrescription[]; scheme_format?: { format?: string; minutes?: number; stations?: number[][] } | null };

function blockAt(output: WriterOutput, l: { week_num: number; day_num: number; block_index: number }): AnyBlock | null {
  const week = (output.weeks ?? []).find((w) => w.week_num === l.week_num);
  const day = (week?.days ?? []).find((d) => d.day_num === l.day_num);
  return ((day?.blocks ?? [])[l.block_index] as AnyBlock | undefined) ?? null;
}

const where = (l: Loc) => `W${l.week_num}D${l.day_num} block ${l.block_index}`;

// ── Fixing ─────────────────────────────────────────────────────────────────

/** Swap one movement for another, keeping the row's quantity unless the
 *  replacement brings its own. Load and 1RM anchoring never carry over to a
 *  different movement. */
function swap(row: MovementPrescription, to: string, r?: Finding["replacement"]): MovementPrescription {
  // What the OLD movement counted toward, and whether it sat on a barbell, say
  // nothing about the new one: the replacement carries its own answer from
  // the AI, or none (it is then labelled later, like any unlabelled row).
  const { weight: _w, weight_women: _ww, weight_unit: _wu, target_pct_1rm: _p, cardio_modality: _c, counts_toward: _ct, on_barbell: _ob, ...rest } = row;
  const next: MovementPrescription = { ...rest, movement: to };
  const label = storedCountsToward(r?.counts_toward);
  if (label) next.counts_toward = label;
  const brings = r && (r.sets != null || r.reps != null || r.time_seconds != null || r.distance != null || r.calories != null);
  if (brings) {
    delete next.sets; delete next.reps; delete next.rep_scheme; delete next.cal_scheme; delete next.distance_scheme;
    delete next.time_seconds; delete next.distance; delete next.distance_unit; delete next.calories; delete next.max_effort;
    if (r!.sets != null) next.sets = r!.sets;
    if (r!.reps != null) { next.reps = r!.reps; next.rep_scheme = [r!.reps]; }
    if (r!.time_seconds != null) next.time_seconds = r!.time_seconds;
    if (r!.distance != null) { next.distance = r!.distance; next.distance_unit = r!.distance_unit ?? "m"; }
    if (r!.calories != null) next.calories = r!.calories;
  }
  if (r?.scaling_note) next.scaling_note = r.scaling_note.slice(0, 200);
  return next;
}

/** Remove one movement row; keep an EMOM's station map consistent; drop the
 *  block if it was the block's only movement. */
function removeMovement(output: WriterOutput, l: Loc): void {
  const week = (output.weeks ?? []).find((w) => w.week_num === l.week_num);
  const day = (week?.days ?? []).find((d) => d.day_num === l.day_num);
  const block = (day?.blocks ?? [])[l.block_index] as AnyBlock | undefined;
  if (!day || !block?.movements) return;
  if (block.movements.length <= 1) {
    day.blocks.splice(l.block_index, 1);
    return;
  }
  block.movements.splice(l.movement_index, 1);
  const sf = block.scheme_format;
  if (sf?.stations && Array.isArray(sf.stations)) {
    sf.stations = sf.stations
      .map((slot) => slot.filter((i) => i !== l.movement_index).map((i) => (i > l.movement_index ? i - 1 : i)))
      .filter((slot) => slot.length > 0);
    if (sf.stations.length === 0) delete sf.stations;
    else if (typeof sf.minutes === "number" && sf.minutes % sf.stations.length !== 0) {
      sf.minutes = Math.max(sf.stations.length, Math.floor(sf.minutes / sf.stations.length) * sf.stations.length);
    }
  }
}

/**
 * Apply the judge's replacements, each at the position the judge gave and
 * under the name the judge gave. Nothing is compared with a list. A finding is
 * `unresolved` only when the judge named no replacement for it (or named the
 * movement that is already there, which changes nothing). A position that does
 * not exist in the output is skipped. Mutates `output`.
 */
export function applyFindings(output: WriterOutput, findings: Finding[], _r?: Restrictions): { applied: string[]; unresolved: Finding[] } {
  const applied: string[] = [];
  const unresolved: Finding[] = [];
  for (const f of findings) {
    const block = blockAt(output, f);
    const row = block?.movements?.[f.movement_index];
    if (!row) continue;
    const to = (f.replacement?.movement ?? "").trim();
    if (!to || to.toLowerCase() === (row.movement ?? "").trim().toLowerCase()) {
      unresolved.push(f);
      continue;
    }
    const was = row.movement;
    block!.movements![f.movement_index] = swap(row, to, f.replacement);
    applied.push(`${where(f)}: "${was}" replaced with "${to}" — ${f.reason}`);
  }
  return { applied, unresolved };
}

/**
 * Remove each movement at its position. No AI, no matching. Handled
 * last-to-first so removals do not shift the other positions; a position
 * listed twice is removed once.
 */
export function removeByRule(output: WriterOutput, locs: Array<Loc & { movement: string; reason?: string }>): string[] {
  const actions: string[] = [];
  const seen = new Set<string>();
  const ordered = [...locs].sort((a, b) =>
    (b.week_num - a.week_num) || (b.day_num - a.day_num) || (b.block_index - a.block_index) || (b.movement_index - a.movement_index));
  for (const l of ordered) {
    const key = `${l.week_num}-${l.day_num}-${l.block_index}-${l.movement_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = blockAt(output, l)?.movements?.[l.movement_index];
    if (!row) continue;
    const was = row.movement;
    removeMovement(output, l);
    actions.push(`${where(l)}: "${was}" removed${l.reason ? ` — ${l.reason}` : ""}`);
  }
  return actions;
}

// ── The judge ──────────────────────────────────────────────────────────────

// NO EXAMPLES OF AN INJURY, A BODY PART OR A MOVEMENT IN THIS TEXT, EVER
// (founder, 2026-11-26). See restrictionsForPrompt. A test fails if one returns.
export const JUDGE_SYSTEM = `You check AI-written training against ONE athlete's physical restrictions. Nothing else is your job: not variety, not balance, not difficulty, not whether a movement is on a list, not whether a row is complete.

You receive the athlete's restrictions (what they wrote under injuries, what they said elsewhere — signup answers and notes to their coach — and a list of movements never to program), a list of movement names for spelling, and the written training as JSON.

Pain, injury or a physical limit counts wherever the athlete mentioned it, not only under injuries. A statement of pain during one movement tells you about the body part, so other work that loads that body part the same way goes against it too. Statements that are only likes, dislikes or goals are NOT restrictions.

Flag a movement when doing it would go against what the athlete said:
  - It is on the never-program list, under any name, distance, load or variation.
  - The athlete's own words rule it out even though the list does not name it.
  - It plainly loads an injured area the athlete asked to protect.
Check EVERY block: warm-up, mobility, skills, strength, accessory, metcon, cool-down. An easy version is still a version: a lighter or slower form of a ruled-out movement is still ruled out.

Do NOT flag:
  - Movements that are merely near a restriction but do not load the area the athlete named.
  - Anything the athlete did not ask to avoid. Their words are the ground truth; do not invent restrictions. If the athlete has stated nothing, report nothing.

For every flagged movement give a replacement the athlete CAN do, that keeps the block's purpose. The replacement must not itself go against the restrictions. Give its quantity when the original quantity would not make sense for it.

Report through the report tool. Locations use the JSON's own week_num and day_num, block_index = the block's position in that day's blocks array (first is 0), movement_index = the movement's position in that block's movements array (first is 0), and movement = the name exactly as written.`;

const JUDGE_TOOL = {
  name: "report_restriction_check",
  description: "Report every movement that goes against the athlete's restrictions, each with a replacement.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        description: "Empty when the training respects every restriction.",
        items: {
          type: "object",
          properties: {
            week_num: { type: "integer" },
            day_num: { type: "integer" },
            block_index: { type: "integer", minimum: 0 },
            movement_index: { type: "integer", minimum: 0 },
            movement: { type: "string" },
            reason: { type: "string", maxLength: 240 },
            replacement: {
              type: "object",
              properties: {
                movement: { type: "string", description: "The replacement movement's name only (no notes in the name). Use the spelling from the movement names list when it is on it." },
                sets: { type: "integer", minimum: 1 },
                reps: { type: "integer", minimum: 1 },
                time_seconds: { type: "integer", minimum: 1 },
                distance: { type: "number", minimum: 1 },
                distance_unit: { type: "string", enum: ["ft", "m"] },
                calories: { type: "integer", minimum: 1 },
                scaling_note: { type: "string", maxLength: 200 },
                counts_toward: { type: "string", enum: [...COUNTS_TOWARD_VALUES], description: "For the REPLACEMENT movement. " + COUNTS_TOWARD_INSTRUCTION },
              },
              required: ["movement"],
              additionalProperties: false,
            },
          },
          required: ["week_num", "day_num", "block_index", "movement_index", "movement", "reason", "replacement"],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  },
};

/** The output reduced to what the judge needs: locations and movement lines. */
export function compactForJudge(output: WriterOutput): unknown {
  return {
    weeks: (output.weeks ?? []).map((w) => ({
      week_num: w.week_num,
      days: (w.days ?? []).map((d) => ({
        day_num: d.day_num,
        blocks: (d.blocks ?? []).map((b, bi) => {
          const blk = b as AnyBlock & { block_label?: string; block_scheme?: string };
          return {
            block_index: bi,
            block_type: blk.block_type,
            ...(blk.block_label ? { label: blk.block_label } : {}),
            ...(blk.block_scheme ? { scheme: blk.block_scheme } : {}),
            movements: (blk.movements ?? []).map((m, mi) => ({
              movement_index: mi,
              movement: m.movement,
              ...(m.sets != null ? { sets: m.sets } : {}),
              ...(m.reps != null ? { reps: m.reps } : {}),
              ...(m.rep_scheme ? { rep_scheme: m.rep_scheme } : {}),
              ...(m.weight != null ? { weight: m.weight, unit: m.weight_unit } : {}),
              ...(m.time_seconds != null ? { time_seconds: m.time_seconds } : {}),
              ...(m.distance != null ? { distance: m.distance, distance_unit: m.distance_unit } : {}),
              ...(m.calories != null ? { calories: m.calories } : {}),
              ...(m.scaling_note ? { note: m.scaling_note } : {}),
            })),
          };
        }),
      })),
    })),
  };
}

export function judgeUserMessage(output: WriterOutput, r: Restrictions, mustReplace?: Array<Loc & { movement: string }>): string {
  const subs = (r.suggestedSubs ?? []).filter((x) => x?.instead_of && x?.use).map((x) => `${x.instead_of} → ${x.use}`).join("; ");
  const must = (mustReplace ?? []).map((l) => `week ${l.week_num} day ${l.day_num} block_index ${l.block_index} movement_index ${l.movement_index} "${l.movement}"`);
  return [
    restrictionsForPrompt(r.injuriesText, r.doNotProgram, r.otherWords) || "ABSOLUTE RESTRICTIONS: the athlete has stated no injury, pain or physical limit anywhere, and has no avoid list.",
    "",
    `MOVEMENT NAMES (for spelling: when your replacement is on this list, write it exactly as listed; you may name a movement that is not on it. You decide what the athlete can do — some names here may themselves go against the restrictions): ${(r.vocabulary ?? []).join(", ")}`,
    // The list enforces nothing (founder, 2026-11-26: "the list is at best a
    // guideline and should never enforce anything"). The judge once made seven
    // swaps in one week because a movement "is not on the allowed movements list".
    `This list is ONLY a guide to spelling. A movement in the written training that is not on it is NOT a finding: never report, replace or remove a movement because it is missing from this list, is unusual, is repeated or has no quantity. Report ONLY what goes against what this athlete said.`,
    ...(subs ? ["", `SUBSTITUTES ALREADY SUGGESTED FOR THIS ATHLETE (guidance, not exact names): ${subs}`] : []),
    "",
    "WRITTEN TRAINING (JSON):",
    JSON.stringify(compactForJudge(output)),
    "",
    must.length
      ? `These movements are ALREADY KNOWN to go against the restrictions. Report EVERY ONE of them with a replacement (and anything else you find): ${must.join("; ")}`
      : "Check every movement in every block against the restrictions and report through the tool.",
  ].join("\n");
}

type Judge = (output: WriterOutput, r: Restrictions, mustReplace?: Array<Loc & { movement: string }>) => Promise<Finding[] | null>;

/** Ask the judge. Returns null when it could not be reached or answered
 *  unreadably (after one retry) — the caller then relies on the rule step. */
export const askJudge: Judge = async (output, r, mustReplace) => {
  if (!ANTHROPIC_API_KEY) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          stream: false,
          system: JUDGE_SYSTEM,
          tools: [JUDGE_TOOL],
          tool_choice: { type: "tool", name: JUDGE_TOOL.name },
          messages: [{ role: "user", content: judgeUserMessage(output, r, mustReplace) }],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!resp.ok) {
        console.error(`[restriction-gate] judge HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
        continue;
      }
      const data = await resp.json();
      const tool = (data.content ?? []).find((b: { type?: string; name?: string }) => b.type === "tool_use" && b.name === JUDGE_TOOL.name);
      const findings = (tool?.input as { findings?: unknown } | undefined)?.findings;
      if (!Array.isArray(findings)) {
        console.error("[restriction-gate] judge answer unreadable:", JSON.stringify(data).slice(0, 300));
        continue;
      }
      return findings.filter((f): f is Finding =>
        !!f && typeof f === "object" &&
        Number.isInteger((f as Finding).week_num) && Number.isInteger((f as Finding).day_num) &&
        Number.isInteger((f as Finding).block_index) && Number.isInteger((f as Finding).movement_index) &&
        typeof (f as Finding).movement === "string");
    } catch (e) {
      console.error("[restriction-gate] judge call failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return null;
};

// ── The gate ───────────────────────────────────────────────────────────────

/**
 * Run the gate over a written output, mutating it in place. Always returns;
 * never throws. After it returns, every movement the judge flagged has been
 * replaced with the judge's choice, or removed when the judge named none.
 *
 * `judge` is injectable for tests. `maxReviews` bounds the AI calls: review,
 * apply, review again.
 */
export async function runRestrictionGate(
  output: WriterOutput,
  r: Restrictions,
  opts: { judge?: Judge; maxReviews?: number } = {},
): Promise<GateReport> {
  const report: GateReport = { actions: [], reviews: 0, judgeUnavailable: false };
  const judge = opts.judge ?? askJudge;
  const maxReviews = Math.max(1, opts.maxReviews ?? 2);
  const at = (l: Loc) => `${l.week_num}-${l.day_num}-${l.block_index}-${l.movement_index}`;
  const exists = (l: Loc) => !!blockAt(output, l)?.movements?.[l.movement_index];
  // Flagged on the judge's last reading with no replacement named.
  let pending: Array<Loc & { movement: string; reason?: string }> = [];

  try {
    // EVERY week is read, for EVERY athlete — never skipped (founder,
    // 2026-11-23). An empty injury box is not evidence of no injury.
    for (let round = 1; round <= maxReviews; round++) {
      const findings = await judge(output, r);
      if (findings == null) { report.judgeUnavailable = true; break; }
      report.reviews++;
      if (findings.length === 0) { pending = []; break; }
      const { applied, unresolved } = applyFindings(output, findings);
      report.actions.push(...applied);
      pending = unresolved.filter(exists);
      if (applied.length === 0) break; // nothing changed: reading again would say the same
    }
  } catch (e) {
    // The judge path must never stop a week from shipping.
    report.judgeUnavailable = true;
    console.error("[restriction-gate] judge path failed:", e instanceof Error ? e.message : String(e));
  }

  // The judge said these cannot stay but named no replacement. It is asked
  // once more to choose one; what it still does not replace is removed.
  if (pending.length > 0) {
    let left = pending;
    try {
      // Already unreachable this run: do not wait on it again.
      const chosen = report.judgeUnavailable ? null : await judge(output, r, pending);
      if (chosen == null) report.judgeUnavailable = true;
      else {
        report.reviews++;
        const want = new Set(pending.map(at));
        const { applied, unresolved } = applyFindings(output, chosen.filter((f) => want.has(at(f))));
        report.actions.push(...applied);
        const answered = new Set(chosen.filter((f) => want.has(at(f))).map(at));
        const stillNone = new Set(unresolved.map(at));
        left = pending.filter((p) => !answered.has(at(p)) || stillNone.has(at(p)));
      }
    } catch (e) {
      report.judgeUnavailable = true;
      console.error("[restriction-gate] replacement call failed:", e instanceof Error ? e.message : String(e));
    }
    try {
      report.actions.push(...removeByRule(output, left.filter(exists)));
    } catch (e) {
      console.error("[restriction-gate] removal failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return report;
}

// ── One block (a change the coach proposes to a single day) ────────────────

/**
 * Run the gate over ONE block. Returns the block as it may be offered, or
 * null when nothing of it survives (every movement was ruled out and none
 * could be replaced) — the caller then asks for a different proposal.
 * Same steps as the full gate; never throws.
 */
export async function gateBlock<B extends { movements?: MovementPrescription[] }>(
  block: B,
  r: Restrictions,
  opts: { judge?: Judge; maxReviews?: number } = {},
): Promise<{ block: B | null; actions: string[]; judgeUnavailable: boolean }> {
  const copy = JSON.parse(JSON.stringify(block)) as B;
  // deno-lint-ignore no-explicit-any
  const wrapped = { weeks: [{ week_num: 1, days: [{ day_num: 1, blocks: [copy] }] }] } as any as WriterOutput;
  const rep = await runRestrictionGate(wrapped, r, opts);
  const left = wrapped.weeks?.[0]?.days?.[0]?.blocks ?? [];
  // Locations mean nothing for a single block: say only what changed.
  const actions = rep.actions.map((a) => a.replace(/^W1D1 block 0: /, ""));
  return { block: left.length > 0 ? (left[0] as unknown as B) : null, actions, judgeUnavailable: rep.judgeUnavailable };
}

