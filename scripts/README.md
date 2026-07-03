# scripts

## `test_wholesale_grants_retail_invariant.sh`

Integration test for the **retail invariant** of the Wholesale Grants API: granting
or revoking a gym (`engine_cohort`) seat for a member who also holds an active retail
entitlement must leave the retail rows **byte-identical**.

```bash
bash scripts/test_wholesale_grants_retail_invariant.sh
```

Requires a local Postgres reachable via `psql` (with `createdb`/`dropdb`). It spins
up a throwaway DB, applies the entitlements schema (mirroring migration
`20260702120000`), and asserts the invariant across grant + expiry-retry + revoke —
exiting non-zero (via `RAISE EXCEPTION`) on any violation. Runs nothing against a
real database.
