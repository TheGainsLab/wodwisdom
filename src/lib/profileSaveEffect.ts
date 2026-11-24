/**
 * What a profile save changes for a member whose program is already running
 * (2026-11-24). The Athlete Profile page used to answer a save with a green
 * tick only: a member who cut from 5 days to 4 opened their program, found
 * this week still had 5, and nothing had told them that was expected.
 *
 * The sentences are the coach card's own (profile-effect-text.ts), spoken in
 * the page's voice, so the two cannot drift apart. Shown only when the member
 * HAS a program; before the first build the Generate reminder covers it.
 */
import { describeEffect, type EffectFacts } from '../../supabase/functions/_shared/profile-effect-text.ts';
import type { DraftFields } from './profileFormRules';

/** Which of the five plan settings a save changed (stored value before → after). */
export interface SaveChange { days: boolean; session: boolean; goal: boolean; injuries: boolean; equipment: boolean }

/** What the member does NOT have. A key that is missing counts as owned (the
 *  same rule the generator uses), so the first save of a never-reviewed
 *  checklist with everything ticked is not a change. */
const lacking = (e: Record<string, boolean> | null | undefined) =>
  Object.keys(e ?? {}).filter((k) => (e as Record<string, boolean>)[k] === false).sort().join(',');

export function changedBySave(before: DraftFields, after: DraftFields): SaveChange {
  const t = (v: string | null | undefined) => (v ?? '').trim();
  return {
    days: t(before.days) !== t(after.days),
    session: t(before.len) !== t(after.len),
    goal: t(before.goal) !== t(after.goal),
    injuries: t(before.injuries) !== t(after.injuries),
    equipment: lacking(before.equipment) !== lacking(after.equipment),
  };
}

/** The notes, grouped by the Step 3 card each one sits under. */
export interface SaveEffectNotes { schedule: string[]; equipment: string[]; coach: string[] }

export const NO_SAVE_EFFECT: SaveEffectNotes = { schedule: [], equipment: [], coach: [] };

/**
 * `program` is the member's live program (null = none: no notes at all).
 * Schedule card holds days + session length; the coach card holds goal +
 * injury note; equipment has its own card.
 */
export function saveEffectNotes(change: SaveChange, program: EffectFacts['program']): SaveEffectNotes {
  if (!program) return NO_SAVE_EFFECT;
  const facts: EffectFacts = { hasProgramming: true, hasEngine: false, program, engineProgramChosen: false, engineSequencing: false };
  const say = (c: Parameters<typeof describeEffect>[0]) =>
    Object.values(c).some(Boolean) ? describeEffect(c, facts, 'page') : [];
  return {
    schedule: say({ days: change.days, session: change.session }),
    equipment: say({ equipment: change.equipment }),
    coach: say({ goal: change.goal, injuries: change.injuries }),
  };
}
