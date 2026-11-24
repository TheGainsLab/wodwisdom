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

// ── Before the first build ─────────────────────────────────────────────────
// (2026-11-24) When Programming access is granted to someone with no program
// yet, the server sets their evaluation count to one (migration
// 20261124000000). They have to be TOLD: a member who rushed the free
// evaluation months ago would otherwise build their first program from it.

export const FRESH_EVALUATION_NOTE =
  'Your Programming plan includes one fresh evaluation. Review and update your profile first, then tap Run New. Your program is built from it.';
export const GENERATE_REMINDER_WITH_FRESH_EVALUATION =
  'Before you generate: review and update your profile, then run your fresh evaluation above. Your program is built from it.';
export const GENERATE_REMINDER =
  'Before you generate: review your profile and update anything that has changed. Your program is built from it.';

export interface FirstBuildFacts {
  /** Holds Programming access (not counting admin override). */
  hasProgramming: boolean;
  /** A live generated program exists. */
  hasProgram: boolean;
  /** At least one evaluation is on file. */
  hasEvaluation: boolean;
  /** Evaluation credits left (the real count, not the admin bypass). */
  evalCredits: number;
}

/** The note on the evaluation card: only for a Programming member with no
 *  program yet who already has an evaluation AND a credit to run a new one. */
export function freshEvaluationNote(f: FirstBuildFacts): string | null {
  return f.hasProgramming && !f.hasProgram && f.hasEvaluation && f.evalCredits > 0 ? FRESH_EVALUATION_NOTE : null;
}

/** The reminder beside Generate: every member about to build their first
 *  program is reminded to review their profile; one with a fresh evaluation
 *  waiting is pointed at it. Null once a program exists. */
export function generateReminder(f: FirstBuildFacts): string | null {
  if (!f.hasProgramming || f.hasProgram) return null;
  return freshEvaluationNote(f) ? GENERATE_REMINDER_WITH_FRESH_EVALUATION : GENERATE_REMINDER;
}

// ── A first build that did not finish ──────────────────────────────────────
// (2026-11-24) A failed build reset the button and put the server's raw error
// ("Signal timed out.", "[save-v3] program_workouts insert failed…") at the
// top of the page, far from the button. The member now gets plain words
// beside the button; the raw text goes to the console and the team's alert.

/** The build failed on the server. The server emails the team when this
 *  happens, so "has been notified" is true. */
export const GENERATE_FAILED_MESSAGE =
  'Generation not completed. Tap Generate to try again. Our team has been notified.';
/** The build never started (the request was rejected or errored before a job
 *  existed). No alert is sent for this, so it must not say the team knows. */
export const GENERATE_NOT_STARTED_MESSAGE = 'Generation not completed. Tap Generate to try again.';

/** Refusals whose server message is written for the member. Any other
 *  refusal carries internal text and is never shown. */
const MEMBER_WORDED_REFUSALS = new Set(['EVALUATION_REQUIRED', 'PROGRAM_ARCHIVED']);

export type GenerateOutcome =
  /** The job ended as failed. */
  | { kind: 'failed' }
  /** The server did not start a build. `code` is its error code. */
  | { kind: 'refused'; code?: string | null; message?: string | null };

/** What the member is shown beside the Generate button. Never the raw error. */
export function generateOutcomeMessage(o: GenerateOutcome): string {
  if (o.kind === 'failed') return GENERATE_FAILED_MESSAGE;
  const m = (o.message ?? '').trim();
  return m && MEMBER_WORDED_REFUSALS.has(o.code ?? '') ? m : GENERATE_NOT_STARTED_MESSAGE;
}

/** How many status checks in a row may fail before the page stops trusting
 *  its own watch and looks the build up directly. One dropped request on a
 *  phone must not end the watch. */
export const STATUS_CHECK_FAILURES_BEFORE_LOOKUP = 5;

/**
 * The page lost contact with a build (status checks kept failing, or the
 * watch ran its full time). It looks up the real state and acts on it; the
 * member is told something ONLY when the build failed (founder, 2026-11-24).
 *
 *  - a program exists           → go to it
 *  - the build is still running → keep watching (button stays on Generating…)
 *  - the build failed           → the failure message
 *  - nothing can be established → reset the button, say nothing
 */
export type LostContactAction = 'go_to_program' | 'keep_watching' | 'show_failed' | 'reset_quietly';

export function afterLostContact(facts: {
  /** A live generated program now exists for the member. */
  hasProgram: boolean;
  /** The job's status as read directly, or null if it could not be read. */
  jobStatus: string | null;
  /** The job reported progress within the server's own "still running" window. */
  jobIsFresh: boolean;
  /** How many times the page has already gone back to watching this build. */
  rewatches: number;
}): LostContactAction {
  if (facts.hasProgram) return 'go_to_program';
  if (facts.jobStatus === 'failed') return 'show_failed';
  const running = facts.jobStatus === 'processing' || facts.jobStatus === 'pending';
  if (running && facts.jobIsFresh && facts.rewatches < 3) return 'keep_watching';
  return 'reset_quietly';
}
