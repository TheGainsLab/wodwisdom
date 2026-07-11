// deno test supabase/functions/_shared/gym-seat-state_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyClaim,
  classifyPeek,
  classifyRevoke,
  isExpired,
  pollStatus,
} from "./gym-seat-state.ts";

const NOW = Date.parse("2026-07-11T12:00:00Z");
const FUTURE = "2026-08-10T12:00:00Z"; // within TTL
const PAST = "2026-07-01T12:00:00Z"; // TTL lapsed
const ME = "user-me";
const OTHER = "user-other";

// ── isExpired ───────────────────────────────────────────────────────────────────
Deno.test("isExpired: only a PENDING grant past its TTL is expired", () => {
  assertEquals(isExpired("pending", PAST, NOW), true);
  assertEquals(isExpired("pending", FUTURE, NOW), false);
  // A non-pending status is never time-derived here (claimed keeps access even 'past TTL').
  assertEquals(isExpired("claimed", PAST, NOW), false);
  assertEquals(isExpired("revoked", PAST, NOW), false);
  assertEquals(isExpired("unbound", PAST, NOW), false);
});

// ── pollStatus (the affiliate-facing vocabulary — the claimed->active fix) ────────
Deno.test("pollStatus: claimed is presented to the affiliate as ACTIVE", () => {
  assertEquals(pollStatus("claimed", FUTURE, NOW), "active");
});

Deno.test("pollStatus: pending past TTL -> expired; everything else passes through", () => {
  assertEquals(pollStatus("pending", FUTURE, NOW), "pending");
  assertEquals(pollStatus("pending", PAST, NOW), "expired");
  assertEquals(pollStatus("expired", PAST, NOW), "expired");
  assertEquals(pollStatus("revoked", FUTURE, NOW), "revoked");
  assertEquals(pollStatus("unbound", FUTURE, NOW), "unbound");
  // The internal term `claimed` must NEVER leak across the seam.
  assertEquals(pollStatus("claimed", PAST, NOW) === "claimed", false);
});

// ── classifyClaim (the pre-CAS decision) ─────────────────────────────────────────
const grant = (status: string, expires: string, claimedBy: string | null = null) =>
  ({ status, expires_at: expires, claimed_user_id: claimedBy });

Deno.test("classifyClaim: pending in TTL -> proceed (first claim)", () => {
  assertEquals(classifyClaim(grant("pending", FUTURE), ME, NOW), { kind: "proceed", already: false });
});

Deno.test("classifyClaim: claimed by ME -> proceed as re-claim (self-healing bind)", () => {
  assertEquals(classifyClaim(grant("claimed", FUTURE, ME), ME, NOW), { kind: "proceed", already: true });
});

Deno.test("classifyClaim: claimed by ANOTHER user -> already_other (single-use)", () => {
  assertEquals(classifyClaim(grant("claimed", FUTURE, OTHER), ME, NOW), { kind: "already_other" });
});

Deno.test("classifyClaim: pending past TTL -> expired; explicit expired -> expired", () => {
  assertEquals(classifyClaim(grant("pending", PAST), ME, NOW), { kind: "expired" });
  assertEquals(classifyClaim(grant("expired", PAST), ME, NOW), { kind: "expired" });
});

Deno.test("classifyClaim: revoked/unbound -> terminal", () => {
  assertEquals(classifyClaim(grant("revoked", FUTURE), ME, NOW), { kind: "terminal", status: "revoked" });
  assertEquals(classifyClaim(grant("unbound", FUTURE), ME, NOW), { kind: "terminal", status: "unbound" });
});

Deno.test("classifyClaim: expiry is checked BEFORE the already-claimed-by-other branch", () => {
  // A stale token claimed by someone else but past TTL still reports expired (the claim
  // window closed) — order matters so the member gets the actionable "resend" message.
  assertEquals(classifyClaim(grant("pending", PAST, null), ME, NOW), { kind: "expired" });
});

// ── classifyPeek (page view — NOT poll-mapped; keeps internal `claimed`) ──────────
Deno.test("classifyPeek: pending in TTL is claimable", () => {
  assertEquals(classifyPeek(grant("pending", FUTURE), ME, NOW), { status: "pending", claimable: true, already_claimed_by_me: false });
});

Deno.test("classifyPeek: claimed-by-me flagged; page keeps internal 'claimed' (not 'active')", () => {
  assertEquals(classifyPeek(grant("claimed", FUTURE, ME), ME, NOW), { status: "claimed", claimable: false, already_claimed_by_me: true });
});

Deno.test("classifyPeek: claimed-by-other is not claimable and not mine", () => {
  assertEquals(classifyPeek(grant("claimed", FUTURE, OTHER), ME, NOW), { status: "claimed", claimable: false, already_claimed_by_me: false });
});

Deno.test("classifyPeek: pending past TTL folds to expired and is not claimable", () => {
  assertEquals(classifyPeek(grant("pending", PAST), ME, NOW), { status: "expired", claimable: false, already_claimed_by_me: false });
});

// ── classifyRevoke ───────────────────────────────────────────────────────────────
Deno.test("classifyRevoke: claimed with a bound user -> remove_entitlement", () => {
  assertEquals(classifyRevoke("claimed", ME), { kind: "remove_entitlement" });
});

Deno.test("classifyRevoke: pending/expired -> cancel (no entitlement to remove)", () => {
  assertEquals(classifyRevoke("pending", null), { kind: "cancel" });
  assertEquals(classifyRevoke("expired", null), { kind: "cancel" });
});

Deno.test("classifyRevoke: already revoked/unbound -> idempotent no-op", () => {
  assertEquals(classifyRevoke("revoked", ME), { kind: "already_done", status: "revoked" });
  assertEquals(classifyRevoke("unbound", null), { kind: "already_done", status: "unbound" });
});

Deno.test("classifyRevoke: claimed WITHOUT a bound user (data anomaly) -> cancel, not a null delete", () => {
  // Defensive: never issue an entitlement delete keyed on a null user.
  assertEquals(classifyRevoke("claimed", null), { kind: "cancel" });
});
