/**
 * compose-block-scheme.ts — the ONLY author of block_scheme for generated
 * blocks.
 *
 * The model emits a typed SchemeFormat (format + clock/rounds/rest fields)
 * and movement rows; this renderer assembles the human header from them.
 * Because the header is derived from the same data the card rows render,
 * header/row disagreement is structurally impossible — the one-copy rule
 * as a compiler property, not a model behavior. This replaced the regex
 * prose-policing layer (project law: no regex validation of generated
 * prose — structured data or nothing).
 *
 * Movement QUANTITIES never appear here by construction: the renderer only
 * reads movement NAMES (station mapping, complex brackets, max-effort
 * finisher) and the work_up target reps. Everything else comes from the
 * typed format fields.
 */

import type { MovementPrescription, SchemeFormat } from "./v2-output-schema.ts";

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}:00` : `${m}:${s.toString().padStart(2, "0")}`;
}

function capSuffix(timeCapSeconds: number | null | undefined, format: string): string {
  // AMRAP/EMOM/intervals: the clock IS the duration — a cap suffix is noise.
  if (timeCapSeconds == null || timeCapSeconds <= 0) return "";
  if (format === "amrap" || format === "emom" || format === "intervals" || format === "steady") return "";
  const mins = Math.round(timeCapSeconds / 60);
  return ` (${mins}-min cap)`;
}

function restSuffix(sf: SchemeFormat): string {
  if (sf.rest_seconds == null || sf.rest_seconds <= 0) return "";
  if (sf.rest_seconds_max != null && sf.rest_seconds_max > sf.rest_seconds) {
    return ` Rest ${sf.rest_seconds}–${sf.rest_seconds_max} sec between sets.`;
  }
  const r = sf.rest_seconds;
  const pretty = r % 60 === 0 ? `${r / 60} min` : `${r} sec`;
  return ` ${pretty} rest between sets.`;
}

function stationLabel(slotIdx: number, slotCount: number): string {
  if (slotCount === 2) return slotIdx === 0 ? "odd" : "even";
  return `min ${slotIdx + 1}`;
}

function repWord(n: number | undefined): string {
  if (n === 1) return "single";
  if (n === 2) return "double";
  if (n === 3) return "triple";
  return n != null ? `${n}-rep max` : "top set";
}

/**
 * Render the block header. `movements` supplies names only (stations,
 * complexes, the max-effort finisher) and the work_up target reps.
 */
export function composeBlockScheme(
  sf: SchemeFormat | null | undefined,
  movements: MovementPrescription[],
  timeCapSeconds?: number | null,
): string | null {
  if (!sf || !sf.format) return null;
  const name = (i: number) => movements[i]?.movement ?? `movement ${i + 1}`;
  const maxEffortFinisher = movements.find((m) => m.max_effort === true);

  switch (sf.format) {
    case "amrap":
      return `AMRAP ${sf.minutes ?? "?"}`;

    case "emom": {
      let s = `EMOM ${sf.minutes ?? "?"}`;
      if (Array.isArray(sf.stations) && sf.stations.length > 0) {
        const slots = sf.stations.map((idxs, k) =>
          `${stationLabel(k, sf.stations!.length)}: ${idxs.map(name).join(" + ")}`
        );
        s += ` — ${slots.join("; ")}`;
      }
      if (sf.rest_remainder) s += ". Rest remainder of each minute.";
      return s;
    }

    case "rft":
      return `${sf.rounds ?? "?"} rounds for time${capSuffix(timeCapSeconds, sf.format)}`;

    case "for_time": {
      const head = Array.isArray(sf.rounds_pattern) && sf.rounds_pattern.length > 1
        ? `${sf.rounds_pattern.join("-")} for time`
        : "For time";
      return `${head}${capSuffix(timeCapSeconds, sf.format)}`;
    }

    case "intervals": {
      const on = sf.work_seconds != null ? clock(sf.work_seconds) : "?";
      const off = sf.rest_seconds != null ? clock(sf.rest_seconds) : "?";
      let s = `${sf.rounds ?? "?"} rounds: ${on} on / ${off} off`;
      if (sf.amrap_each_interval) s += ", AMRAP each interval";
      if (maxEffortFinisher) s += ` — max ${maxEffortFinisher.movement} in remaining time`;
      if (sf.pace_note) s += `. ${sf.pace_note}`;
      return s;
    }

    case "steady":
      return sf.pace_note ? `Steady state — ${sf.pace_note}` : "Steady state";

    case "work_sets":
      // Plain English over "sets across" gym jargon.
      return `Same weight across all sets.${restSuffix(sf)}`.trim();

    case "work_up": {
      // The top set is the first movement row's rep target.
      const target = Array.isArray(movements[0]?.rep_scheme) ? movements[0].rep_scheme![0] : undefined;
      const backOff = movements.length > 1 ? " Then back-off sets." : "";
      return `Work up to a heavy ${repWord(target)}.${backOff}`;
    }

    case "complex": {
      const parts = movements.map((m) => {
        const reps = Array.isArray(m.rep_scheme) ? m.rep_scheme[0] : m.reps;
        return `${reps ?? 1} ${m.movement}`;
      });
      const sets = movements[0]?.sets;
      return `${sets ?? "?"} sets of [${parts.join(" + ")}].${restSuffix(sf)}`.trim();
    }

    case "straight_sets":
      // The rows carry the sets×reps; the header's only job is the rest and
      // the not-a-circuit intent. "Straight sets" was jargon — say it plainly.
      return (restSuffix(sf).trim() || "Rest as needed between sets.") + " Not for time.";

    case "rounds_ntf":
      return `${sf.rounds ?? "?"} rounds, not for time.`;

    default:
      return null;
  }
}

/** Render a block's header in place (no-op when it has no scheme_format —
 *  ingest/legacy blocks keep their text). */
export function renderBlockSchemeInPlace(b: {
  scheme_format?: SchemeFormat;
  block_scheme?: string;
  time_cap_seconds?: number;
  movements: MovementPrescription[];
}): void {
  const rendered = composeBlockScheme(b.scheme_format, b.movements ?? [], b.time_cap_seconds);
  if (rendered != null) b.block_scheme = rendered;
}

/** Render every block header in a filled week, so the audit/benchmark/
 *  analytics stages (which read block_scheme text) see the final strings. */
export function renderWeekSchemesInPlace(week: { days?: Array<{ blocks?: Array<{ scheme_format?: SchemeFormat; block_scheme?: string; time_cap_seconds?: number; movements: MovementPrescription[] }> }> }): void {
  for (const day of week.days ?? []) {
    for (const b of day.blocks ?? []) renderBlockSchemeInPlace(b);
  }
}
