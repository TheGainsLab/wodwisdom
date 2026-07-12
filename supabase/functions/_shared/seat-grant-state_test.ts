// deno test supabase/functions/_shared/seat-grant-state_test.ts --no-check
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  SEAT_TOKEN_RE,
  decideClaim,
  decideRevoke,
  isExpired,
  peekView,
  pollStatus,
  type SeatGrantState,
} from "./seat-grant-state.ts";

const NOW = Date.parse("2026-07-12T12:00:00.000Z");
const FUTURE = "2026-08-01T00:00:00.000Z";
const PAST = "2026-07-01T00:00:00.000Z";
const ME = "user-me";
const OTHER = "user-other";

function grant(over: Partial<SeatGrantState>): SeatGrantState {
  return { status: "pending", expires_at: FUTURE, claimed_user_id: null, ...over };
}

// ── SEAT_TOKEN_RE ────────────────────────────────────────────────────────────
Deno.test("token regex: url-safe 20–128 chars, nothing else", () => {
  assert(SEAT_TOKEN_RE.test("a".repeat(20)));
  assert(SEAT_TOKEN_RE.test("a".repeat(128)));
  assert(SEAT_TOKEN_RE.test("AZaz09_-".repeat(4)));           // 32 chars, full alphabet
  assert(!SEAT_TOKEN_RE.test("a".repeat(19)));                // too short
  assert(!SEAT_TOKEN_RE.test("a".repeat(129)));               // too long
  assert(!SEAT_TOKEN_RE.test("a".repeat(19) + "!"));          // bad char
  assert(!SEAT_TOKEN_RE.test("a".repeat(19) + " "));          // whitespace
  assert(!SEAT_TOKEN_RE.test(""));
});

// ── isExpired ────────────────────────────────────────────────────────────────
Deno.test("isExpired: pending past TTL is expired even before the lazy flip", () => {
  assert(isExpired(grant({ expires_at: PAST }), NOW));
});

Deno.test("isExpired: exact-expiry instant is still valid (strictly past)", () => {
  const at = new Date(NOW).toISOString();
  assert(!isExpired(grant({ expires_at: at }), NOW));
  assert(isExpired(grant({ expires_at: at }), NOW + 1));
});

Deno.test("isExpired: status 'expired' is expired regardless of timestamp; claimed never expires by TTL", () => {
  assert(isExpired(grant({ status: "expired", expires_at: FUTURE }), NOW));
  assert(!isExpired(grant({ status: "claimed", expires_at: PAST, claimed_user_id: ME }), NOW));
});

// ── decideClaim ──────────────────────────────────────────────────────────────
Deno.test("claim: fresh pending → bind with CAS (CAS-first invariant)", () => {
  assertEquals(decideClaim(grant({}), ME, NOW), { kind: "bind", already: false, needsCas: true });
});

Deno.test("claim: re-claim by the owner → full idempotent bind, no CAS (post-CAS failure heals here)", () => {
  const g = grant({ status: "claimed", claimed_user_id: ME });
  assertEquals(decideClaim(g, ME, NOW), { kind: "bind", already: true, needsCas: false });
});

Deno.test("claim: claimed by another account → refused (single-use)", () => {
  const g = grant({ status: "claimed", claimed_user_id: OTHER });
  assertEquals(decideClaim(g, ME, NOW), { kind: "already_claimed_other" });
});

Deno.test("claim: revoked/unbound are terminal", () => {
  assertEquals(decideClaim(grant({ status: "revoked" }), ME, NOW), { kind: "not_claimable", status: "revoked" });
  assertEquals(decideClaim(grant({ status: "unbound" }), ME, NOW), { kind: "not_claimable", status: "unbound" });
});

Deno.test("claim: pending past TTL → expired, with lazy persist; already-flipped row persists nothing", () => {
  assertEquals(decideClaim(grant({ expires_at: PAST }), ME, NOW), { kind: "expired", persistLazyExpiry: true });
  assertEquals(decideClaim(grant({ status: "expired" }), ME, NOW), { kind: "expired", persistLazyExpiry: false });
});

Deno.test("claim: revoked wins over lapsed TTL (terminal state checked first)", () => {
  assertEquals(
    decideClaim(grant({ status: "revoked", expires_at: PAST }), ME, NOW),
    { kind: "not_claimable", status: "revoked" },
  );
});

// ── peekView ─────────────────────────────────────────────────────────────────
Deno.test("peek: fresh pending is claimable", () => {
  assertEquals(peekView(grant({}), ME, NOW), { status: "pending", claimable: true, already_claimed_by_me: false });
});

Deno.test("peek: lapsed pending reports expired, not claimable", () => {
  assertEquals(peekView(grant({ expires_at: PAST }), ME, NOW), { status: "expired", claimable: false, already_claimed_by_me: false });
});

Deno.test("peek: claimed by me vs by another", () => {
  assertEquals(
    peekView(grant({ status: "claimed", claimed_user_id: ME }), ME, NOW),
    { status: "claimed", claimable: false, already_claimed_by_me: true },
  );
  assertEquals(
    peekView(grant({ status: "claimed", claimed_user_id: OTHER }), ME, NOW),
    { status: "claimed", claimable: false, already_claimed_by_me: false },
  );
});

// ── decideRevoke ─────────────────────────────────────────────────────────────
Deno.test("revoke: pending → flip, nothing to delete", () => {
  assertEquals(decideRevoke(grant({})), { kind: "revoke", deleteEntitlementFor: null });
});

Deno.test("revoke: claimed → delete the bound member's entitlement first", () => {
  const g = grant({ status: "claimed", claimed_user_id: ME });
  assertEquals(decideRevoke(g), { kind: "revoke", deleteEntitlementFor: ME });
});

Deno.test("revoke: claimed with null claimed_user_id degrades to a plain flip", () => {
  assertEquals(decideRevoke(grant({ status: "claimed" })), { kind: "revoke", deleteEntitlementFor: null });
});

Deno.test("revoke: already revoked/unbound is idempotent", () => {
  assertEquals(decideRevoke(grant({ status: "revoked" })), { kind: "already", status: "revoked" });
  assertEquals(decideRevoke(grant({ status: "unbound" })), { kind: "already", status: "unbound" });
});

Deno.test("revoke-vs-claim race: re-read after a lost CAS reaches the claimed branch", () => {
  // The handler loop re-reads on a lost CAS; the fresh read (now claimed) must
  // yield the entitlement delete — this is the race finding 2 closed.
  const before = grant({});
  const afterRace = grant({ status: "claimed", claimed_user_id: OTHER });
  assertEquals(decideRevoke(before).kind, "revoke");
  assertEquals(decideRevoke(afterRace), { kind: "revoke", deleteEntitlementFor: OTHER });
});

// ── pollStatus ───────────────────────────────────────────────────────────────
Deno.test("poll: lapsed pending reports expired and asks for the lazy flip", () => {
  assertEquals(pollStatus(grant({ expires_at: PAST }), NOW), { status: "expired", lazyExpire: true });
  assertEquals(pollStatus(grant({}), NOW), { status: "pending", lazyExpire: false });
  assertEquals(pollStatus(grant({ status: "claimed" }), NOW), { status: "claimed", lazyExpire: false });
  assertEquals(pollStatus(grant({ status: "expired" }), NOW), { status: "expired", lazyExpire: false });
  assertEquals(pollStatus(grant({ status: "revoked" }), NOW), { status: "revoked", lazyExpire: false });
});
