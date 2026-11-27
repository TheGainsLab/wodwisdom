/**
 * athlete-file-text.ts — what the WRITER is told about one athlete: what they
 * said about their body, their avoid list, and the plain facts of their file
 * (equipment they do not have, lifts with no max, session length).
 *
 * This is instruction only. NOTHING checks or changes the written week
 * afterwards (founder, 2026-11-26). The two checks built on 2026-11-23 for one
 * member's complaint — an AI that swapped movements against injuries
 * (restriction-gate.ts) and an AI that swapped, trimmed and lowered against
 * the athlete's file (fit-gate.ts) — are removed. On a real build they took
 * handstand push-ups and a shuttle run out for a member with no injury
 * ("the athlete reported shoulder pain"), swapped seven movements for not
 * being on a list, and replaced a muscle-up because it "requires advanced".
 * Founder: "It's actually better to have them get stuff they tell us not to
 * get than to do this."
 *
 * NO EXAMPLES, EVER, in anything said about an athlete (founder, 2026-11-26:
 * "Remove them and never put them back"; "Just read the stuff the user
 * actually enters"). The text here holds the athlete's own words and rules
 * that name no movement, body part or injury. A test fails if one comes back.
 */

const NO_INJURY_RE = /^(none|no|nothing|no injuries|n\/a|none\.)$/i;

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

/** What an effort prescription says in place of a number. */
export const EFFORT_NOTE = "No max on file for this lift: choose a weight you could do for 2 more reps.";

/**
 * The plain facts of the athlete's file, for the writer. Facts only: no
 * ceiling worked out by level, and no claim that anything checks the week
 * afterwards. "" when there is nothing to say.
 */
export function athleteFileForWriter(p: {
  lifts?: Record<string, number | null | undefined> | null;
  liftNames?: Record<string, string>;
  conditioning?: Record<string, unknown> | null;
  equipment?: Record<string, boolean> | null;
  sessionMinutes?: number | null;
}): string {
  const lines: string[] = [];
  const noMax = Object.entries(p.liftNames ?? {})
    .filter(([name]) => name !== "Clean & Jerk" && name !== "Strict Press") // second spellings of the same lift
    .filter(([, key]) => { const v = (p.lifts ?? {})[key]; return typeof v !== "number" || v <= 0; })
    .map(([name]) => name);
  if (noMax.length) lines.push(`  - NO MAX ON FILE for: ${[...new Set(noMax)].join(", ")}. If you program one, give NO weight and NO percentage: set rpe 8 and the note "${EFFORT_NOTE}"`);
  const hasBenchmarks = Object.values(p.conditioning ?? {}).some((v) => v != null && String(v).trim() !== "");
  if (!hasBenchmarks) lines.push("  - No conditioning benchmarks on file: do not invent a pace, split or RPM. Prescribe machine and running work by effort.");
  if (p.sessionMinutes && p.sessionMinutes > 0) lines.push(`  - The whole session, warm-up to cool-down with rest and transitions, is ${p.sessionMinutes} minutes. Size every block to fit it.`);
  const lack = Object.entries(p.equipment ?? {}).filter(([, v]) => v === false).map(([k]) => k.replace(/_/g, " "));
  if (lack.length) lines.push(`  - They do NOT have: ${lack.join(", ")}. Nothing that needs these, in any block.`);
  return lines.length ? ["THIS ATHLETE'S FILE (yours to get right — nothing checks these after you):", ...lines].join("\n") : "";
}
