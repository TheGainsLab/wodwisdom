/**
 * Returning subscribers (AI Programming): continue the old program, or start a
 * new one?
 *
 * A re-subscriber is flagged resume-pending by the Stripe webhook and builds
 * from the Welcome-back banner (or the reconciler's 7-day fallback). Until
 * 2026-11 that build always APPENDED the next month to their old program — so
 * someone who trained three days of month 1 and left came back to "Month 4",
 * numbered after months they never trained, on top of a program written from an
 * evaluation that could be months old.
 *
 * Rule (founder, 2026-11-21): a returner whose last month was built more than
 * RETURNER_FRESH_AFTER_DAYS ago starts a NEW program at month 1, from a fresh
 * evaluation. The old program stays in their list as history; nothing is
 * deleted. A returner inside the window (cancelled and came straight back)
 * continues where they were.
 */
export const RETURNER_FRESH_AFTER_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param resumePendingAt athlete_profiles.programming_resume_pending_at — set
 *                        only for a re-subscriber who has not built yet.
 * @param lastMonthBuiltAt when the latest month of their latest program was built.
 */
export function returnerStartsFresh(
  resumePendingAt: string | null | undefined,
  lastMonthBuiltAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!resumePendingAt) return false; // not a returner: renewals always continue
  if (!lastMonthBuiltAt) return false; // no dated month to judge by: continue (the old behaviour)
  const built = new Date(lastMonthBuiltAt).getTime();
  if (!Number.isFinite(built)) return false;
  return now.getTime() - built > RETURNER_FRESH_AFTER_DAYS * MS_PER_DAY;
}
