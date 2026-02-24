import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { extractBlocksFromWorkoutText } from "../_shared/parse-workout-blocks.ts";

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

/** AI-generated format: group lines by day (Monday:, Tuesday:, etc.). One workout per day. */
function parseProgramTextAI(text: string): ParsedWorkout[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const result: ParsedWorkout[] = [];
  let currentWeek = 1;
  let currentDay = 1;
  let sortOrder = 0;
  const dayLines: string[] = [];

  const dayPattern = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*:?\s*/i;

  function flushDay() {
    if (dayLines.length > 0) {
      result.push({
        week_num: currentWeek,
        day_num: currentDay,
        workout_text: dayLines.join("\n"),
        sort_order: sortOrder++,
      });
      dayLines.length = 0;
    }
  }

  for (const line of lines) {
    const wkMatch = line.match(WEEK_REGEX);
    if (wkMatch) {
      flushDay();
      currentWeek = parseInt(wkMatch[1], 10) || 1;
      continue;
    }

    const lower = line.toLowerCase();
    let isDayHeader = false;
    let dayNum = currentDay;
    for (let i = 0; i < DAY_NAMES.length; i++) {
      const d = DAY_NAMES[i].toLowerCase();
      const a = DAY_ABBREV[i].toLowerCase();
      if (lower.startsWith(d + ":") || lower.startsWith(a + ":") || lower.startsWith(d + " ") || lower.startsWith(a + " ")) {
        dayNum = i + 1;
        isDayHeader = true;
        break;
      }
    }

    if (isDayHeader) {
      const hasCoolDown = dayLines.some((l) => /^cool\s*down\s*:/i.test(l));
      if (dayNum !== currentDay && (hasCoolDown || dayLines.length === 0)) {
        flushDay();
        currentDay = dayNum;
      }
      const rest = line.replace(dayPattern, "").trim();
      if (rest.length > 0) dayLines.push(rest);
    } else if (line.length > 0) {
      dayLines.push(line);
    }
  }

  flushDay();
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
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

    const body = await req.json();
    const { name, text, file_base64, file_type, source } = body;

    let workouts: ParsedWorkout[] = [];
    const useAIParser = source === "generate";

    if (file_base64 && file_type) {
      const buf = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
      const arrayBuffer = buf.buffer;
      if (file_type === "xlsx" || file_type === "xls") {
        workouts = parseExcelToWorkouts(arrayBuffer);
      } else if (file_type === "txt" || file_type === "csv") {
        const decoder = new TextDecoder("utf-8");
        const str = decoder.decode(buf);
        workouts = useAIParser ? parseProgramTextAI(str) : parseProgramText(str);
      } else {
        return new Response(JSON.stringify({ error: "Unsupported file type. Use xlsx, xls, txt, or csv." }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    } else if (text && typeof text === "string") {
      workouts = useAIParser ? parseProgramTextAI(text.trim()) : parseProgramText(text.trim());
    } else {
      return new Response(JSON.stringify({ error: "Provide text or file_base64 with file_type" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (workouts.length === 0) {
      return new Response(JSON.stringify({ error: "Could not parse any workouts from the input." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const programName = (name && String(name).trim()) || "Untitled Program";

    const { data: prog, error: progErr } = await supa
      .from("programs")
      .insert({ user_id: user.id, name: programName })
      .select("id")
      .single();

    if (progErr || !prog) {
      return new Response(JSON.stringify({ error: "Failed to create program" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const rows = workouts.map((w, i) => ({
      program_id: prog.id,
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
      await supa.from("programs").delete().eq("id", prog.id);
      return new Response(JSON.stringify({ error: "Failed to save workouts" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (insertedWorkouts?.length) {
      const blockRows: { program_workout_id: string; block_type: string; block_order: number; block_text: string }[] = [];
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
      if (blockRows.length > 0) {
        await supa.from("program_workout_blocks").insert(blockRows);
      }
    }

    const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-program`;
    const analyzeResp = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ program_id: prog.id }),
    });

    if (!analyzeResp.ok) {
      const errBody = await analyzeResp.text();
      console.error("Analyze-program call failed:", analyzeResp.status, errBody);
    }

    return new Response(
      JSON.stringify({
        program_id: prog.id,
        workout_count: workouts.length,
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
