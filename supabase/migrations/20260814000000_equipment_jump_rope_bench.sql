-- Add jump_rope + bench to the canonical equipment keys — backfill existing
-- reviewed records.
--
-- Hydration semantics (hydrateEquipment, tier-status.ts): a NON-empty
-- equipment record is authoritative, and keys absent from it hydrate to
-- false. Adding new canonical keys without this backfill would therefore
-- silently strip double-unders and bench press from every athlete who has
-- already completed the equipment review. Backfill them as owned — the same
-- checked-by-default assumption the review form makes.
--
-- EMPTY records are deliberately untouched: they mark the review as pending
-- and hydrate all-true (now including the new keys) on their own.
--
-- Idempotent: only adds keys that are absent, so re-running is a no-op.

UPDATE athlete_profiles
SET equipment = equipment || '{"jump_rope": true}'::jsonb
WHERE equipment IS NOT NULL
  AND equipment != '{}'::jsonb
  AND NOT (equipment ? 'jump_rope');

UPDATE athlete_profiles
SET equipment = equipment || '{"bench": true}'::jsonb
WHERE equipment IS NOT NULL
  AND equipment != '{}'::jsonb
  AND NOT (equipment ? 'bench');
