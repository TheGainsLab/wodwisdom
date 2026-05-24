/**
 * Feature flags — single-flip switches for GA-rollout work.
 *
 * Keep parallel constants in supabase/functions/_shared/feature-flags.ts and
 * flip both together; the client controls visibility, the server controls
 * data access. After flipping, redeploy the affected edge functions.
 */

/**
 * Athlete Data public-tier rollout.
 *
 * When `false` (current state — admin-only beta):
 *   - Nav sidebar link is admin-only
 *   - /athletedata page redirects non-admins to /profile
 *   - All athletedata edge functions (search-competition-athletes,
 *     competition-catalog, verify-competition-athlete) require admin role
 *
 * When `true` (GA shape — designed but not shipped):
 *   - Nav link visible to all authenticated users
 *   - /athletedata page open to all authenticated users
 *   - Search + catalog: any authenticated user
 *   - Bundle (verify-competition-athlete): admin OR athlete linking to
 *     this competition_athlete_id OR pre-link verify when unlinked
 *   - Try-It (canLog): admin OR competition_log OR programming
 *
 * To flip:
 *   1. Set this to `true`
 *   2. Set `ATHLETEDATA_PUBLIC_TIER` in supabase/functions/_shared/feature-flags.ts to `true`
 *   3. Redeploy: search-competition-athletes, competition-catalog, verify-competition-athlete
 */
export const ATHLETEDATA_PUBLIC_TIER = false;
