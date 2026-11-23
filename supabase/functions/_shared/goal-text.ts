/**
 * goal-text.ts — how much of the athlete's goal a prompt reads.
 *
 * Why (2026-11-23): the coach read the first 400 characters of the goal and
 * the Engine sequencer the first 500, while the coach's own additions are
 * appended at the END. The newest text was the first thing cut. Every reader
 * now gets the whole goal. The cap below is a safety limit only (a prompt must
 * not grow without bound); when it applies it cuts from the START, so the
 * newest text always survives. Pure, no imports: the app's goal boxes use the
 * same number as their typing limit.
 */
export const GOAL_MAX_CHARS = 4000;

/** The goal as a prompt should read it: trimmed, whole, newest text kept. */
export function goalForPrompt(goal: string | null | undefined, max = GOAL_MAX_CHARS): string {
  const text = (goal ?? "").trim();
  if (text.length <= max) return text;
  // Cut from the start: additions are appended, so the end is the newest.
  return "…" + text.slice(text.length - max).trimStart();
}
