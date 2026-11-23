/**
 * Chat → profile Apply: the coach proposes a profile diff, the athlete taps
 * Apply. Shared by the chat fn (tool definition + validation + the prompt
 * addendum) and apply-profile-update (the resolver).
 *
 * SCOPE: days_per_week, goal (append-only — the goal box is the athlete's own
 * writing, never silently overwritten), injuries_constraints (replace — stale
 * injury text is worse than none), and from 2026-11-23:
 *   - session_length_minutes (30 to 120 in steps of 15, the profile slider's
 *     values). Before, "I only have 45 minutes" became a sentence in the goal
 *     and the time budget the program is built to never moved;
 *   - equipment, as two lists of checklist keys (have / don't have). Only the
 *     named keys change. Before, the coach was told to use this card for
 *     equipment while the card had no equipment field.
 *
 * LAW: nothing is ever written without the athlete's tap. The proposal is
 * logged BEFORE the card renders; apply resolves the logged row exactly once.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALL_EQUIPMENT_KEYS, hydrateEquipment } from "./tier-status.ts";
import { EQUIPMENT_LABELS, equipmentLabel } from "./equipment-labels.ts";
import { goalForPrompt } from "./goal-text.ts";

/** The profile slider's values: 30 to 120 minutes in steps of 15. */
export const SESSION_LENGTH_OPTIONS = [30, 45, 60, 75, 90, 105, 120] as const;
/** What the generator uses when the profile holds no session length. */
export const DEFAULT_SESSION_LENGTH = 60;
const EQUIPMENT_KEY_SET: ReadonlySet<string> = new Set(ALL_EQUIPMENT_KEYS);

export interface ProfileCurrent {
  days_per_week: number | null;
  goal: string | null;
  injuries_constraints: string | null;
  /** Optional: cards logged before 2026-11-23 have neither. */
  session_length_minutes?: number | null;
  /** The stored equipment record as it is (may be empty or partial). */
  equipment?: Record<string, unknown> | null;
}

export interface ProfileProposal {
  days_per_week?: number;
  goal_append?: string;
  injuries_replace?: string;
  session_length_minutes?: number;
  /** Checklist keys to mark as HAVE / DON'T HAVE. Other keys are untouched. */
  equipment_have?: string[];
  equipment_dont_have?: string[];
}

/** A proposal's equipment list, cleaned: strings only, trimmed, no repeats. */
export function cleanEquipmentKeys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean)));
}

/** What the athlete has UNTICKED, by label (an empty record = nothing unticked). */
function untickedLabels(equipment: Record<string, unknown> | null | undefined): string[] {
  const full = hydrateEquipment(equipment);
  return ALL_EQUIPMENT_KEYS.filter((k) => full[k] === false).map(equipmentLabel);
}

export const PROFILE_UPDATE_PROMPT =
  "\n\nPROFILE UPDATE PROPOSALS (propose_profile_update): When the athlete states a DURABLE change to their " +
  "circumstances or goals — training days per week, how long they can train per session, equipment they have or " +
  "no longer have, outside training load (a sport season, Hyrox, a gym program), " +
  "a goal shift, an injury or constraint to work around — propose a profile update. The athlete sees a card with " +
  "the exact diff and Apply / Not now buttons; NOTHING changes unless they tap Apply.\n" +
  "- Durable only. 'My legs are smoked today' is day-scale — no proposal. 'Traveling next week', 'more pull-ups' " +
  "is week-scale — that is a propose_coach_note, not a profile update.\n" +
  "- goal_append is ADDED to their goal text (date it, keep their phrasing: e.g. \"Oct 2026 update: ...\"); " +
  "days_per_week replaces the number; injuries_replace replaces the injuries text entirely, so restate anything " +
  "that still applies.\n" +
  "- session_length_minutes replaces the minutes per session (30 to 120 in steps of 15). When the athlete states " +
  "how long they can train ('I only have 45 minutes', 'keep it under an hour'), propose THIS field — NEVER write a " +
  "session length into goal_append: the program's time budget is read from this number, not from the goal text.\n" +
  "- equipment_have / equipment_dont_have change the profile's equipment checklist (use the keys listed in the tool; " +
  "only the items you name change). Use it for a LASTING change ('I sold my rower', 'my gym got a ski erg'). " +
  "'No rower this week' is week-scale — a propose_coach_note. Never put equipment into goal_append or " +
  "injuries_replace, and never send the athlete to the profile page or a human for it.\n" +
  "- One proposal per message, after you understand the change — a clarifying question first is often right.\n" +
  "- WHEN IT TAKES EFFECT (say this, and only this): AI Programming is written a week at a time. A change to " +
  "days per week, goal or session length RE-PLANS the weeks of the current month that are not written yet, when the next week is " +
  "written; weeks already written do not change (to change a written day they open it and ask you there). If every " +
  "week of the month is already written, it applies from the next month. An injury change is checked against every " +
  "week written from then on, and so is an equipment change: new weeks are written without what they don't have. " +
  "NEVER say 'next month' when unwritten weeks remain, and NEVER send them to a human " +
  "for a rebuild — none is needed. The card itself states the exact effect once applied; do not contradict it.\n" +
  "- days_per_week is AI Programming's setting (2 to 6). The Engine's days per week come from the Engine program " +
  "(Switch Program) — never propose days_per_week to change an Engine week; say where to change it instead.\n" +
  "- injuries_replace REPLACES the whole note. You are shown the athlete's full current note below: carry over " +
  "everything in it that still applies, word for word, and change only what they told you changed.\n" +
  "- Never claim the profile changed unless the card was applied.";

