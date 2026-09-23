// Reassemble a v3 program day (program_blocks_v2 + program_movements_v2) into
// a readable prose block of text for LLM context. v3 programs leave
// program_workouts.workout_text NULL — the structure lives in the typed
// tables — so any surface that needs the workout as text (AI Coach chat,
// future surfaces) must rebuild it from the structured rows at request time.
// Reading live means the text always reflects the latest edits.
//
// Format mirrors workout-review's inline v3 fallback so coaching prose is
// consistent across surfaces.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const BLOCK_DISPLAY: Record<string, string> = {
  "warm-up": "Warm-up",
  mobility: "Mobility",
  skills: "Skills",
  strength: "Strength",
  accessory: "Accessory",
  metcon: "Metcon",
  cardio: "Cardio",
  "active-recovery": "Recovery",
  "cool-down": "Cool down",
  other: "Other",
};

interface MovementRow {
  block_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  rep_scheme: number[] | null;
  calories: number | null;
  cal_scheme?: number[] | null;
  max_effort?: boolean | null;
  weight: number | null;
  weight_unit: string | null;
  rpe: number | null;
  time_seconds: number | null;
  distance: number | null;
  distance_scheme?: number[] | null;
  distance_unit: string | null;
  scaling_note: string | null;
  sort_order: number;
}

/** Varying scheme → "21-15-9"; uniform → "3×250"; null when unusable. */
function schemeLabel(scheme: number[] | null | undefined): string | null {
  if (!Array.isArray(scheme) || scheme.length === 0) return null;
  const valid = scheme.filter((n) => typeof n === "number" && n > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return String(valid[0]);
  return valid.every((n) => n === valid[0]) ? `${valid.length}×${valid[0]}` : valid.join("-");
}

function formatMovement(m: MovementRow): string {
  const parts: string[] = [];
  const arr: number[] | null = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  const calLabel = schemeLabel(m.cal_scheme);
  if (m.max_effort === true) {
    // "As many as possible in the remaining window" — the clock caps it.
    parts.push("max effort in remaining time");
  } else if (calLabel != null) {
    parts.push(`${calLabel} cal`);
  } else if (m.calories != null && m.calories > 0) {
    // Per-round calories; sets carries the rounds ("4×15 cal").
    parts.push(m.sets != null && m.sets > 1 ? `${m.sets}×${m.calories} cal` : `${m.calories} cal`);
  } else if (arr && arr.length > 1 && !arr.every((n) => n === arr[0])) {
    parts.push(`${arr.join("-")} reps`);
  } else if (arr && arr.length > 1) {
    parts.push(`${arr.length}×${arr[0]}`);
  } else if (m.sets != null && m.reps != null) {
    parts.push(`${m.sets}×${m.reps}`);
  } else if (m.sets != null) {
    parts.push(`${m.sets} sets`);
  } else if (m.reps != null) {
    parts.push(`${m.reps} reps`);
  }
  if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? "lbs"}`);
  if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
  if (m.time_seconds != null) parts.push(`${m.time_seconds}s`);
  const distLabel = schemeLabel(m.distance_scheme);
  if (distLabel != null) parts.push(`${distLabel}${m.distance_unit ?? ""}`);
  else if (m.distance != null) parts.push(`${m.sets != null && m.sets > 1 && m.calories == null && m.reps == null && m.rep_scheme == null ? `${m.sets}×` : ""}${m.distance}${m.distance_unit ?? ""}`);
  const scheme = parts.length > 0 ? ` — ${parts.join(" · ")}` : "";
  const scaling = m.scaling_note ? ` (${m.scaling_note})` : "";
  return `${m.movement}${scheme}${scaling}`;
}

/**
 * Build a prose representation of a v3 program day from its structured rows.
 * Returns null when the workout has no v3 blocks (caller should fall back to
 * program_workouts.workout_text for v1/v2).
 */
export async function reassembleV3WorkoutText(
  supa: SupabaseClient,
  workoutId: string,
): Promise<string | null> {
  const { data: blocks } = await supa
    .from("program_blocks_v2")
    .select("id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, sort_order")
    .eq("program_workout_id", workoutId)
    .order("sort_order");

  if (!blocks || blocks.length === 0) return null;

  const blockIds = (blocks as { id: string }[]).map((b) => b.id);
  const { data: movements } = await supa
    .from("program_movements_v2")
    .select("block_id, movement, sets, reps, rep_scheme, calories, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, sort_order")
    .in("block_id", blockIds)
    .order("sort_order");

  const movsByBlock = new Map<string, MovementRow[]>();
  for (const m of (movements || []) as MovementRow[]) {
    const arr = movsByBlock.get(m.block_id) ?? [];
    arr.push(m);
    movsByBlock.set(m.block_id, arr);
  }

  const sections: string[] = [];
  for (const b of blocks as Array<{
    id: string;
    block_type: string;
    block_label: string | null;
    block_scheme: string | null;
    time_cap_seconds: number | null;
    block_notes: string | null;
  }>) {
    const lines: string[] = [];
    lines.push(BLOCK_DISPLAY[b.block_type] ?? b.block_type);
    const header: string[] = [];
    if (b.block_label) header.push(b.block_label);
    if (b.block_scheme) header.push(b.block_scheme);
    if (b.time_cap_seconds) header.push(`cap ${Math.round(b.time_cap_seconds / 60)} min`);
    if (header.length) lines.push(header.join(" — "));
    // block_notes is the writer's internal reasoning — not surfaced to the athlete.
    for (const m of movsByBlock.get(b.id) ?? []) lines.push(formatMovement(m));
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
