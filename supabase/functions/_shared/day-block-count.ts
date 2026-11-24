/**
 * day-block-count.ts — which blocks count toward "this day is done". PURE
 * and import-free: the server (save-workout-block) and the app (the program
 * page's progress counts) use the same list.
 *
 * A day is marked complete when every COUNTED block has a saved log. A block
 * type that has no logger must therefore never be counted, or the day can
 * never complete. (2026-11-24) Active-recovery was counted and has no
 * logger: three real days were stuck "in progress" for good.
 *
 * tests/dayBlockCount.test.ts fails if a counted type has no logger.
 */

/** Block types that do NOT count toward a day being done. */
export const UNCOUNTED_BLOCK_TYPES = ["warm-up", "mobility", "cool-down", "active-recovery"] as const;

/** The same list as a PostgREST `not.in` value. */
export const UNCOUNTED_BLOCK_TYPES_FILTER = `(${UNCOUNTED_BLOCK_TYPES.map((t) => `"${t}"`).join(",")})`;

export const countsTowardDay = (blockType: string): boolean =>
  !(UNCOUNTED_BLOCK_TYPES as readonly string[]).includes(blockType);
