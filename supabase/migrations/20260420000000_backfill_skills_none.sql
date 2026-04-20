-- Backfill missing skill keys as 'none' on every athlete_profiles row.
--
-- Context: Tier 2 profile completion requires all 19 skill keys to be
-- present in athlete_profiles.skills (any rating, including 'none').
-- Historically the client only wrote keys the user had explicitly tapped,
-- so users who scrolled past skills they don't do left those keys out of
-- the jsonb. Tier 2 never ticked off, blocking the free fitness eval.
--
-- The AthletePage UI always displayed 'None' as the selected state for
-- those unrated skills (via `skills[key] || 'none'`), so persisting
-- 'none' aligns the DB with what every user has already seen on screen.
-- No existing rating is touched — the `||` jsonb operator keeps the
-- right-hand (existing) value when a key exists on both sides.

UPDATE athlete_profiles
SET skills = jsonb_build_object(
  'muscle_ups',              'none',
  'bar_muscle_ups',          'none',
  'strict_ring_muscle_ups',  'none',
  'toes_to_bar',             'none',
  'strict_pull_ups',         'none',
  'kipping_pull_ups',        'none',
  'butterfly_pull_ups',      'none',
  'chest_to_bar_pull_ups',   'none',
  'rope_climbs',             'none',
  'legless_rope_climbs',     'none',
  'wall_facing_hspu',        'none',
  'hspu',                    'none',
  'strict_hspu',             'none',
  'deficit_hspu',            'none',
  'ring_dips',               'none',
  'l_sit',                   'none',
  'handstand_walk',          'none',
  'double_unders',           'none',
  'pistols',                 'none'
) || COALESCE(skills, '{}'::jsonb);
