/**
 * seat-grant-state.ts — pure transition logic for gym seat tokens (identity
 * model Phase 2). Extracted from gym-seat-claim / gym-seat-grant so every edge
 * (expiry boundary, re-claim heal, lost CAS, revoke-vs-claim race) is
 * table-testable without a DB — see seat-grant-state_test.ts.
 *
 * The handlers own all I/O and the CAS/retry loops; these functions only DECIDE.
 * Status vocabulary: pending | claimed | expired | revoked | unbound
 * (gym_seat_grant_status enum).
 */

/** Opaque token shape: ≥128-bit handles are 22+ chars (base64url) or 32
 *  (hex/UUID-no-dash) — accept a generous url-safe range, bound so junk can't
 *  blow up a query. ONE definition; create/claim/status all validate with it. */
export const SEAT_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export interface SeatGrantState {
  status: string;
  expires_at: string | null;
  claimed_user_id: string | null;
}

/** A pending grant past its TTL is expired even if the row hasn't been lazily
 *  flipped yet. Strictly past — a grant claimed at the exact expiry instant is
 *  still valid. */
export function isExpired(g: Pick<SeatGrantState, "status" | "expires_at">, nowMs: number): boolean {
  if (g.status === "expired") return true;
  if (g.status !== "pending" || g.expires_at === null) return false;
  return new Date(g.expires_at).getTime() < nowMs;
}

export type ClaimDecision =
  /** revoked | unbound — terminal, nobody can claim. */
  | { kind: "not_claimable"; status: string }
  /** TTL lapsed. persistLazyExpiry: the row still says pending, so the handler
   *  should best-effort flip it (mirror of the status poll's lazy expiry). */
  | { kind: "expired"; persistLazyExpiry: boolean }
  /** Single-use: a DIFFERENT account holds this token. */
  | { kind: "already_claimed_other" }
  /** This caller may bind. already=true is the idempotent re-claim (the member
   *  re-presenting their own token) — the handler re-runs the FULL bind so a
   *  retry after a post-CAS partial failure heals. needsCas=true means the row
   *  is pending and must be compare-and-swapped pending→claimed BEFORE any
   *  entitlement write (CAS-first: a losing racer never writes anything). */
  | { kind: "bind"; already: boolean; needsCas: boolean };

export function decideClaim(g: SeatGrantState, userId: string, nowMs: number): ClaimDecision {
  if (g.status === "revoked" || g.status === "unbound") {
    return { kind: "not_claimable", status: g.status };
  }
  if (isExpired(g, nowMs)) {
    return { kind: "expired", persistLazyExpiry: g.status === "pending" };
  }
  if (g.status === "claimed") {
    return g.claimed_user_id === userId
      ? { kind: "bind", already: true, needsCas: false }
      : { kind: "already_claimed_other" };
  }
  return { kind: "bind", already: false, needsCas: true };
}

/** The peek response shape the claim page renders from (no binding). */
export function peekView(
  g: SeatGrantState,
  userId: string,
  nowMs: number,
): { status: string; claimable: boolean; already_claimed_by_me: boolean } {
  const expired = isExpired(g, nowMs);
  return {
    status: expired ? "expired" : g.status,
    claimable: g.status === "pending" && !expired,
    already_claimed_by_me: g.status === "claimed" && g.claimed_user_id === userId,
  };
}

export type RevokeDecision =
  /** Idempotent: already revoked/unbound — report done, touch nothing. */
  | { kind: "already"; status: string }
  /** Flip to revoked, CAS-guarded on the status we read. deleteEntitlementFor
   *  is the bound member's id when the seat was claimed (scoped entitlement
   *  delete first), null for pending/expired. */
  | { kind: "revoke"; deleteEntitlementFor: string | null };

export function decideRevoke(g: SeatGrantState): RevokeDecision {
  if (g.status === "revoked" || g.status === "unbound") {
    return { kind: "already", status: g.status };
  }
  return {
    kind: "revoke",
    deleteEntitlementFor: g.status === "claimed" ? (g.claimed_user_id ?? null) : null,
  };
}

/** One poll row. lazyExpire: the row still says pending but the TTL lapsed —
 *  the handler should best-effort persist status='expired'. */
export function pollStatus(
  g: Pick<SeatGrantState, "status" | "expires_at">,
  nowMs: number,
): { status: string; lazyExpire: boolean } {
  const expired = isExpired(g, nowMs);
  return { status: expired ? "expired" : g.status, lazyExpire: expired && g.status === "pending" };
}
