/**
 * Pure rules of the Athlete Profile form (src/pages/AthletePage.tsx), kept out
 * of the page so they can be tested (tests/profileFormRules.test.ts).
 * Each was added 2026-11-23 for a defect named beside it.
 */
import { GOAL_MAX_CHARS } from '../../supabase/functions/_shared/goal-text.ts';

/** Typing limit of every goal box in the app. It was 500 while the coach's
 *  additions are appended with no total cap: once a goal passed 500 the box
 *  stopped accepting typing. Same number the coach and the Engine read up to. */
export const GOAL_BOX_MAX_CHARS = GOAL_MAX_CHARS;

// ── Days per week: only a whole number 2 to 6, or blank ─────────────────────
// A typed 1, 7 or 12 used to be saved as typed, while a program can only be
// built for 2 to 6 (the generator clamps), so the profile showed one number
// and the program was built on another.

export const DAYS_PER_WEEK_MIN = 2;
export const DAYS_PER_WEEK_MAX = 6;
export const DAYS_PER_WEEK_MESSAGE = 'Enter a whole number from 2 to 6.';

/** What a days-per-week box holds: the number to save (null = blank), or why
 *  it cannot be saved. */
export function checkDaysPerWeek(input: string): { value: number | null; error: string | null } {
  const text = input.trim();
  if (text === '') return { value: null, error: null };
  if (!/^\d+$/.test(text)) return { value: null, error: DAYS_PER_WEEK_MESSAGE };
  const n = parseInt(text, 10);
  if (n < DAYS_PER_WEEK_MIN || n > DAYS_PER_WEEK_MAX) return { value: null, error: DAYS_PER_WEEK_MESSAGE };
  return { value: n, error: null };
}

// ── Signup answers ("Anything else we should know?") ────────────────────────
// Clearing the box left the old answer and the facts extracted from it stored:
// the extractor was only called when some answer was non-empty, and it refuses
// empty input. They reappeared on reload and kept feeding generation.

export type IntakeSaveAction = 'extract' | 'clear' | 'none';

const hasText = (answers: Record<string, unknown> | null | undefined) =>
  Object.values(answers ?? {}).some(v => typeof v === 'string' && v.trim() !== '');

/**
 * What saving the signup answers must do.
 *   extract — some answer has text: the extractor rewrites BOTH stored columns
 *             from the non-empty answers only, so a cleared answer and its
 *             facts go with it;
 *   clear   — every answer is empty but something is stored: both columns are
 *             set to null;
 *   none    — nothing typed and nothing stored.
 */
export function intakeSaveAction(
  answers: Record<string, string>,
  stored: Record<string, unknown> | null | undefined,
): IntakeSaveAction {
  if (hasText(answers)) return 'extract';
  return hasText(stored) ? 'clear' : 'none';
}

// ── Unsaved Step 3 draft vs a newer stored value ────────────────────────────
// The draft (localStorage) used to win wherever it differed from the stored
// profile. If the member typed, left without saving, then applied a coach card
// in chat, the page restored the old draft and the next save overwrote the
// coach's change. A draft now records the stored values it was typed over
// (`base`); a field whose stored value has since changed keeps the stored
// value and that field of the draft is dropped.

export interface DraftFields {
  days: string;
  len: string;
  goal: string;
  injuries: string;
  equipment: Record<string, boolean>;
}
export type StoredDraft = Partial<DraftFields> & { base?: Partial<DraftFields> };

/** Same ticks, whatever order the keys come back in. */
export function sameEquipment(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  const norm = (r: Record<string, unknown> | null | undefined) =>
    JSON.stringify(Object.keys(r ?? {}).sort().map(k => [k, (r as Record<string, unknown>)[k]]));
  return norm(a) === norm(b);
}

/**
 * The draft fields to restore over the stored profile. A field is restored
 * only when the draft differs from the stored value AND the stored value is
 * still what the draft was typed over. A draft written before `base` existed
 * has no record of that, so it restores as it always did.
 */
export function draftFieldsToRestore(draft: StoredDraft, server: DraftFields): Partial<DraftFields> {
  const out: Partial<DraftFields> = {};
  const base = draft.base;
  for (const key of ['days', 'len', 'goal', 'injuries'] as const) {
    const typed = draft[key];
    if (typeof typed !== 'string' || typed === server[key]) continue;
    const typedOver = base?.[key];
    if (typeof typedOver === 'string' && typedOver !== server[key]) continue; // stored value is newer
    out[key] = typed;
  }
  const eq = draft.equipment;
  if (eq && typeof eq === 'object' && !sameEquipment(eq, server.equipment)) {
    const typedOver = base?.equipment;
    const stale = !!typedOver && typeof typedOver === 'object' && !sameEquipment(typedOver, server.equipment);
    if (!stale) out.equipment = eq;
  }
  return out;
}
