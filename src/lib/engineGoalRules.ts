/**
 * Pure rules for writes of the Engine goal (engineService.saveEngineGoal,
 * the Engine dashboard, the Engine program switch). Kept free of the Supabase
 * client so they can be tested (tests/engineGoalRules.test.ts). 2026-11-23.
 */

/** The athlete_profiles columns a goal write sets, or null for "write nothing". */
export type GoalWrite = { engine_goal: string | null; goal?: string | null } | null;

/**
 * What a goal save writes.
 *
 * ONE GOAL: text typed in any Engine screen is written to both `engine_goal`
 * and the profile `goal`, as the Athlete page does.
 *
 * Blank is a no-op unless the screen asked to clear (`allowClear`): the Engine
 * setup and the program switch pre-fill the box, and an untouched or
 * failed-to-load box must never erase a goal.
 *
 * Clearing (the Engine dashboard, which tells the member "Leave blank any
 * time"; before 2026-11-23 a blank save was skipped, so the goal looked
 * cleared and stayed stored): `engine_goal` is set to null. The profile `goal`
 * is cleared with it only for a member WITHOUT AI Programming. For a
 * Programming member the profile goal is a required field their program is
 * built from (a profile with no goal cannot build), so an Engine screen does
 * not erase it; they clear or change that one on their profile.
 */
export function goalWriteFor(text: string, opts: { allowClear?: boolean; hasProgramming?: boolean } = {}): GoalWrite {
  const t = text.trim();
  if (t) return { engine_goal: t, goal: t };
  if (!opts.allowClear) return null;
  return opts.hasProgramming === false ? { engine_goal: null, goal: null } : { engine_goal: null };
}

/**
 * The Engine program switch (2026-11-23). The screen pre-fills its goal box
 * from the goal as it was when the screen opened, and used to write that text
 * back on every pick — over a goal changed since (on the profile, on the
 * dashboard, or by the coach's card). The goal is now written only when the
 * member edited the box in that screen.
 */
export function goalToSaveOnProgramPick(goalBox: string, editedHere: boolean): string | null {
  return editedHere && goalBox.trim() ? goalBox : null;
}
