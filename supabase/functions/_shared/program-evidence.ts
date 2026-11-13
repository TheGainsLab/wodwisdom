/**
 * program-evidence — what the athlete ACTUALLY DID in the prior weeks of
 * this program, for the week fill. Founder, 2026-11-13: the skeleton is a
 * hypothesis; each later week is written from the athlete's reaction. The
 * fill progresses from what was lifted, not what was planned; skipped days
 * and blocks are not progressed from; skip reasons are data.
 *
 * Pure (summarizeEvidence, tested) + one loader. Under monthly generation
 * nothing is logged yet when the weeks are written, so the block is ""
 * and the prompt is byte-identical to before; the weekly cron (PR 4) is
 * where this pays off.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface EvidenceMovement {
  movement: string;
  sets: number;
  reps: number | null;
  weight: number | null;
  unit: string | null;
  prescribed_weight: number | null;
  prescribed_reps: number | null;
  rpe: number | null;
  skipped: boolean;
  skip_reason: string | null;
}

export interface EvidenceBlock {
  label: string;
  type: string | null;
  rpe: number | null;
  score: string | null;
  time_domain: string | null;
  notes: string | null;
  skipped: boolean;
  skip_reason: string | null;
  movements: EvidenceMovement[];
}

export interface EvidenceDay {
  week: number;
  day: number;
  status: "logged" | "not_done";
  date: string | null;
  blocks: EvidenceBlock[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** One line per logged day, one line per not-done day, then the layoff. */
export function summarizeEvidence(days: EvidenceDay[], now: Date = new Date()): string {
  if (days.length === 0) return "";
  const ordered = [...days].sort((a, b) => a.week - b.week || a.day - b.day);
  const lines: string[] = [];
  let lastDate: string | null = null;
  for (const d of ordered) {
    if (d.status === "not_done") { lines.push(`  W${d.week}D${d.day}: NOT DONE`); continue; }
    if (d.date && (!lastDate || d.date > lastDate)) lastDate = d.date;
    const parts: string[] = [];
    for (const b of d.blocks) {
      if (b.skipped) { parts.push(`${b.label} SKIPPED${b.skip_reason ? ` (${b.skip_reason})` : ""}`); continue; }
      const mv = b.movements.filter((m) => !m.skipped).map((m) => {
        const bits: string[] = [m.movement];
        if (m.sets > 0 && m.reps != null) bits.push(`${m.sets}×${m.reps}`);
        if (m.weight != null) {
          bits.push(`@ ${r1(m.weight)}${m.unit ? ` ${m.unit}` : ""}`);
          if (m.prescribed_weight != null && Math.abs(m.prescribed_weight - m.weight) >= 0.5) bits.push(`(prescribed ${r1(m.prescribed_weight)})`);
        }
        if (m.rpe != null) bits.push(`RPE ${m.rpe}`);
        return bits.join(" ");
      });
      const skippedMv = b.movements.filter((m) => m.skipped).map((m) => `${m.movement} skipped${m.skip_reason ? ` (${m.skip_reason})` : ""}`);
      const head = [b.label + ":", ...mv, ...skippedMv].join(" ");
      const tail: string[] = [];
      if (b.score) tail.push(`result ${b.score}${b.time_domain ? ` (${b.time_domain})` : ""}`);
      if (b.rpe != null && mv.every((x) => !x.includes("RPE"))) tail.push(`RPE ${b.rpe}`);
      if (b.notes) tail.push(`"${b.notes}"`);
      parts.push(tail.length ? `${head} — ${tail.join(", ")}` : head);
    }
    lines.push(`  W${d.week}D${d.day} (${d.date ?? "?"}): ${parts.join(" | ")}`);
  }
  const notDone = ordered.filter((d) => d.status === "not_done").length;
  const layoff = lastDate ? Math.floor((now.getTime() - new Date(lastDate).getTime()) / 864e5) : null;
  const footer = [
    notDone > 0 ? `${notDone} day${notDone === 1 ? "" : "s"} not done.` : "",
    layoff != null && layoff >= 7 ? `Last logged ${layoff} days ago.` : "",
  ].filter(Boolean).join(" ");
  return (
    `WHAT THE ATHLETE ACTUALLY DID in this program so far (progress from what was LIFTED, not what was planned; ` +
    `a day or block not done is not progressed from; skip reasons are data — "no time" says trim the session, ` +
    `"too tired" says hold the load, anything else is a preference in disguise; after a layoff of a week or more, ease back in):\n` +
    lines.join("\n") + (footer ? `\n  ${footer}` : "") + "\n"
  );
}

