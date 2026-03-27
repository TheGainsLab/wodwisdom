import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { callClaude, callClaudeVision } from "../_shared/call-claude.ts";

// Inlined from _shared/parse-workout-blocks.ts to avoid import resolution issues
const BLOCK_LABELS = ["Warm-up", "Mobility", "Skills", "Strength", "Metcon", "Cool down"] as const;
const BLOCK_TYPE_MAP: Record<string, string> = {
  "warm-up": "warm-up",
  "mobility": "mobility",
  "skills": "skills",
  "strength": "strength",
  "metcon": "metcon",
  "cool down": "cool-down",
};
function extractBlocksFromWorkoutText(
  text: string
): { block_type: string; block_order: number; block_text: string }[] {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const blocks: { block_type: string; block_order: number; block_text: string }[] = [];
  const labelsToFind = BLOCK_LABELS.map((l) => ({ label: l, needle: (l + ":").toLowerCase() }));
  for (let i = 0; i < labelsToFind.length; i++) {
    const { label, needle } = labelsToFind[i];
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    const next = labelsToFind.slice(i + 1).find((x) => lower.indexOf(x.needle, contentStart) >= 0);
    const end = next ? lower.indexOf(next.needle, contentStart) : text.length;
    const blockText = text.slice(contentStart, end).trim();
    const blockType = BLOCK_TYPE_MAP[label.toLowerCase()] ?? "other";
    blocks.push({ block_type: blockType, block_order: blocks.length + 1, block_text: blockText });
  }
  return blocks;
}
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBREV = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEK_REGEX = /week\s*(\d+)/i;
const DAY_COL_NAMES = ["monday", "mon", "tuesday", "tue", "tues", "wednesday", "wed", "thursday", "thu", "thur", "thurs", "friday", "fri", "saturday", "sat", "sunday", "sun"];
const DAY_COL_TO_NUM: Record<string, number> = { monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 };
const WORKOUT_HEADER_RE = /^(for\s+time|amrap\s+\d+|emom\s*\d*|e\d+mom|\d+\s*rounds?\s*(for\s+time)?|\d+\s*rft|every\s+\d+\s+min|death\s+by|tabata|buy\s+in|cash\s+out)/i;
const STRENGTH_RE = /^(?:\d+x\d+\b|@\d+%)/;
const WEEK_LABEL_RE = /week\s*(\d+)|wk\s*(\d+)/i;
interface ParsedWorkout {
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}
function isWorkoutHeader(text: string): boolean {
return WORKOUT_HEADER_RE.test(text.trim());
}
function isStrengthLine(text: string): boolean {
return STRENGTH_RE.test(text.trim());
}
function parseDayValue(val: unknown): number | null {
const s = String(val || "").trim().toLowerCase();
if (DAY_COL_TO_NUM[s] != null) return DAY_COL_TO_NUM[s];
const n = parseInt(s, 10);
if (!isNaN(n) && n >= 1 && n <= 7) return n;
return null;
}
function parseProgramText(text: string): ParsedWorkout[] {
const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
const result: ParsedWorkout[] = [];
let currentWeek = 1;
let currentDay = 1;
let sortOrder = 0;
for (const line of lines) {
const wkMatch = line.match(WEEK_REGEX);
if (wkMatch) {
      currentWeek = parseInt(wkMatch[1], 10) || 1;
continue;
}
let dayNum = currentDay;
const lower = line.toLowerCase();
for (let i = 0; i < DAY_NAMES.length; i++) {
if (lower.startsWith(DAY_NAMES[i].toLowerCase() + ":") || lower.startsWith(DAY_ABBREV[i].toLowerCase() + ":")) {
        dayNum = i + 1;
break;
}
if (lower.startsWith(DAY_NAMES[i].toLowerCase() + " ") || lower.startsWith(DAY_ABBREV[i].toLowerCase() + " ")) {
        dayNum = i + 1;
break;
}
}
const workoutText = line
.replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*:?\s*/i, "")
.trim();
if (workoutText.length > 0) {
      result.push({ week_num: currentWeek, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
      currentDay = dayNum;
}
}
if (result.length === 0) {
const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter((b) => b.length > 5);
    blocks.forEach((block, i) => {
      result.push({ week_num: Math.floor(i / 7) + 1, day_num: (i % 7) + 1, workout_text: block, sort_order: i });
});
}
return result;
}
/**
 * AI-generated format: split on "Day N:" markers (Day 1 through Day 20).
 * week_num and day_num are derived directly from N — no day name or Week label parsing needed.
 */
function parseProgramTextAI(text: string): ParsedWorkout[] {
const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
// Split on "Day N:" headers, keeping the number via a capture group
const parts = normalized.split(/^Day (\d+):/mi);
// parts layout after split with capture group:
// [preamble, N, text, N, text, ...]
const result: ParsedWorkout[] = [];
for (let i = 1; i < parts.length - 1; i += 2) {
const n = parseInt(parts[i], 10);
const workoutText = parts[i + 1].trim();
if (!workoutText) continue;
const week_num = Math.ceil(n / 5);
const day_num = ((n - 1) % 5) + 1;
    result.push({
      week_num,
      day_num,
      workout_text: workoutText,
      sort_order: n - 1,
});
}
return result;
}
function findHeaderRow(rows: (string | number)[][]): number {
for (let i = 0; i < Math.min(rows.length, 20); i++) {
const row = rows[i] || [];
const cells = row.map((c) => String(c || "").trim().toLowerCase());
const dayCount = cells.filter((c) => DAY_COL_NAMES.includes(c)).length;
if (dayCount >= 2) return i;
}
return 0;
}
function findWeekLabelsInCells(rows: (string | number)[][], startRow: number, minDayIdx: number): Map<number, number> {
const labels = new Map<number, number>();
for (let r = startRow; r < rows.length; r++) {
const row = rows[r] || [];
for (let c = 0; c < minDayIdx; c++) {
const val = row[c];
const s = String(val || "").trim();
const m = s.match(WEEK_LABEL_RE);
if (m) {
        labels.set(r, parseInt(m[1] || m[2] || "1", 10));
break;
}
}
}
return labels;
}
function isRowEmpty(row: (string | number)[], dayIdxs: number[]): boolean {
return dayIdxs.every((idx) => {
const v = row[idx];
return v == null || String(v).trim() === "";
});
}
function detectFormat(
  rows: (string | number)[][],
  startRow: number,
  dayCols: { idx: number }[]
): "A" | "B" {
const cols = dayCols.map((d) => d.idx);
let newlineCount = 0;
let longCount = 0;
let totalCount = 0;
for (let r = startRow; r < rows.length; r++) {
const row = rows[r] || [];
for (const col of cols) {
const val = row[col];
const s = String(val || "").trim();
if (s.length > 0) {
        totalCount++;
if (s.includes("\n")) newlineCount++;
if (s.length > 40) longCount++;
}
}
}
if (totalCount === 0) return "A";
if (newlineCount / totalCount > 0.2) return "B";
if (longCount / totalCount > 0.5) return "B";
return "A";
}
function splitIntoBlocks(
  rows: (string | number)[][],
  startRow: number,
  dayCols: { idx: number }[]
): { block: (string | number)[][]; startRow: number }[] {
const cols = dayCols.map((d) => d.idx);
const blocks: { block: (string | number)[][]; startRow: number }[] = [];
let current: (string | number)[][] = [];
let blockStart = startRow;
for (let r = startRow; r < rows.length; r++) {
const row = rows[r] || [];
if (isRowEmpty(row, cols)) {
if (current.length > 0) {
        blocks.push({ block: current, startRow: blockStart });
        current = [];
}
      blockStart = r + 1;
} else {
if (current.length === 0) blockStart = r;
      current.push(row);
}
}
if (current.length > 0) blocks.push({ block: current, startRow: blockStart });
return blocks;
}
function parseFormatA(
  blocksWithRows: { block: (string | number)[][]; startRow: number }[],
  dayCols: { idx: number; dayNum: number }[],
  weekLabels: Map<number, number>,
  pivotWeekCol: number
): ParsedWorkout[] {
const result: ParsedWorkout[] = [];
let sortOrder = 0;
for (let bi = 0; bi < blocksWithRows.length; bi++) {
const { block, startRow: blockStartRow } = blocksWithRows[bi];
let weekNum = bi + 1;
const lbl = weekLabels.get(blockStartRow);
if (lbl != null) weekNum = lbl;
const firstRow = block[0] as (string | number)[] | undefined;
if (pivotWeekCol >= 0 && firstRow?.[pivotWeekCol] != null) {
const w = parseInt(String(firstRow[pivotWeekCol]), 10);
if (!isNaN(w) && w >= 1) weekNum = w;
}
for (const { idx, dayNum } of dayCols) {
const cells = block.map((r) => String((r as (string | number)[])[idx] || "").trim()).filter(Boolean);
if (cells.length === 0) continue;
const segments: string[][] = [];
let seg: string[] = [];
for (const c of cells) {
if (seg.length > 0 && (isWorkoutHeader(c) || isStrengthLine(c))) {
          segments.push(seg);
          seg = [c];
} else {
          seg.push(c);
}
}
if (seg.length > 0) segments.push(seg);
for (const s of segments) {
const header = s[0] || "";
const movements = s.slice(1);
const workoutText = movements.length > 0 ? `${header}: ${movements.join(", ")}` : header;
        result.push({ week_num: weekNum, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
}
}
}
return result;
}
function parseFormatB(
  blocksWithRows: { block: (string | number)[][]; startRow: number }[],
  dayCols: { idx: number; dayNum: number }[],
  weekLabels: Map<number, number>,
  pivotWeekCol: number
): ParsedWorkout[] {
const result: ParsedWorkout[] = [];
let sortOrder = 0;
for (let bi = 0; bi < blocksWithRows.length; bi++) {
const { block, startRow: blockStartRow } = blocksWithRows[bi];
let weekNum = bi + 1;
const lbl = weekLabels.get(blockStartRow);
if (lbl != null) weekNum = lbl;
const firstRow = block[0] as (string | number)[] | undefined;
if (pivotWeekCol >= 0 && firstRow?.[pivotWeekCol] != null) {
const w = parseInt(String(firstRow[pivotWeekCol]), 10);
if (!isNaN(w) && w >= 1) weekNum = w;
}
for (const { idx, dayNum } of dayCols) {
for (const row of block) {
const val = (row as (string | number)[])[idx];
const s = String(val || "").trim();
if (s.length === 0) continue;
const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
const workoutText = lines.length > 1 ? `${lines[0]}: ${lines.slice(1).join(", ")}` : (lines[0] || s);
        result.push({ week_num: weekNum, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
}
}
}
return result;
}
function parseListLayout(rows: (string | number)[][]): ParsedWorkout[] {
const result: ParsedWorkout[] = [];
let headerRow = -1;
const headers: { week?: number; day?: number; workout?: number } = {};
for (let r = 0; r < Math.min(rows.length, 10); r++) {
const row = rows[r] || [];
for (let c = 0; c < row.length; c++) {
const h = String(row[c] || "").trim().toLowerCase();
if (h === "week" || h === "wk") headers.week = c;
else if (h === "day" || DAY_COL_NAMES.includes(h)) headers.day = c;
else if (["workout", "wod", "exercise", "exercises", "programming", "training"].includes(h)) headers.workout = c;
}
if (headers.workout != null || (headers.week != null && headers.day != null)) {
      headerRow = r;
break;
}
}
if (headerRow < 0 || headers.workout == null) return result;
const wCol = headers.week ?? 0;
const dCol = headers.day ?? 1;
const tCol = headers.workout!;
for (let r = headerRow + 1; r < rows.length; r++) {
const row = rows[r] || [];
const workoutVal = row[tCol];
const workoutStr = String(workoutVal || "").trim();
if (workoutStr.length === 0) continue;
let weekNum = 1;
if (headers.week != null) {
const wv = row[wCol];
const m = String(wv || "").match(WEEK_LABEL_RE);
if (m) weekNum = parseInt(m[1] || m[2] || "1", 10);
else weekNum = parseInt(String(wv || 1), 10) || 1;
}
let dayNum = 1;
if (headers.day != null) {
const dv = row[dCol];
const parsed = parseDayValue(dv);
if (parsed != null) dayNum = parsed;
else {
const ds = String(dv || "").trim().toLowerCase();
if (DAY_COL_TO_NUM[ds] != null) dayNum = DAY_COL_TO_NUM[ds];
}
}
const lines = workoutStr.split("\n").map((l) => l.trim()).filter(Boolean);
const workoutText = lines.length > 1 ? `${lines[0]}: ${lines.slice(1).join(", ")}` : (lines[0] || workoutStr);
    result.push({ week_num: Math.min(52, Math.max(1, weekNum)), day_num: dayNum, workout_text: workoutText, sort_order: result.length });
}
return result;
}
function parseExcelToWorkouts(arrayBuffer: ArrayBuffer): ParsedWorkout[] {
const workbook = XLSX.read(arrayBuffer, { type: "array" });
const allResults: ParsedWorkout[] = [];
for (let si = 0; si < workbook.SheetNames.length; si++) {
const sheetName = workbook.SheetNames[si];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as (string | number)[][];
if (!rows || rows.length < 1) continue;
const headerRowIdx = findHeaderRow(rows);
const headerRow = (rows[headerRowIdx] || []).map((c) => String(c || "").trim().toLowerCase());
const dayCols = headerRow
.map((h, i) => (DAY_COL_NAMES.includes(h) ? { idx: i, dayNum: DAY_COL_TO_NUM[h] || 1 } : null))
.filter((x): x is { idx: number; dayNum: number } => x != null)
.sort((a, b) => a.dayNum - b.dayNum);
const minDayIdx = dayCols.length > 0 ? Math.min(...dayCols.map((d) => d.idx)) : 999;
const pivotWeekCol = headerRow.findIndex((h) => h === "week" || h === "wk");
const startRow = headerRowIdx + 1;
const weekLabels = findWeekLabelsInCells(rows, startRow, minDayIdx);
const sheetWeekMatch = sheetName.match(WEEK_LABEL_RE);
const sheetWeek = sheetWeekMatch ? parseInt(sheetWeekMatch[1] || sheetWeekMatch[2] || "1", 10) : null;
if (dayCols.length >= 2) {
const blocks = splitIntoBlocks(rows, startRow, dayCols);
const fmt = detectFormat(rows, startRow, dayCols);
const sheetResults =
        fmt === "A" ? parseFormatA(blocks, dayCols, weekLabels, pivotWeekCol) : parseFormatB(blocks, dayCols, weekLabels, pivotWeekCol);
if (sheetWeek != null && weekLabels.size === 0) {
for (const r of sheetResults) r.week_num = sheetWeek;
}
const baseSort = allResults.length;
      sheetResults.forEach((r, i) => {
        r.sort_order = baseSort + i;
});
      allResults.push(...sheetResults);
} else {
const listResults = parseListLayout(rows);
if (listResults.length > 0) allResults.push(...listResults);
}
}
return allResults.filter((w) => w.workout_text.length > 0);
}
/**
 * Resolve the calling user's ID.
 * - If the bearer token IS the service-role key AND body contains user_id, trust it (internal call).
 * - Otherwise, validate the JWT and extract the user from it (normal user call).
 */
async function resolveUserId(
  supa: ReturnType<typeof createClient>,
  authHeader: string,
  bodyUserId?: string | null,
): Promise<{ userId: string; error?: never } | { userId?: never; error: string }> {
const token = authHeader.replace("Bearer ", "");
// Internal service-role call with explicit user_id
if (token === SUPABASE_SERVICE_KEY && bodyUserId) {
return { userId: bodyUserId };
}
// Normal user JWT
const { data: { user }, error } = await supa.auth.getUser(token);
if (error || !user) return { error: "Unauthorized" };
return { userId: user.id };
}
// ─── Inline block parsing prompts ────────────────────────────────────

const METCON_PROMPT = `You parse CrossFit/fitness metcon (metabolic conditioning) workout descriptions into individual movements.

Return ONLY a JSON array. Each element:
{
  "movement": "Clean, canonical movement name",
  "category": "weighted" | "bodyweight" | "monostructural",
  "reps": <number or null>,
  "weight": <number or null>,
  "weight_unit": "lbs" | "kg" | null,
  "distance": <number or null>,
  "distance_unit": "m" | "ft" | "cal" | null
}

Rules:
- Extract each distinct movement from the workout description.
- Use CANONICAL movement names (title case with hyphens for compound names).
- Category: "weighted" = external load, "bodyweight" = bodyweight only, "monostructural" = cardio/engine.
- For distance-based movements (500m Row, 400m Run), set distance + distance_unit, reps = null.
- For calorie-based cardio (30 Cal Row), set reps = 30, distance = null, distance_unit = "cal".
- For weighted movements, extract the Rx weight (first number in slash notation like 95/65 → 95).
- Return ONE entry per unique movement, not one per round.
- Always report reps PER ROUND, never totaled across rounds.
- For rep-scheme workouts (21-15-9), report reps as the FIRST round only. Example: "21-15-9 Thrusters, Pull-Ups" → Thruster reps: 21.
- For rounds-based workouts (5 RFT), report PER-ROUND reps. Example: "5 RFT: 15 Thrusters, 10 Pull-Ups" → Thruster reps: 15.
- For AMRAP workouts, report reps PER ROUND.
- Strip format headers. Do NOT include rest periods or coaching cues.
- Output valid JSON only, no markdown fences.`;

const SKILLS_PROMPT = `You parse CrossFit/fitness skill block descriptions into individual movements.

Return ONLY a JSON array. Each element:
{
  "movement": "Clean, capitalized movement name",
  "sets": <number or null>,
  "reps": <number or null>,
  "hold_seconds": <number or null>,
  "notes": "<any modifier like 'from 10ft', 'deficit', 'strict', etc. or null>"
}

Rules:
- Split compound entries (joined by +, &, commas, newlines) into SEPARATE objects.
- "4x5 Kipping Pull-Ups" → sets: 4, reps: 5.
- "3 legless rope climb descents from 10ft" → sets: null, reps: 3, notes: "from 10ft".
- ":30 L-sit hold" → hold_seconds: 30, sets: null, reps: null.
- Strip structure headers (EMOM, rounds, "for quality", minute markers).
- Do NOT include rest periods, coaching cues, or tempo prescriptions as separate movements.
- Output valid JSON only, no markdown fences.`;

const STRENGTH_PROMPT = `You parse CrossFit/fitness strength block descriptions into individual movements.

Return ONLY a JSON array. Each element:
{
  "movement": "Clean, canonical movement name",
  "sets": <number or null>,
  "reps": <number or null>,
  "weight": <number or null>,
  "weight_unit": "lbs" | "kg" | null,
  "percentage": <number or null>,
  "notes": "<any modifier like 'tempo 3010', 'from blocks', 'paused', etc. or null>"
}

Rules:
- Extract each distinct movement from the strength block.
- Use CANONICAL movement names (title case).
- For sets×reps: "5×3" → sets: 5, reps: 3.
- For percentage: "@80%" or "@ 80-85%" → percentage: 80 (lowest value in range).
- For absolute weights: "225 lbs" or "(225/155)" → weight: 225, weight_unit: "lbs" (first number in slash).
- If both percentage and weight are present, include both.
- Put modifiers (tempo, pauses, deficit, from blocks, build to) in notes.
- Return ONE entry per unique movement.
- Do NOT include rest periods, coaching cues, or warm-up instructions.
- Output valid JSON only, no markdown fences.`;

const VALID_CATEGORIES = ["weighted", "bodyweight", "monostructural"];
const VALID_WEIGHT_UNITS = ["lbs", "kg"];
const VALID_DISTANCE_UNITS = ["m", "ft", "cal"];

async function parseBlock(
  blockType: string,
  blockText: string,
  apiKey: string
): Promise<Record<string, unknown>[] | null> {
  const prompt =
    blockType === "metcon" ? METCON_PROMPT :
    blockType === "skills" ? SKILLS_PROMPT :
    STRENGTH_PROMPT;

  const raw = await callClaude({
    apiKey,
    system: prompt,
    userContent: blockText,
    maxTokens: 1024,
  });

  const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let items: Record<string, unknown>[];
  try {
    items = JSON.parse(cleaned);
    if (!Array.isArray(items)) return null;
  } catch {
    console.error(`[preprocess-program] failed to parse ${blockType} response:`, raw);
    return null;
  }

  // Filter to items with a movement name
  items = items.filter((m) => m.movement && typeof m.movement === "string");

  // Normalize per block type
  if (blockType === "metcon") {
    items = items.map((m) => ({
      movement: (m.movement as string).trim(),
      category: VALID_CATEGORIES.includes(m.category as string) ? m.category : "bodyweight",
      reps: typeof m.reps === "number" ? m.reps : null,
      weight: typeof m.weight === "number" ? m.weight : null,
      weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit) ? m.weight_unit : null,
      distance: typeof m.distance === "number" ? m.distance : null,
      distance_unit: typeof m.distance_unit === "string" && VALID_DISTANCE_UNITS.includes(m.distance_unit) ? m.distance_unit : null,
    }));
  } else if (blockType === "skills") {
    items = items.map((m) => ({
      movement: (m.movement as string).trim(),
      sets: typeof m.sets === "number" ? m.sets : null,
      reps: typeof m.reps === "number" ? m.reps : null,
      hold_seconds: typeof m.hold_seconds === "number" ? m.hold_seconds : null,
      notes: typeof m.notes === "string" && (m.notes as string).trim() ? (m.notes as string).trim() : null,
    }));
  } else {
    // strength
    items = items.map((m) => ({
      movement: (m.movement as string).trim(),
      sets: typeof m.sets === "number" ? m.sets : null,
      reps: typeof m.reps === "number" ? m.reps : null,
      weight: typeof m.weight === "number" ? m.weight : null,
      weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit as string) ? m.weight_unit : null,
      percentage: typeof m.percentage === "number" ? m.percentage : null,
      notes: typeof m.notes === "string" && (m.notes as string).trim() ? (m.notes as string).trim() : null,
    }));
  }

  // Deduplicate: keep first occurrence per movement name
  const seen = new Set<string>();
  const deduped: typeof items = [];
  for (const m of items) {
    const key = (m.movement as string).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }

  return deduped;
}

// ─── Combined AI parser: splits into days AND classifies blocks in one call ───

interface ParsedDay {
  week_num: number;
  day_num: number;
  blocks: { block_type: string; block_order: number; block_text: string }[];
}

const PARSE_PROGRAM_PROMPT = `You parse raw gym/CrossFit programming text into training days and their blocks in a SINGLE pass.

Return ONLY a JSON array where each element is a training day:
[
  {
    "week_num": 1,
    "day_num": 1,
    "blocks": [
      {
        "block_type": "strength",
        "block_order": 1,
        "block_text": "Back Squat 5x5 @80%"
      },
      {
        "block_type": "metcon",
        "block_order": 2,
        "block_text": "3 Rounds For Time:\\n15 Wall Balls 20/14\\n12 Toes to Bar\\n9 Power Cleans 135/95"
      }
    ]
  }
]

DAY SPLITTING RULES:
- A "day" is an ENTIRE training session. Everything between one day header and the next belongs to ONE day.
- Day headers: "Monday", "Tuesday", "Day 1", "Day 2", etc.
- INCLUDE rest days and active recovery days (single block with block_type "other").
- day_num: 1=Monday through 7=Sunday, or sequential if no day names.
- week_num: use week labels if present, otherwise default to 1.
- A 7-day week should produce exactly 7 entries.

BLOCK CLASSIFICATION RULES:
- Split each day's content into blocks based on section markers: "A)" "B)" "A." "B." "Part A" "Part B" "Then:" or content shifts.
- Classify each block by its CONTENT (not its label):
  - strength: barbell/dumbbell work with sets×reps and percentages (5x5, 3x3 @80%, build to heavy single)
  - metcon: AMRAP, For Time, RFT, EMOM with multiple movements, timed workouts
  - skills: gymnastics practice, progression work, skill drills
  - warm-up: general preparation, light cardio, movement prep
  - cool-down: stretching, foam rolling, recovery
  - mobility: targeted joint work, banded stretches
  - accessory: isolation work, core, supplemental exercises
  - other: rest days, active recovery, anything that doesn't fit above
- Preserve the original text in block_text exactly. Do not rewrite or summarize.
- Strip section labels (A), B), Part A, etc.) from block_text but keep the workout content.
- If a day has no clear section divisions, treat the entire content as one block and classify it.

Output valid JSON only, no markdown fences.`;

async function parseProgramVision(
  imageBase64: string,
  mediaType: string,
  apiKey: string,
): Promise<ParsedDay[]> {
  try {
    console.log("[preprocess-program] parseProgramVision called, mediaType:", mediaType);
    const raw = await callClaudeVision({
      apiKey,
      system: PARSE_PROGRAM_PROMPT,
      images: [{ base64: imageBase64, mediaType }],
      textPrompt: "Parse this gym programming image into training days and blocks.",
      maxTokens: 8192,
    });
    console.log("[preprocess-program] parseProgramVision raw response:", raw.substring(0, 500));
    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const items = JSON.parse(cleaned);
    if (!Array.isArray(items)) return [];
    return items
      .filter((d: Record<string, unknown>) => d.blocks && Array.isArray(d.blocks))
      .map((d: Record<string, unknown>) => ({
        week_num: typeof d.week_num === "number" ? d.week_num : 1,
        day_num: typeof d.day_num === "number" ? d.day_num : 1,
        blocks: (d.blocks as Record<string, unknown>[])
          .filter((b) => b.block_text && typeof b.block_text === "string")
          .map((b, i) => ({
            block_type: String(b.block_type || "other"),
            block_order: typeof b.block_order === "number" ? b.block_order : i + 1,
            block_text: String(b.block_text).trim(),
          })),
      }));
  } catch (e) {
    console.error("[preprocess-program] parseProgramVision error:", e);
    return [];
  }
}

async function parseProgramAI(
  rawText: string,
  apiKey: string,
): Promise<ParsedDay[]> {
  try {
    console.log("[preprocess-program] parseProgramAI called, input length:", rawText.length);
    const raw = await callClaude({
      apiKey,
      system: PARSE_PROGRAM_PROMPT,
      userContent: rawText,
      maxTokens: 8192,
    });
    console.log("[preprocess-program] parseProgramAI raw response:", raw.substring(0, 500));
    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const items = JSON.parse(cleaned);
    if (!Array.isArray(items)) {
      console.error("[preprocess-program] parseProgramAI: not an array");
      return [];
    }
    console.log("[preprocess-program] parseProgramAI parsed", items.length, "days");
    return items
      .filter((d: Record<string, unknown>) => d.blocks && Array.isArray(d.blocks))
      .map((d: Record<string, unknown>) => ({
        week_num: typeof d.week_num === "number" ? d.week_num : 1,
        day_num: typeof d.day_num === "number" ? d.day_num : 1,
        blocks: (d.blocks as Record<string, unknown>[])
          .filter((b) => b.block_text && typeof b.block_text === "string")
          .map((b, i) => ({
            block_type: String(b.block_type || "other"),
            block_order: typeof b.block_order === "number" ? b.block_order : i + 1,
            block_text: String(b.block_text).trim(),
          })),
      }));
  } catch (e) {
    console.error("[preprocess-program] parseProgramAI error:", e);
    return [];
  }
}

console.log("[preprocess-program] v2 loaded");
Deno.serve(async (req) => {
if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
try {
console.log("[preprocess-program] v2 handling request");
const authHeader = req.headers.get("Authorization");
if (!authHeader) {
return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
});
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const body = await req.json();
const { name, text, file_base64, file_type, source, user_id: bodyUserId, gym_name, is_ongoing, append_to_program_id } = body;
const resolved = await resolveUserId(supa, authHeader, bodyUserId);
if (resolved.error) {
return new Response(JSON.stringify({ error: resolved.error }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
});
}
const userId = resolved.userId;
let workouts: ParsedWorkout[] = [];
const isGenerated = source === "generate";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Extract raw text from input (file or direct text)
let rawText: string | null = null;
let parsedDays: ParsedDay[] = [];
if (file_base64 && file_type) {
const buf = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
const arrayBuffer = buf.buffer;
if (file_type === "xlsx" || file_type === "xls") {
  if (isGenerated) {
    workouts = parseExcelToWorkouts(arrayBuffer);
  } else {
    // For external Excel files, dump raw cell data and let AI parse it
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const lines: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as (string | number)[][];
      if (rows.length === 0) continue;
      if (wb.SheetNames.length > 1) lines.push(`--- Sheet: ${sheetName} ---`);
      for (const row of rows) {
        lines.push(row.map((c) => String(c ?? "")).join("\t"));
      }
    }
    rawText = lines.join("\n");
  }
} else if (file_type === "txt" || file_type === "csv") {
const decoder = new TextDecoder("utf-8");
rawText = decoder.decode(buf);
if (isGenerated) {
  workouts = parseProgramTextAI(rawText);
  rawText = null; // skip AI path
}
} else if (["png", "jpg", "jpeg", "webp", "heic"].includes(file_type)) {
  // Image: use Claude vision directly
  if (ANTHROPIC_API_KEY) {
    const mediaTypes: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic",
    };
    parsedDays = await parseProgramVision(file_base64, mediaTypes[file_type] || "image/jpeg", ANTHROPIC_API_KEY);
    workouts = parsedDays.map((d, i) => ({
      week_num: d.week_num,
      day_num: d.day_num,
      workout_text: d.blocks.map((b) => b.block_text).join("\n\n"),
      sort_order: i,
    }));
  }
} else if (file_type === "pdf") {
  // PDF: send each page as an image to Claude vision
  // For now, treat the PDF as a single image (first page)
  // Claude can read PDFs sent as images
  if (ANTHROPIC_API_KEY) {
    parsedDays = await parseProgramVision(file_base64, "application/pdf", ANTHROPIC_API_KEY);
    workouts = parsedDays.map((d, i) => ({
      week_num: d.week_num,
      day_num: d.day_num,
      workout_text: d.blocks.map((b) => b.block_text).join("\n\n"),
      sort_order: i,
    }));
  }
} else {
return new Response(JSON.stringify({ error: "Unsupported file type. Use xlsx, xls, txt, csv, pdf, or image files." }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
});
}
} else if (text && typeof text === "string") {
rawText = text.trim();
if (isGenerated) {
  workouts = parseProgramTextAI(rawText);
  rawText = null; // skip AI path
}
} else {
return new Response(JSON.stringify({ error: "Provide text or file_base64 with file_type" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
});
}
// For non-generated programs, use combined AI parser (days + blocks in one call)
if (rawText && workouts.length === 0 && ANTHROPIC_API_KEY) {
  console.log("[preprocess-program] using combined AI parser for non-generated program");
  parsedDays = await parseProgramAI(rawText, ANTHROPIC_API_KEY);
  // Convert to workouts format (workout_text = blocks joined)
  workouts = parsedDays.map((d, i) => ({
    week_num: d.week_num,
    day_num: d.day_num,
    workout_text: d.blocks.map((b) => b.block_text).join("\n\n"),
    sort_order: i,
  }));
  console.log("[preprocess-program] AI parser returned", workouts.length, "days with blocks");
}
// Fallback: if AI parsing failed or no API key, try regex as last resort
if (rawText && workouts.length === 0) {
  console.log("[preprocess-program] AI parser returned 0, falling back to regex");
  workouts = parseProgramText(rawText);
}
if (workouts.length === 0) {
return new Response(JSON.stringify({ error: "Could not parse any workouts from the input." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
});
}
// AI-generated programs must produce exactly 20 workouts (5 days × 4 weeks)
if (isGenerated && workouts.length !== 20) {
return new Response(JSON.stringify({ error: `Expected exactly 20 workouts, got ${workouts.length}` }), {
        status: 422,
        headers: { ...cors, "Content-Type": "application/json" },
});
}
// If appending to an existing program, verify ownership and use that program
let progId: string;
if (append_to_program_id) {
  const { data: existing, error: existErr } = await supa
    .from("programs")
    .select("id")
    .eq("id", append_to_program_id)
    .eq("user_id", userId)
    .single();
  if (existErr || !existing) {
    return new Response(JSON.stringify({ error: "Program not found" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  progId = existing.id;
} else {
  const programName = (name && String(name).trim()) || "Untitled Program";
  const insertObj: Record<string, unknown> = { user_id: userId, name: programName };
  if (source === "external") {
    insertObj.source = "external";
    if (gym_name) insertObj.gym_name = String(gym_name).trim();
    insertObj.is_ongoing = is_ongoing === true;
  }
  const { data: prog, error: progErr } = await supa
    .from("programs")
    .insert(insertObj)
    .select("id")
    .single();
  if (progErr || !prog) {
    return new Response(JSON.stringify({ error: "Failed to create program" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  progId = prog.id;
}
const rows = workouts.map((w, i) => ({
      program_id: progId,
      week_num: w.week_num,
      day_num: w.day_num,
      workout_text: w.workout_text,
      sort_order: i,
}));
const { data: insertedWorkouts, error: wkErr } = await supa
.from("program_workouts")
.insert(rows)
.select("id, workout_text");
if (wkErr) {
if (!append_to_program_id) await supa.from("programs").delete().eq("id", progId);
return new Response(JSON.stringify({ error: "Failed to save workouts" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
});
}
console.log(`[preprocess-program] v2 inserted ${insertedWorkouts?.length ?? 0} workouts, prog=${progId}`);
let insertedBlocksForParsing: { id: string; block_type: string; block_text: string }[] | null = null;

if (insertedWorkouts?.length) {
const blockRows: { program_workout_id: string; block_type: string; block_order: number; block_text: string }[] = [];

if (parsedDays.length > 0) {
  // We have pre-parsed blocks from the combined AI parser — use them directly
  for (let i = 0; i < insertedWorkouts.length && i < parsedDays.length; i++) {
    const w = insertedWorkouts[i];
    const day = parsedDays[i];
    for (const b of day.blocks) {
      blockRows.push({
        program_workout_id: w.id,
        block_type: b.block_type,
        block_order: b.block_order,
        block_text: b.block_text,
      });
    }
  }
  console.log(`[preprocess-program] wrote ${blockRows.length} blocks from AI parser`);
} else {
  // Generated programs: use regex block extraction (labels are guaranteed)
  for (const w of insertedWorkouts) {
    const blocks = extractBlocksFromWorkoutText(w.workout_text);
    for (const b of blocks) {
      blockRows.push({
        program_workout_id: w.id,
        block_type: b.block_type,
        block_order: b.block_order,
        block_text: b.block_text,
      });
    }
  }
}
if (blockRows.length > 0) {
  const { data: insertedBlocks } = await supa
    .from("program_workout_blocks")
    .insert(blockRows)
    .select("id, block_type, block_text");
  insertedBlocksForParsing = insertedBlocks;
}
}

const response = new Response(
JSON.stringify({
        program_id: progId,
        workout_count: workouts.length,
}),
{
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
}
);

// Parse blocks in background — don't block the response
const parseInBackground = async () => {
  if (!insertedBlocksForParsing?.length) return;
  const ANTHROPIC_API_KEY_BG = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY_BG) return;
  const parseable = insertedBlocksForParsing.filter((b) =>
    ["metcon", "skills", "strength"].includes(b.block_type)
  );
  if (parseable.length === 0) return;
  console.log(`[preprocess-program] background: parsing ${parseable.length} blocks`);
  const CONCURRENCY = 3;
  for (let i = 0; i < parseable.length; i += CONCURRENCY) {
    const batch = parseable.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (b) => {
      try {
        const parsed = await parseBlock(b.block_type, b.block_text, ANTHROPIC_API_KEY_BG);
        if (parsed) {
          await supa
            .from("program_workout_blocks")
            .update({ parsed_tasks: parsed })
            .eq("id", b.id);
        }
      } catch (e) {
        console.error(`[preprocess-program] background parse error for block ${b.id}:`, e);
      }
    }));
  }
  console.log(`[preprocess-program] background: finished parsing ${parseable.length} blocks`);
};

EdgeRuntime.waitUntil(parseInBackground());

return response;
} catch (e) {
return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
});
}
});