/** key = the member-facing name, so the coach picks the right key. */
const EQUIPMENT_KEY_GUIDE = "Keys: " +
  ALL_EQUIPMENT_KEYS.map((k) => `${k} = ${EQUIPMENT_LABELS[k]}`).join("; ") + ".";

export function buildProposeProfileUpdateTool(current: ProfileCurrent) {
  return {
    name: "propose_profile_update",
    description:
      "Propose a durable update to the athlete's profile (training days per week, minutes per session, goal text " +
      "to append, injuries/constraints, equipment they have or don't have). Renders as an Apply / Not now card — nothing changes unless the athlete taps Apply. " +
      `Their profile now: days_per_week=${current.days_per_week ?? "unset"}; ` +
      // Session length: an empty value is built as 60, so say 60 (2026-11-23).
      `session_length_minutes=${current.session_length_minutes ?? `unset (${DEFAULT_SESSION_LENGTH} is used)`}; ` +
      // The WHOLE goal (2026-11-23): this showed the first 400 characters, and
      // additions are appended at the end, so the newest text was cut first.
      `goal (whole)=${JSON.stringify(goalForPrompt(current.goal))}; ` +
      `equipment they have UNTICKED (everything else on the checklist counts as owned)=${JSON.stringify(untickedLabels(current.equipment))}; ` +
      // The FULL note: the card replaces it whole, so a truncated view meant
      // everything past the cut was silently dropped on Apply (2026-11-23).
      `injuries (their FULL current note)=${JSON.stringify(current.injuries_constraints ?? "")}.`,
    input_schema: {
      type: "object",
      properties: {
        rationale: {
          type: "string",
          description: "One sentence, athlete-facing: why this update, in plain words.",
        },
        days_per_week: {
          type: "integer", minimum: 2, maximum: 6,
          description: "New AI Programming training days per week (2 to 6), only if it changed. Not for the Engine.",
        },
        goal_append: {
          type: "string", maxLength: 600,
          description: "Text to APPEND to their goal (dated, close to the athlete's own words). Never a rewrite.",
        },
        injuries_replace: {
          type: "string", maxLength: 500,
          description: "Full replacement injuries/constraints text — restate anything that still applies.",
        },
        session_length_minutes: {
          type: "integer", enum: [...SESSION_LENGTH_OPTIONS],
          description: "New target minutes per AI Programming session, only if it changed. Not for the Engine.",
        },
        equipment_have: {
          type: "array", items: { type: "string", enum: [...ALL_EQUIPMENT_KEYS] },
          description: "Checklist keys to mark as HAVE. " + EQUIPMENT_KEY_GUIDE,
        },
        equipment_dont_have: {
          type: "array", items: { type: "string", enum: [...ALL_EQUIPMENT_KEYS] },
          description: "Checklist keys to mark as DON'T HAVE. " + EQUIPMENT_KEY_GUIDE,
        },
      },
      required: ["rationale"],
    },
  };
}

/** Returns problems ([] = valid). */
export function validateProfileProposal(input: ProfileProposal & { rationale?: string }): string[] {
  const problems: string[] = [];
  const have = cleanEquipmentKeys(input.equipment_have);
  const dontHave = cleanEquipmentKeys(input.equipment_dont_have);
  const hasAny = input.days_per_week !== undefined ||
    input.session_length_minutes !== undefined ||
    have.length > 0 || dontHave.length > 0 ||
    (typeof input.goal_append === "string" && input.goal_append.trim().length > 0) ||
    (typeof input.injuries_replace === "string" && input.injuries_replace.trim().length > 0);
  if (!hasAny) {
    problems.push("Propose at least one change (days_per_week, session_length_minutes, goal_append, injuries_replace, equipment_have or equipment_dont_have).");
  }
  if (input.session_length_minutes !== undefined &&
      !(SESSION_LENGTH_OPTIONS as readonly number[]).includes(input.session_length_minutes)) {
    problems.push("session_length_minutes must be one of 30, 45, 60, 75, 90, 105, 120 (the profile's slider).");
  }
  for (const [name, raw] of [["equipment_have", input.equipment_have], ["equipment_dont_have", input.equipment_dont_have]] as const) {
    if (raw !== undefined && (!Array.isArray(raw) || raw.some((k) => typeof k !== "string"))) {
      problems.push(`${name} must be a list of equipment keys.`);
    }
  }
  const unknown = [...have, ...dontHave].filter((k) => !EQUIPMENT_KEY_SET.has(k));
  if (unknown.length > 0) {
    problems.push(`Unknown equipment key(s): ${unknown.join(", ")}. Use only: ${ALL_EQUIPMENT_KEYS.join(", ")}.`);
  }
  const both = have.filter((k) => dontHave.includes(k));
  if (both.length > 0) problems.push(`${both.join(", ")} cannot be in both equipment_have and equipment_dont_have.`);
  if (input.days_per_week !== undefined &&
      (!Number.isInteger(input.days_per_week) || input.days_per_week < 2 || input.days_per_week > 6)) {
    // The generator builds 2 to 6 days; 1 or 7 used to save and then be
    // silently built as 2 or 6 while the profile showed the other number.
    problems.push("days_per_week must be an integer 2-6 (that is what a program can be built for).");
  }
  if (typeof input.goal_append === "string" && input.goal_append.length > 600) {
    problems.push("goal_append too long (600 chars max).");
  }
  if (typeof input.injuries_replace === "string" && input.injuries_replace.length > 500) {
    problems.push("injuries_replace too long (500 chars max).");
  }
  return problems;
}

