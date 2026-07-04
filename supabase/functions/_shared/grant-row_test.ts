// deno test supabase/functions/_shared/grant-row_test.ts --no-check
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildGrantRow } from "./grant-row.ts";

Deno.test("buildGrantRow: NEVER includes granted_at — a re-grant (reactivation) can't clobber the original timestamp", () => {
  // PostgREST upsert does ON CONFLICT DO UPDATE SET col = excluded.col for each column
  // PRESENT in the payload; a column absent from the payload is left unchanged. So the
  // gym months drip (keyed on granted_at) is safe iff the grant payload omits granted_at.
  const row = buildGrantRow({ userId: "u1", gymId: "g1", feature: "engine", expiresProvided: false, expiresAt: null });
  assert(!("granted_at" in row), "grant payload must not carry granted_at (else re-grant resets the drip clock)");
  // Identity/scoping columns are present.
  assertEquals(row.user_id, "u1");
  assertEquals(row.feature, "engine");
  assertEquals(row.source, "gym_g1");
  assertEquals(row.source_kind, "gym_grant");
  assertEquals(row.granted_by, "g1");
});

Deno.test("buildGrantRow: expires_at present ONLY when provided (ABSENT=omit, null=clear, ts=set)", () => {
  // ABSENT → omitted (a retry must not clobber a stored expiry to null).
  const omit = buildGrantRow({ userId: "u1", gymId: "g1", feature: "engine", expiresProvided: false, expiresAt: null });
  assert(!("expires_at" in omit));

  // explicit null → present as null (reactivate: clear the expiry).
  const clear = buildGrantRow({ userId: "u1", gymId: "g1", feature: "engine", expiresProvided: true, expiresAt: null });
  assert("expires_at" in clear);
  assertEquals(clear.expires_at, null);

  // timestamp → set (deactivate at period end).
  const set = buildGrantRow({ userId: "u1", gymId: "g1", feature: "engine", expiresProvided: true, expiresAt: "2026-08-01T00:00:00.000Z" });
  assertEquals(set.expires_at, "2026-08-01T00:00:00.000Z");
  // ...and still no granted_at on the deactivate/reactivate path.
  assert(!("granted_at" in set));
});
