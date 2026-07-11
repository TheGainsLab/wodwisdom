-- Identity migration Phase 2 (P2a) — token-based delivery, wodwisdom side.
-- See affiliate-intelligence docs/IDENTITY_PHASE_2_DESIGN.md + IDENTITY_MODEL.md.
--
-- gym_seat_grants is the PRIVATE token→grant→account registry. The affiliate mints
-- an opaque token per seat and calls gym-seat-grant `create` (no account exists yet).
-- The member later CLAIMS the token via gym-seat-claim — ordinary signup/login —
-- which binds the pending grant as a `gym_grant` entitlement source on their account.
-- The affiliate only ever holds the token; it never sees a wodwisdom user id.
--
-- Deployed ALONGSIDE the existing user-id wholesale-grants path (untouched); the old
-- path is retired in Phase 5.
--
-- Also: adds member_consents.status so a `declined` is a real, auditable record (today
-- a row means presence=granted). Row-per-(user,type,version,gym) already scopes consent
-- by type, so the injuries/health opt-in is a future consent_type with no migration.
--
-- Additive + idempotent + SQL-editor-ready. NOTIFY pgrst at the end.

begin;

do $$ begin
  create type gym_seat_grant_status as enum ('pending', 'claimed', 'expired', 'revoked', 'unbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gym_seat_consent as enum ('not_yet', 'granted', 'declined');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- gym_seat_grants — one row per affiliate-issued seat token.
-- =============================================================================
create table if not exists gym_seat_grants (
  id uuid primary key default gen_random_uuid(),

  -- The opaque affiliate-issued handle (≥128-bit; IDENTITY_MODEL §5.1). The ONLY
  -- thing that crosses the seam. Globally unique.
  token text not null unique,

  -- The granting gym (affiliate community id). uuid here (P2b standardizes the older
  -- text columns to match).
  gym_id uuid not null,

  -- The entitlement this token grants; must be allowlisted (ALLOWED_GRANT_FEATURES),
  -- enforced in the edge function.
  feature text not null,

  status gym_seat_grant_status not null default 'pending',

  -- Pending TTL = 30 days (IDENTITY_MODEL §5.1). A pending grant past this is
  -- reported/updated to 'expired'; the owner must reissue.
  expires_at timestamptz not null,

  -- The bound account, set at claim. PRIVATE — never crosses the seam.
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,

  -- Mirrors the current consent decision for the poll (durable record lives in
  -- member_consents). not_yet until claimed.
  consent gym_seat_consent not null default 'not_yet',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gym_seat_grants_gym_idx on gym_seat_grants(gym_id);
-- Serves the status poll (per-gym token lookups) and a future TTL reaper.
create index if not exists gym_seat_grants_status_idx on gym_seat_grants(status, expires_at);
create index if not exists gym_seat_grants_claimed_user_idx
  on gym_seat_grants(claimed_user_id) where claimed_user_id is not null;

comment on table gym_seat_grants is
  'Private token→grant→account registry (identity model Phase 2). Affiliate holds only the token; claim binds a gym_grant entitlement to the member''s account.';

-- Service-role only. The edge functions (gym-seat-grant s2s, gym-seat-claim member
-- JWT) use the service role; members never read this table directly.
alter table gym_seat_grants enable row level security;
-- (No policies: RLS on with no policy = deny to anon/authenticated; service role bypasses.)

-- =============================================================================
-- member_consents.status — explicit granted|declined (was presence=granted only).
-- Additive, default 'granted' so existing engine-join rows stay valid.
-- =============================================================================
alter table member_consents
  add column if not exists status text not null default 'granted'
    check (status in ('granted', 'declined'));

comment on column member_consents.status is
  'granted | declined. Default granted (back-compat: pre-existing rows were presence=granted). Set explicitly by the token claim flow (identity model §6).';

notify pgrst, 'reload schema';

commit;
