/**
 * metcon-dry-run-text.ts — how the metcon dry run (metcon-dry-run) shows a
 * plan and a composed piece as plain text. Pure.
 */
import type { SkeletonOutput } from "./v3-output-schema.ts";
import { type ComposedMetcon, metconTimeDomainOfDay } from "./metcon-composer.ts";

/** The plan's metcon time domains, one line per week. */
export function timeDomainTable(skeleton: SkeletonOutput): string[] {
  return (skeleton.weeks ?? []).map((wk) =>
    `Week ${wk.week_num} (${wk.weekly_intent}): ` +
    (wk.days ?? [])
      .filter((d) => (d.block_types ?? []).includes("metcon"))
      .map((d) => `D${d.day_num} ${metconTimeDomainOfDay(d) ?? "NONE"}`)
      .join(" · ")
  );
}

/** A composed piece as the member would read it. */
export function pieceAsText(m: ComposedMetcon): string {
  const rows = (m.movements ?? []).map((mv) => {
    const load = mv.load_band ? ` (${mv.load_class} ${mv.load_band})`
      : mv.weight != null ? ` (${mv.weight} per ${mv.load_class ?? "implement"})`
      : mv.load_class === "medicine_ball" ? " (medicine ball)" : "";
    return `  ${mv.prescription} ${mv.movement}${load}`;
  });
  return [
    `W${m.week_num}D${m.day_num} · ${m.format} · ${m.stated_duration_minutes} min${m.monostructural ? " · monostructural" : ""}`,
    m.block_scheme,
    ...rows,
    `  Note: ${m.stimulus_note}`,
  ].join("\n");
}

