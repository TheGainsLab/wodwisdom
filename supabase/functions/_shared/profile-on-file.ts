/**
 * profile-on-file.ts — the athlete's saved profile, as one compact labelled
 * block for the coach's context.
 *
 * Why (2026-11-23): in general chat the coach could not see session length,
 * equipment, the avoid list, the signup answers or height; equipment and the
 * avoid list reached it only inside a program day's edit context, and nothing
 * at all reached the Engine day chat. Asked "what do you have on file for
 * me?" it could only guess. This block rides in EVERY chat (general, program
 * day, Engine day), built from the same columns the program generator reads.
 *
 * Compact on purpose: one line per setting, empty things left out, no raw
 * JSON. Pure — the caller selects the row.
 */

import { computeMergedAvoidance, type AvoidanceConfirmed, type InjuryConstraints } from "./build-writer-payload.ts";
import { ALL_EQUIPMENT_KEYS } from "./tier-status.ts";
import { equipmentLabel } from "./equipment-labels.ts";
import { goalForPrompt } from "./goal-text.ts";

/** What the generator uses when the profile holds no session length. */
const DEFAULT_SESSION_LENGTH_MINUTES = 60;
/** Movements blocked by missing equipment can run long; the list of unticked
 *  equipment above it already says why. */
const EQUIPMENT_AVOID_SHOWN = 30;

/** The athlete_profiles columns this block reads. The chat's profile select
 *  must name every one (checked by profile-on-file_test.ts). */
export const PROFILE_ON_FILE_COLUMNS = [
  "days_per_week", "session_length_minutes", "units", "height", "bodyweight", "goal", "engine_goal",
  "engine_program_version", "injuries_constraints", "injuries_structured", "injuries_constraints_hash",
  "injuries_avoidance_confirmed", "equipment", "coaching_intake", "coaching_intake_raw",
] as const;

export interface OnFileProfile {
  days_per_week?: number | null;
  session_length_minutes?: number | null;
  units?: string | null;
  height?: number | null;
  bodyweight?: number | null;
  goal?: string | null;
  engine_goal?: string | null;
  engine_program_version?: string | null;
  injuries_constraints?: string | null;
  injuries_structured?: InjuryConstraints | null;
  injuries_constraints_hash?: string | null;
  injuries_avoidance_confirmed?: AvoidanceConfirmed | null;
  equipment?: Record<string, unknown> | null;
  coaching_intake?: unknown;
  coaching_intake_raw?: unknown;
}

/** The profile page's wording for each signup question still stored. */
const INTAKE_QUESTION_LABELS: Record<string, string> = {
  anything_else: "Anything else we should know?",
};

const words = (key: string) => key.replace(/_/g, " ");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The extracted signup facts as "section, field: value" phrases — only the
 *  fields that hold something (no nulls, no empty lists, no version stamp). */
export function flattenIntake(intake: unknown): string[] {
  const out: string[] = [];
  if (!intake || typeof intake !== "object") return out;
  const say = (label: string, v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") { if (v.trim()) out.push(`${label}: ${oneLine(v)}`); return; }
    if (typeof v === "boolean") { out.push(`${label}: ${v ? "yes" : "no"}`); return; }
    if (typeof v === "number") { out.push(`${label}: ${v}`); return; }
    if (Array.isArray(v)) {
      const items = v.filter((x) => typeof x === "string" && x.trim()).map((x) => oneLine(x as string));
      if (items.length > 0) out.push(`${label}: ${items.join(", ")}`);
    }
  };
  for (const [section, value] of Object.entries(intake as Record<string, unknown>)) {
    if (section === "coaching_intake_version") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [field, v] of Object.entries(value as Record<string, unknown>)) say(`${words(section)}, ${words(field)}`, v);
    } else {
      say(words(section), value);
    }
  }
  return out;
}