/** The athlete's logs for weeks < `uptoWeek` of a program, as evidence. */
export async function loadProgramEvidence(
  supa: SupabaseClient,
  userId: string,
  programId: string,
  uptoWeek: number,
): Promise<EvidenceDay[]> {
  const { data: pw } = await supa
    .from("program_workouts")
    .select("id, week_num, day_num")
    .eq("program_id", programId)
    .lt("week_num", uptoWeek);
  const days = (pw ?? []) as Array<{ id: string; week_num: number; day_num: number }>;
  if (days.length === 0) return [];

  const { data: logs } = await supa
    .from("workout_logs")
    .select("id, source_id, workout_date, status")
    .eq("user_id", userId)
    .eq("source_type", "program")
    .eq("status", "completed")
    .in("source_id", days.map((d) => d.id));
  const logByDay = new Map<string, { id: string; workout_date: string | null }>();
  for (const l of (logs ?? []) as Array<{ id: string; source_id: string; workout_date: string | null }>) {
    logByDay.set(l.source_id, { id: l.id, workout_date: l.workout_date });
  }
  const logIds = [...logByDay.values()].map((l) => l.id);

  const [{ data: blocks }, { data: entries }] = logIds.length
    ? await Promise.all([
      supa.from("workout_log_blocks")
        .select("id, log_id, block_type, block_label, score, time_domain, rpe, notes, sort_order")
        .in("log_id", logIds).order("sort_order"),
      supa.from("workout_log_entries")
        .select("log_id, block_id, block_label, movement, sets, reps, reps_completed, weight, weight_unit, prescribed_weight, prescribed_reps, rpe, completed, skip_reason, sort_order")
        .in("log_id", logIds).order("sort_order"),
    ])
    : [{ data: [] }, { data: [] }];

  type B = { id: string; log_id: string; block_type: string | null; block_label: string | null; score: string | null; time_domain: string | null; rpe: number | null; notes: string | null };
  type E = { log_id: string; block_id: string | null; block_label: string | null; movement: string; sets: number | null; reps: number | null; reps_completed: number | null; weight: number | null; weight_unit: string | null; prescribed_weight: number | null; prescribed_reps: number | null; rpe: number | null; completed: boolean | null; skip_reason: string | null };

  const out: EvidenceDay[] = [];
  for (const d of days) {
    const log = logByDay.get(d.id);
    if (!log) { out.push({ week: d.week_num, day: d.day_num, status: "not_done", date: null, blocks: [] }); continue; }
    const bs = ((blocks ?? []) as B[]).filter((b) => b.log_id === log.id);
    const es = ((entries ?? []) as E[]).filter((e) => e.log_id === log.id);
    const evBlocks: EvidenceBlock[] = bs.map((b) => {
      const mine = es.filter((e) => e.block_id === b.id || (e.block_id == null && e.block_label === b.block_label));
      // Collapse per-set rows into one line per movement.
      const byMv = new Map<string, E[]>();
      for (const e of mine) byMv.set(e.movement, [...(byMv.get(e.movement) ?? []), e]);
      const movements: EvidenceMovement[] = [...byMv.entries()].map(([movement, rows]) => {
        const done = rows.filter((r) => r.completed !== false);
        const w = done.map((r) => r.weight).filter((x): x is number => x != null);
        const pw = rows.map((r) => r.prescribed_weight).filter((x): x is number => x != null);
        const rpe = done.map((r) => r.rpe).filter((x): x is number => x != null);
        return {
          movement,
          sets: done.length,
          reps: done[0]?.reps_completed ?? done[0]?.reps ?? null,
          weight: w.length ? Math.max(...w) : null,
          unit: rows[0]?.weight_unit ?? null,
          prescribed_weight: pw.length ? Math.max(...pw) : null,
          prescribed_reps: rows[0]?.prescribed_reps ?? null,
          rpe: rpe.length ? Math.round((rpe.reduce((a, c) => a + c, 0) / rpe.length) * 10) / 10 : null,
          skipped: done.length === 0,
          skip_reason: done.length === 0 ? (rows.find((r) => r.skip_reason)?.skip_reason ?? null) : null,
        };
      });
      const allSkipped = movements.length > 0 && movements.every((m) => m.skipped);
      return {
        label: b.block_label ?? b.block_type ?? "Block",
        type: b.block_type,
        rpe: b.rpe,
        score: b.score,
        time_domain: b.time_domain,
        notes: b.notes,
        skipped: allSkipped,
        skip_reason: allSkipped ? (movements.find((m) => m.skip_reason)?.skip_reason ?? null) : null,
        movements,
      };
    });
    out.push({ week: d.week_num, day: d.day_num, status: "logged", date: log.workout_date, blocks: evBlocks });
  }
  return out;
}

/** The fill's extra context for `weekNum`: "" when nothing is logged yet. */
export async function buildProgramEvidenceContext(
  supa: SupabaseClient,
  userId: string,
  programId: string | null | undefined,
  weekNum: number,
): Promise<string> {
  if (!programId || weekNum <= 1) return "";
  try {
    const days = await loadProgramEvidence(supa, userId, programId, weekNum);
    if (!days.some((d) => d.status === "logged")) return "";
    return summarizeEvidence(days);
  } catch (e) {
    console.warn(`[program-evidence] failed for ${userId}/${programId}:`, e instanceof Error ? e.message : String(e));
    return "";
  }
}
