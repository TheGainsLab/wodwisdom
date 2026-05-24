/**
 * Feature flags — Deno-side mirror of src/lib/featureFlags.ts. Keep in
 * lockstep with the client flag; flipping one without the other produces
 * server/client mismatch (page opens but API 403s, or vice versa).
 */

/**
 * Athlete Data public-tier rollout. See src/lib/featureFlags.ts for full
 * semantics. When `false`, all athletedata edge functions enforce admin-only.
 * When `true`:
 *   - search-competition-athletes / competition-catalog: any authenticated user
 *   - verify-competition-athlete: admin OR linked-to-this-id OR pre-link
 *     verify (unlinked user fetching any id during the linking flow)
 *
 * After flipping, redeploy the three affected functions.
 */
export const ATHLETEDATA_PUBLIC_TIER = false;
