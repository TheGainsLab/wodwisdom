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
  "- Durable only. 'My legs are smoked today' or 'traveling this week' is day-scale — no proposal.\n" +
  "- goal_append is ADDED to their goal text (date it, keep their phrasing: e.g. \"Oct 2026 update: ...\"); " +
  "days_per_week replaces the number; injuries_replace replaces the injuries text entirely, so restate anything " +
  "that still applies.\n" +
  "- One proposal per message, after you understand the change — a clarifying question first is often right.\n" +
  "- After the athlete applies: tell them their NEXT generated month will be built from the updated profile " +
  "automatically. If they need the CURRENT month rebuilt sooner, that goes through a human — point them to the " +
  "Message a human coach button (or coach@thegainslab.com).\n" +
  "- Never claim the profile changed unless the card was applied.";

export function buildProposeProfileUpdateTool(current: ProfileCurrent) {
  return {
    name: "propose_profile_update",
    description:
      "Propose a durable update to the athlete's profile (training days per week, goal text to append, " +
      "injuries/constraints). Renders as an Apply / Not now card — nothing changes unless the athlete taps Apply. " +
      `Their profile now: days_per_week=${current.days_per_week ?? "unset"}; ` +
      `goal=${JSON.stringify((current.goal ?? "").slice(0, 400))}; ` +
      `injuries=${JSON.stringify((current.injuries_constraints ?? "").slice(0, 200))}.`,
    input_schema: {
      type: "object",
      properties: {
        rationale: {
          type: "string",
          description: "One sentence, athlete-facing: why this update, in plain words.",
        },
        days_per_week: {
          type: "integer", minimum: 1, maximum: 7,
          description: "New training days per week, only if it changed.",
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
      (!Number.isInteger(input.days_per_week) || input.days_per_week < 1 || input.days_per_week > 7)) {
    problems.push("days_per_week must be an integer 1-7.");
  }
  if (typeof input.goal_append === "string" && input.goal_append.length > 600) {
    problems.push("goal_append too long (600 chars max).");
  }
  if (typeof input.injuries_replace === "string" && input.injuries_replace.length > 500) {
    problems.push("injuries_replace too long (500 chars max).");
  }
  return problems;
}

/** The one place a proposal becomes profile state (called by apply-profile-update). */
export async function applyProposalToProfile(
  supa: SupabaseClient,
  userId: string,
  current: ProfileCurrent,
  proposal: ProfileProposal,
): Promise<string | null> {
  const update: Record<string, unknown> = {};
  if (proposal.days_per_week !== undefined) update.days_per_week = proposal.days_per_week;
  if (proposal.goal_append?.trim()) {
    const base = (current.goal ?? "").trim();
    update.goal = base ? `${base}\n\n${proposal.goal_append.trim()}` : proposal.goal_append.trim();
  }
  if (proposal.injuries_replace?.trim()) update.injuries_constraints = proposal.injuries_replace.trim();
  if (Object.keys(update).length === 0) return "Nothing to apply.";
  const { error } = await supa.from("athlete_profiles").update(update).eq("user_id", userId);
  return error ? error.message : null;
}
