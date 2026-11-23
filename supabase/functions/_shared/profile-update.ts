/**
 * Chat → profile Apply: the coach proposes a profile diff, the athlete taps
 * Apply. Shared by the chat fn (tool definition + validation + the prompt
 * addendum) and apply-profile-update (the resolver).
 *
 * SCOPE (v1, deliberate): days_per_week, goal (append-only — the goal box is
 * the athlete's own writing, never silently overwritten), and
 * injuries_constraints (replace — stale injury text is worse than none).
 * Equipment stays manual on the profile page: it's a 20-flag grid that makes
 * a bad card.
 *
 * LAW: nothing is ever written without the athlete's tap. The proposal is
 * logged BEFORE the card renders; apply resolves the logged row exactly once.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ProfileCurrent {
  days_per_week: number | null;
  goal: string | null;
  injuries_constraints: string | null;
}

export interface ProfileProposal {
  days_per_week?: number;
  goal_append?: string;
  injuries_replace?: string;
}

export const PROFILE_UPDATE_PROMPT =
  "\n\nPROFILE UPDATE PROPOSALS (propose_profile_update): When the athlete states a DURABLE change to their " +
  "circumstances or goals — training days per week, outside training load (a sport season, Hyrox, a gym program), " +
  "a goal shift, an injury or constraint to work around — propose a profile update. The athlete sees a card with " +
  "the exact diff and Apply / Not now buttons; NOTHING changes unless they tap Apply.\n" +
  "- Durable only. 'My legs are smoked today' is day-scale — no proposal. 'Traveling next week', 'more pull-ups' " +
  "is week-scale — that is a propose_coach_note, not a profile update.\n" +
  "- goal_append is ADDED to their goal text (date it, keep their phrasing: e.g. \"Oct 2026 update: ...\"); " +
  "days_per_week replaces the number; injuries_replace replaces the injuries text entirely, so restate anything " +
  "that still applies.\n" +
  "- One proposal per message, after you understand the change — a clarifying question first is often right.\n" +
  "- WHEN IT TAKES EFFECT (say this, and only this): AI Programming is written a week at a time. A change to " +
  "days per week or goal RE-PLANS the weeks of the current month that are not written yet, when the next week is " +
  "written; weeks already written do not change (to change a written day they open it and ask you there). If every " +
  "week of the month is already written, it applies from the next month. An injury change is checked against every " +
  "week written from then on. NEVER say 'next month' when unwritten weeks remain, and NEVER send them to a human " +
  "for a rebuild — none is needed. The card itself states the exact effect once applied; do not contradict it.\n" +
  "- days_per_week is AI Programming's setting (2 to 6). The Engine's days per week come from the Engine program " +
  "(Switch Program) — never propose days_per_week to change an Engine week; say where to change it instead.\n" +
  "- injuries_replace REPLACES the whole note. You are shown the athlete's full current note below: carry over " +
  "everything in it that still applies, word for word, and change only what they told you changed.\n" +
  "- Never claim the profile changed unless the card was applied.";

export function buildProposeProfileUpdateTool(current: ProfileCurrent) {
  return {
    name: "propose_profile_update",
    description:
      "Propose a durable update to the athlete's profile (training days per week, goal text to append, " +
      "injuries/constraints). Renders as an Apply / Not now card — nothing changes unless the athlete taps Apply. " +
      `Their profile now: days_per_week=${current.days_per_week ?? "unset"}; ` +
      `goal=${JSON.stringify((current.goal ?? "").slice(0, 400))}; ` +
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
      },
      required: ["rationale"],
    },
  };
}

/** Returns problems ([] = valid). */
export function validateProfileProposal(input: ProfileProposal & { rationale?: string }): string[] {
  const problems: string[] = [];
  const hasAny = input.days_per_week !== undefined ||
    (typeof input.goal_append === "string" && input.goal_append.trim().length > 0) ||
    (typeof input.injuries_replace === "string" && input.injuries_replace.trim().length > 0);
  if (!hasAny) problems.push("Propose at least one change (days_per_week, goal_append, or injuries_replace).");
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
  changed: { days?: boolean; goal?: boolean; injuries?: boolean };
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
 */
export async function applyProposalToProfile(
  supa: SupabaseClient,
  userId: string,
  _current: ProfileCurrent,
  proposal: ProfileProposal,
): Promise<ApplyResult> {
  const changed: ApplyResult["changed"] = {};
  const { data: live, error: readErr } = await supa
    .from("athlete_profiles").select("goal").eq("user_id", userId).maybeSingle();
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