/** The labelled block ("" when there is no profile row). */
export function buildProfileOnFileBlock(profile: OnFileProfile | null | undefined): string {
  if (!profile) return "";
  const p = profile;
  const u = p.units === "kg" ? "kg" : "lbs";
  const lines: string[] = [];

  lines.push(`Days per week (AI Programming): ${p.days_per_week != null ? p.days_per_week : "not set"}`);
  lines.push(
    p.session_length_minutes != null
      ? `Session length: ${p.session_length_minutes} minutes`
      // An empty value is built as 60 minutes; say what is used.
      : `Session length: ${DEFAULT_SESSION_LENGTH_MINUTES} minutes (none saved; ${DEFAULT_SESSION_LENGTH_MINUTES} is what the program is built to)`,
  );
  lines.push(`Units: ${u}`);
  lines.push(
    `Height: ${p.height != null && p.height > 0 ? `${p.height} ${u === "kg" ? "cm" : "in"}` : "not set"}` +
    ` · Bodyweight: ${p.bodyweight != null && p.bodyweight > 0 ? `${p.bodyweight} ${u}` : "not set"}`,
  );

  const goal = goalForPrompt(p.goal);
  lines.push(`Goal (whole, their words): ${goal ? JSON.stringify(goal) : "none saved"}`);
  // The Engine reads its own copy. Shown only when it is not the same text.
  const engineGoal = goalForPrompt(p.engine_goal);
  if (engineGoal !== goal && (engineGoal || p.engine_program_version)) {
    lines.push(`Engine goal (differs from the goal above): ${engineGoal ? JSON.stringify(engineGoal) : "none saved"}`);
  }

  const injuryNote = (p.injuries_constraints ?? "").trim();
  lines.push(`Injury note (whole, their words): ${injuryNote ? JSON.stringify(injuryNote) : "none saved"}`);

  // Equipment. An empty record = the checklist was never reviewed, which the
  // generator reads as fully equipped (hydrateEquipment).
  const reviewed = Object.keys(p.equipment ?? {}).length > 0;
  const merged = computeMergedAvoidance(p);
  const have = ALL_EQUIPMENT_KEYS.filter((k) => merged.equipment[k] !== false).map(equipmentLabel);
  const unticked = ALL_EQUIPMENT_KEYS.filter((k) => merged.equipment[k] === false).map(equipmentLabel);
  if (!reviewed) {
    lines.push("Equipment: checklist not reviewed yet — treated as having everything on it.");
  } else {
    lines.push(`Equipment they have: ${have.length > 0 ? have.join(", ") : "none ticked"}`);
    lines.push(`Equipment they have unticked (don't have): ${unticked.length > 0 ? unticked.join(", ") : "none"}`);
  }

  // The avoid list, by where each movement came from.
  const blockedBy = merged.injuries_structured.blocked_by ?? {};
  const fromInjury = merged.injuries_structured.do_not_program.filter((m) => blockedBy[m] === "injury" || blockedBy[m] === "both");
  const fromEquipment = merged.injuries_structured.do_not_program.filter((m) => blockedBy[m] === "equipment");
  lines.push(`Avoid list, from their injury note: ${fromInjury.length > 0 ? fromInjury.join(", ") : "none"}`);
  if (fromEquipment.length > 0) {
    const shown = fromEquipment.slice(0, EQUIPMENT_AVOID_SHOWN);
    const more = fromEquipment.length - shown.length;
    lines.push(`Avoid list, from equipment they don't have: ${shown.join(", ")}${more > 0 ? ` (+${more} more that need the same equipment)` : ""}`);
  } else {
    lines.push("Avoid list, from equipment they don't have: none");
  }

  // Signup answers: their own words first, then what was extracted from them.
  const raw = p.coaching_intake_raw && typeof p.coaching_intake_raw === "object"
    ? Object.entries(p.coaching_intake_raw as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && v.trim() !== "")
      .map(([k, v]) => `${INTAKE_QUESTION_LABELS[k] ?? words(k)} ${JSON.stringify(oneLine(v as string))}`)
    : [];
  const facts = flattenIntake(p.coaching_intake);
  if (raw.length === 0 && facts.length === 0) {
    lines.push("Signup answers: none saved");
  } else {
    if (raw.length > 0) lines.push(`Signup answers (their words): ${raw.join(" · ")}`);
    if (facts.length > 0) lines.push(`Signup answers (noted from them): ${facts.join("; ")}`);
  }

  return "\n\nPROFILE ON FILE (what this athlete has saved in their profile — answer \"what do you have on file\" from this; " +
    "what they tell you in this chat is newer than any line here):\n" +
    lines.map((l) => `- ${l}`).join("\n");
}
