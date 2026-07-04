/**
 * grant-row.ts — builds the upsert payload for a wholesale gym grant.
 *
 * Extracted PURE so the "re-grant never clobbers granted_at" invariant is testable
 * without a DB: PostgREST upsert does `INSERT … ON CONFLICT DO UPDATE SET col =
 * excluded.col` for EACH column PRESENT in the payload. `granted_at` is deliberately
 * ABSENT here, so on an idempotent re-grant (reactivation) the DO UPDATE cannot touch
 * it — the row keeps its ORIGINAL grant timestamp, which the gym months-drip
 * (gym-engine-months-cron) keys on. If a future edit adds `granted_at` to this payload,
 * the grant-row test fails — that is the guard.
 *
 * `expires_at` follows the wholesale semantics: ABSENT = omit (a retry must not clobber
 * a stored expiry to NULL); explicit null = clear (reactivate); timestamp = set
 * (deactivate at period end).
 */

export interface GrantRowInput {
  userId: string;
  gymId: string;
  feature: string;
  /** True when the caller sent an `expires_at` (null or a timestamp). */
  expiresProvided: boolean;
  /** The value to set when expiresProvided; null clears the expiry. */
  expiresAt: string | null;
}

export function buildGrantRow(i: GrantRowInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: i.userId,
    feature: i.feature,
    // `source` = 'gym_' || gym_id (PREFIXED): the legacy UNIQUE(user_id, feature,
    // source) still applies, and the prefix keeps gym rows out of every existing
    // `source` reader's namespace. granted_by is the canonical tenant column.
    source: `gym_${i.gymId}`,
    source_kind: "gym_grant",
    granted_by: i.gymId,
    // NOTE: granted_at is intentionally NOT set — see file header (re-grant invariant).
  };
  if (i.expiresProvided) row.expires_at = i.expiresAt;
  return row;
}
