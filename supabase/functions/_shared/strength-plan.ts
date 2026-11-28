/**
 * strength-plan.ts — how the STRENGTH block is planned (founder, 2026-11-28).
 *
 * Before: the coach state compared each lift with an "advanced" reference bar,
 * ranked the strength areas by the size of the gap (develop / maintain / set
 * aside), and the planner gave strength days by rank. Measured on 31 members'
 * latest month: Olympic lifting was set aside for 14, and all 14 had no
 * Olympic strength day all month; the goal was tagged on 96 of 122 priorities
 * as a reason, without changing their order. Founder: the coach state "is
 * obscuring the information the AI needs."
 *
 * Now, for individual programs:
 *   - the planner is NOT given a strength area in any list (develop, maintain
 *     or set aside) and is not given the strength emphasis setting;
 *   - it IS given the athlete's goal in their own words, every max they
 *     entered, where each lift stands against its reference bar AS A PLAIN
 *     FACT (strong lifts shown as well as weak ones), their age, sex and
 *     bodyweight, and what they said about injuries;
 *   - it chooses the lifts itself: a lift named in the goal and a lift that
 *     is a real weakness both matter, and no lift family is left out of a
 *     month.
 *
 * The reference numbers themselves are unchanged (athlete-model.ts): the
 * founder's ruling is that the numbers are fine; turning them into a ranking
 * that outvoted the athlete was the misuse.
 *
 * Not changed here: how heavy the work goes, and the recovery stance.
 *
 * NO EXAMPLES of an athlete here (founder, 2026-11-26). Pure, no IO.
 */

import type { CoachStateContent, FocusArea } from "./coach-state.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import { hasInjuryText } from "./athlete-file-text.ts";

/** The focus areas that used to rank the strength block. */
export const STRENGTH_AREAS: readonly FocusArea[] = [
  "olympic_lifting",
  "powerlifting_strength",
  "posterior_chain",
  "upper_body_pressing",
] as FocusArea[];
const isStrengthArea = (f: unknown) => (STRENGTH_AREAS as readonly unknown[]).includes(f);

/** The plan inputs without the strength areas and without the strength
 *  emphasis setting. Ranks of what is left are unchanged. */
export function stripStrengthFromTdi(tdi: TrainingDesignInput): TrainingDesignInput {
  const { strength_emphasis: _dropped, ...rest } = tdi;
  return {
    ...rest,
    priorities: (tdi.priorities ?? []).filter((p) => !isStrengthArea(p.focus)),
    maintain: (tdi.maintain ?? []).filter((f) => !isStrengthArea(f)),
    deprioritize: (tdi.deprioritize ?? []).filter((f) => !isStrengthArea(f)),
  } as TrainingDesignInput;
}

/** The coach state as the planner reads it: no decision on a strength area,
 *  and no strength emphasis. */
export function coachStateWithoutStrength<T extends Partial<CoachStateContent>>(cs: T): T {
  const { strength_emphasis: _dropped, ...rest } = cs;
  return {
    ...rest,
    priorities: (cs.priorities ?? []).filter((p) => !isStrengthArea(p.focus)),
    maintain: (cs.maintain ?? []).filter((m) => !isStrengthArea(m.focus)),
    deprioritize: (cs.deprioritize ?? []).filter((d) => !isStrengthArea(d.focus)),
  } as T;
}

/** Reference comparisons that are about conditioning, not lifting. */
const NOT_A_LIFT = /retention$/;
const words = (key: string) => key.replace(/_to_/g, " ÷ ").replace(/_/g, " ");

interface Standing { value?: number | null; threshold?: number | null; target_estimate?: number | null }

/** One reference comparison as a plain fact. "" when it cannot be stated. */
export function standingLine(key: string, s: Standing | null | undefined, unit: string): string {
  const value = s?.value, bar = s?.threshold;
  if (typeof value !== "number" || typeof bar !== "number" || !(bar > 0)) return "";
  const pct = Math.round((value / bar - 1) * 100);
  const where = Math.abs(pct) <= 5 ? "at the bar" : pct < 0 ? `${-pct}% under the bar` : `${pct}% over the bar`;
  const target = typeof s?.target_estimate === "number" ? ` (the bar is about ${s.target_estimate} ${unit})` : "";
  return `  - ${words(key)}: ${value.toFixed(2)} against a bar of ${bar.toFixed(2)}${target} — ${where}`;
}

/**
 * What the planner is told about the athlete's lifting. Only what the athlete
 * entered, and where each lift stands against its reference bar.
 */
export function buildLiftsBrief(p: {
  lifts?: Record<string, number | null> | null;
  normative?: Record<string, Standing> | null;
  goalText?: string | null;
  basics?: { age?: number | null; gender?: string | null; bodyweight?: number | null; units?: string | null } | null;
  injuriesText?: string | null;
  coachNotes?: string[] | null;
}): string {
  const unit = p.basics?.units === "kg" ? "kg" : "lbs";
  const b = p.basics ?? {};
  const lines: string[] = [
    "ATHLETE'S LIFTS (for THE STRENGTH BLOCK: everything you are given about this athlete's lifting)",
    `Their goal, in their own words: ${(p.goalText ?? "").trim() ? `"${(p.goalText ?? "").trim()}"` : "(none given)"}`,
    `Age ${b.age ?? "not given"} · sex ${b.gender ?? "not given"} · bodyweight ${b.bodyweight != null ? `${b.bodyweight} ${unit}` : "not given"}`,
  ];
  if (hasInjuryText(p.injuriesText)) lines.push(`What they wrote under injuries: "${(p.injuriesText ?? "").trim()}"`);
  const notes = (p.coachNotes ?? []).map((n) => (n ?? "").trim()).filter(Boolean);
  if (notes.length) lines.push(`Their notes for their coach: ${notes.map((n) => `"${n}"`).join("; ")}`);

  const entered = Object.entries(p.lifts ?? {}).filter(([, v]) => typeof v === "number" && v > 0);
  const missing = Object.entries(p.lifts ?? {}).filter(([, v]) => !(typeof v === "number" && v > 0)).map(([k]) => k.replace(/_/g, " "));
  lines.push(`Their maxes (${unit}):`);
  if (entered.length === 0) lines.push("  (none entered)");
  for (const [k, v] of entered) lines.push(`  - ${k.replace(/_/g, " ")}: ${v}`);
  if (missing.length) lines.push(`No max entered for: ${missing.join(", ")}`);

  const standings = Object.entries(p.normative ?? {})
    .filter(([k]) => !NOT_A_LIFT.test(k))
    .map(([k, s]) => standingLine(k, s, unit))
    .filter(Boolean);
  lines.push(
    "Where each lift stands against its reference bar. The bars are ADVANCED standards: being under one is common. " +
      "These are facts for you to weigh, not a ranking; a lift at or over its bar is a strength:",
  );
  lines.push(...(standings.length ? standings : ["  (not enough lifts entered to compare)"]));
  return lines.join("\n");
}
