/**
 * gym-seat-state — pure decision logic for the gym seat token state machine
 * (identity model Phase 2). Extracted so the transition table is unit-testable without
 * a DB or network: the edge functions (gym-seat-grant, gym-seat-claim) call these and
 * keep ONLY the compare-and-swap / DB mechanics inline. No side effects here.
 *
 * Internal lifecycle enum: pending | claimed | expired | revoked | unbound.
 * Affiliate-facing POLL vocabulary (IDENTITY_MODEL §4): pending | active | expired |
 * unbound — `claimed` is presented to the affiliate as `active` (billing keys on
 * `active`); the internal `claimed` term never leaks across the seam.
 */

export interface GrantView {
  status: string;
  expires_at: string;
  claimed_user_id: string | null;
}

/** A PENDING grant past its TTL reads as expired. No other status is time-sensitive. */
export function isExpired(status: string, expiresAtIso: string, nowMs: number): boolean {
  return status === "pending" && new Date(expiresAtIso).getTime() < nowMs;
}

/**
 * Map the internal lifecycle status to the affiliate-facing poll vocabulary:
 *   claimed             -> active   (the whole point — billing keys on `active`)
 *   pending & past TTL  -> expired
 *   pending | expired | revoked | unbound -> unchanged
 */
export function pollStatus(status: string, expiresAtIso: string, nowMs: number): string {
  if (isExpired(status, expiresAtIso, nowMs)) return "expired";
  if (status === "claimed") return "active";
  return status;
}

// ── Claim (the PRE-compare-and-swap decision) ───────────────────────────────────
export type ClaimDecision =
  | { kind: "terminal"; status: string }   // revoked | unbound   -> 409 not_claimable
  | { kind: "expired" }                     // pending past TTL / expired -> 410
  | { kind: "already_other" }               // claimed by a DIFFERENT user -> 409
  | { kind: "proceed"; already: boolean };  // pending (already:false) | claimed-by-me (already:true)

/** What a claim by `userId` should do, given the grant as read. The caller then runs
 *  the CAS (`proceed`) or returns the mapped error. `already` marks a same-member
 *  re-claim, which re-runs the full idempotent bind (self-healing) rather than
 *  short-circuiting. */
export function classifyClaim(grant: GrantView, userId: string, nowMs: number): ClaimDecision {
  if (grant.status === "revoked" || grant.status === "unbound") return { kind: "terminal", status: grant.status };
  if (grant.status === "expired" || isExpired(grant.status, grant.expires_at, nowMs)) return { kind: "expired" };
  if (grant.status === "claimed" && grant.claimed_user_id !== userId) return { kind: "already_other" };
  return { kind: "proceed", already: grant.status === "claimed" };
}

// ── Peek (the claim page's read-only view) ──────────────────────────────────────
export interface PeekView {
  status: string;                 // internal status with expiry folded in (NOT poll-mapped)
  claimable: boolean;
  already_claimed_by_me: boolean;
}

/** The claim page shows internal terms (it renders "already used" for `claimed`), so
 *  peek does NOT apply the affiliate poll mapping — only folds in expiry. */
export function classifyPeek(grant: GrantView, userId: string, nowMs: number): PeekView {
  const expired = grant.status === "expired" || isExpired(grant.status, grant.expires_at, nowMs);
  return {
    status: expired ? "expired" : grant.status,
    claimable: grant.status === "pending" && !expired,
    already_claimed_by_me: grant.status === "claimed" && grant.claimed_user_id === userId,
  };
}

// ── Revoke (the branch decision, before the guarded status flip) ─────────────────
export type RevokeDecision =
  | { kind: "already_done"; status: string }  // revoked | unbound -> idempotent no-op
  | { kind: "remove_entitlement" }            // claimed with a bound user -> delete then flip
  | { kind: "cancel" };                        // pending | expired -> just flip to revoked

export function classifyRevoke(status: string, claimedUserId: string | null): RevokeDecision {
  if (status === "revoked" || status === "unbound") return { kind: "already_done", status };
  if (status === "claimed" && claimedUserId) return { kind: "remove_entitlement" };
  return { kind: "cancel" };
}
