// Shared movement-line formatter for prescription display. Mirrors the proven logic
// in ProgramDetailPage (formatRepPrescription + v3BlocksToProse's fmt): calories take
// precedence, uniform rep-schemes collapse to sets×reps, and distance movements drop
// reps so a "Row" doesn't render "250 reps · 250m". Used by the gym Engine Class
// surfaces (EngineClassBlocks) so they don't re-introduce that display bug.

export interface DisplayMovement {
  movement: string;
  sets?: number | null;
  reps?: number | null;
  rep_scheme?: number[] | null;
  weight?: number | null;
  weight_unit?: string | null;
  time_seconds?: number | null;
  distance?: number | null;
  distance_unit?: string | null;
  calories?: number | null;
  scaling_note?: string | null;
}

/** The rep/volume portion: "45 cal" | "21-15-9 reps" | "5×5" | "3×10" | "8 reps". */
export function formatRepPrescription(m: DisplayMovement): string | null {
  if (m.calories != null && m.calories > 0) return `${m.calories} cal`;
  const arr = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  if (arr && arr.length > 1) {
    const allEqual = arr.every((n) => n === arr[0]);
    if (!allEqual) return `${arr.join('-')} reps`;
    if (m.sets != null && m.sets === arr.length) return `${m.sets}×${arr[0]}`;
    return `${arr.length}×${arr[0]}`;
  }
  if (m.sets != null && m.reps != null) return `${m.sets}×${m.reps}`;
  if (m.sets != null) return `${m.sets} sets`;
  if (m.reps != null) return `${m.reps} reps`;
  return null;
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return s === 0 ? `${m} min` : `${m}:${s.toString().padStart(2, '0')}`;
}

/** Full one-line prescription: "Movement — 5×5 · 225lbs · RPE 8". */
export function formatMovementLine(m: DisplayMovement): string {
  const parts: string[] = [];
  const hasDistance = m.distance != null;
  if (!hasDistance) {
    const repStr = formatRepPrescription(m);
    if (repStr) parts.push(repStr);
  }
  if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? 'lbs'}`);
  if (m.time_seconds != null) parts.push(formatDuration(m.time_seconds));
  if (hasDistance) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
  const scheme = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
  return `${m.movement}${scheme}`;
}
