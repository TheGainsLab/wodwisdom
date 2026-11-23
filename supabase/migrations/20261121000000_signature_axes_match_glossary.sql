-- signature_axes: bring the display definitions into line with the drafting
-- glossary (AXES_GLOSSARY in _shared/signature-draft-core.ts), the only copy
-- the signature judge reads. Display-only: no edge function reads these
-- definitions, so no stored signature changes meaning.
--
-- Four placements disagreed (review 2026-11-21):
--   rope climbs       skill_coordination  -> gymnastics_pulling
--   handstand walks   gymnastics_pressing -> skill_coordination
--   pistol volume     skill_coordination  -> squat_cycling
--   barbell cleans    posterior_chain     -> olympic_lifting (any load)
--
-- Wording is "home axis; also loaded by" — never a fixed primary/secondary
-- split, because the share each movement gives an axis is set per workout.

update public.signature_axes set definition =
  'Snatch and clean & jerk: speed-strength, receiving positions, barbell cycling. Home axis of every barbell snatch and clean variant at any load'
  where axis = 'olympic_lifting';

update public.signature_axes set definition =
  'Hinge-pattern capacity under volume: deadlifts, swings, hip extension, pulling endurance. Also loaded by the pull of dumbbell and kettlebell snatches and cleans'
  where axis = 'posterior_chain';

update public.signature_axes set definition =
  'Bodyweight pulling: pull-ups, chest-to-bar, toes-to-bar, rope climbs, bar/ring muscle-ups — skill and capacity under fatigue'
  where axis = 'gymnastics_pulling';

update public.signature_axes set definition =
  'Inverted/pressing gymnastics: HSPU, wall walks, handstand holds, ring dips. Also loaded by the dip of ring muscle-ups'
  where axis = 'gymnastics_pressing';

update public.signature_axes set definition =
  'Rhythm/coordination skills: double-unders, handstand walks — possession and cycling. Also loaded by the muscle-up transition'
  where axis = 'skill_coordination';

update public.signature_axes set definition =
  'High-rep squat capacity under fatigue: wall balls, light thrusters, lunge and pistol volume (leg muscular endurance, not maximal strength)'
  where axis = 'squat_cycling';
