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


// deno-lint-ignore no-explicit-any
type Loose = any;

/** One written movement as a line: what the member would do. Only the fields
 *  the writer set are shown. */
export function movementAsText(m: Loose): string {
  const parts: string[] = [];
  if (m.sets != null && m.reps != null) parts.push(`${m.sets} x ${m.reps}`);
  else if (m.sets != null) parts.push(`${m.sets} sets`);
  else if (m.reps != null) parts.push(`${m.reps} reps`);
  if (Array.isArray(m.rep_scheme) && m.rep_scheme.length) parts.push(`reps ${m.rep_scheme.join("-")}`);
  if (m.calories != null) parts.push(`${m.calories} cal`);
  if (Array.isArray(m.cal_scheme) && m.cal_scheme.length) parts.push(`cal ${m.cal_scheme.join("-")}`);
  if (m.distance != null) parts.push(`${m.distance} ${m.distance_unit ?? ""}`.trim());
  if (m.time_seconds != null) parts.push(`${m.time_seconds} sec`);
  if (m.weight != null) parts.push(`@ ${m.weight} ${m.weight_unit ?? ""}`.trim());
  if (m.target_pct_1rm != null) parts.push(`(${m.target_pct_1rm}% of max)`);
  if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
  if (m.max_effort) parts.push("max effort");
  const note = (m.scaling_note ?? "").trim();
  return `    ${m.movement}: ${parts.join(" · ") || "(no numbers)"}${note ? `  [${note}]` : ""}`;
}

/** What the plan asked of one block, on one line. "" when it said nothing. */
export function planForBlock(daySkel: Loose, blockType: string): string {
  if (!daySkel) return "";
  const bits: string[] = [];
  if (blockType === "strength" && daySkel.primary_lift) bits.push(`${daySkel.primary_lift}${daySkel.strength_scheme ? `, ${daySkel.strength_scheme}` : ""}`);
  if (blockType === "skills") {
    if (Array.isArray(daySkel.skill_names) && daySkel.skill_names.length) bits.push(`skills: ${daySkel.skill_names.join(" + ")}`);
    if (daySkel.skill_focus) bits.push(daySkel.skill_focus);
  }
  if (blockType === "accessory" && daySkel.accessory_focus) bits.push(daySkel.accessory_focus);
  if (blockType === "metcon" && daySkel.metcon_time_domain) bits.push(`${daySkel.metcon_time_domain} (composed before the writer)`);
  for (const bi of (daySkel.block_intents ?? []).filter((b: Loose) => b.block_type === blockType)) {
    bits.push(`${bi.purpose} ${bi.focus}${bi.source_priority_rank ? ` (priority ${bi.source_priority_rank})` : ""}`);
  }
  const mins = (daySkel.block_minutes ?? []).find((b: Loose) => b.block_type === blockType)?.minutes;
  if (mins != null) bits.push(`${mins} min`);
  return bits.join(" · ");
}

/** A written week as plain text: each day, each block, with what the plan
 *  asked for beside what the writer wrote. */
export function weekAsText(week: Loose, skeletonWeek: Loose): string {
  const out: string[] = [];
  for (const day of week?.days ?? []) {
    const daySkel = (skeletonWeek?.days ?? []).find((d: Loose) => d.day_num === day.day_num);
    out.push(`=== Week ${week.week_num} Day ${day.day_num}${daySkel?.day_intent ? ` — plan: ${daySkel.day_intent}` : ""}`);
    for (const b of day.blocks ?? []) {
      const plan = planForBlock(daySkel, b.block_type);
      out.push(`  [${b.block_type}]${b.block_label ? ` ${b.block_label}` : ""}${plan ? `   (plan: ${plan})` : ""}`);
      if ((b.block_scheme ?? "").trim()) out.push(`    ${b.block_scheme.trim()}`);
      for (const m of b.movements ?? []) out.push(movementAsText(m));
      const note = (b.stimulus_note ?? "").trim();
      if (note) out.push(`    Note: ${note}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