/** What an apply did. `changed` names the fields actually written. */
export interface ApplyResult {
  error: string | null;
  changed: { days?: boolean; goal?: boolean; injuries?: boolean; session?: boolean; equipment?: boolean };
}

/**
 * The equipment record after a card's change (2026-11-23). The FULL record is
 * materialised first, with the profile page's own reading: a key never
 * unticked counts as owned (hydrateEquipment). Then only the named keys are
 * set, so no key is ever left missing and nothing the card did not name moves.
 */
export function applyEquipmentChange(
  stored: Record<string, unknown> | null | undefined,
  have: string[],
  dontHave: string[],
): Record<string, boolean> {
  const full = hydrateEquipment(stored);
  for (const k of have) if (EQUIPMENT_KEY_SET.has(k)) full[k] = true;
  for (const k of dontHave) if (EQUIPMENT_KEY_SET.has(k)) full[k] = false;
  return full;
}

/**
 * The one place a proposal becomes profile state (called by apply-profile-update).
 *
 * Everything that depends on a field is written WITH it (2026-11-23):
 *   - the goal is appended to the goal AS IT IS NOW (not the snapshot taken
 *     when the card was drawn, which could erase an edit made in between) and
 *     written to engine_goal too — there is one goal, and the Engine reads
 *     its own copy;
 *   - the write is confirmed: if the athlete has no profile row yet one is
 *     created, so "Applied" is never shown for a change that saved nothing.
 * The avoid list is refreshed by the caller after an injury change.
 * Session length and equipment (2026-11-23): the minutes are written as given
 * (validated 30 to 120 by 15 before the card was logged, and again here);
 * equipment is changed on the record AS IT IS NOW, see applyEquipmentChange.
 */
export async function applyProposalToProfile(
  supa: SupabaseClient,
  userId: string,
  _current: ProfileCurrent,
  proposal: ProfileProposal,
): Promise<ApplyResult> {
  const changed: ApplyResult["changed"] = {};
  const { data: live, error: readErr } = await supa
    .from("athlete_profiles").select("goal, equipment").eq("user_id", userId).maybeSingle();
  if (readErr) return { error: readErr.message, changed };

  const update: Record<string, unknown> = {};
  if (proposal.days_per_week !== undefined) { update.days_per_week = proposal.days_per_week; changed.days = true; }
  if (proposal.goal_append?.trim()) {
    const base = ((live?.goal as string | null) ?? "").trim();
    const next = base ? `${base}\n\n${proposal.goal_append.trim()}` : proposal.goal_append.trim();
    update.goal = next;
    update.engine_goal = next;
    changed.goal = true;
  }
  if (proposal.injuries_replace?.trim()) { update.injuries_constraints = proposal.injuries_replace.trim(); changed.injuries = true; }
  if (proposal.session_length_minutes !== undefined) {
    if (!(SESSION_LENGTH_OPTIONS as readonly number[]).includes(proposal.session_length_minutes)) {
      return { error: "Session length must be 30 to 120 minutes in steps of 15.", changed: {} };
    }
    update.session_length_minutes = proposal.session_length_minutes;
    changed.session = true;
  }
  const have = cleanEquipmentKeys(proposal.equipment_have);
  const dontHave = cleanEquipmentKeys(proposal.equipment_dont_have);
  if (have.length > 0 || dontHave.length > 0) {
    update.equipment = applyEquipmentChange(live?.equipment as Record<string, unknown> | null | undefined, have, dontHave);
    changed.equipment = true;
  }
  if (Object.keys(update).length === 0) return { error: "Nothing to apply.", changed };
  update.updated_at = new Date().toISOString();

  const { data: rows, error } = await supa
    .from("athlete_profiles").update(update).eq("user_id", userId).select("user_id");
  if (error) return { error: error.message, changed: {} };
  if ((rows ?? []).length === 0) {
    const { data: made, error: insErr } = await supa
      .from("athlete_profiles").upsert({ user_id: userId, ...update }, { onConflict: "user_id" }).select("user_id");
    if (insErr) return { error: insErr.message, changed: {} };
    if ((made ?? []).length === 0) return { error: "Your profile could not be saved.", changed: {} };
  }
  return { error: null, changed };
}
