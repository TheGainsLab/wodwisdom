-- Engine day types: structured guidance for the sequencer (founder-approved
-- 2026-11-10; spec in docs/engine_day_type_guidance_draft.md).
--
--   class         'develop' (a training stimulus the sequencer may prescribe
--                 to move a weakness, repeat, and dose) or 'assess' (a readout:
--                 never prescribed to fix a gap, never softened).
--   trains        energy systems / qualities the day loads. Codes: AB aerobic
--                 base, AP aerobic power, LT lactate threshold, GL glycolytic,
--                 PH phosphagen, DEN density, DUR durability, PAC pacing,
--                 PSY psychological, INT integration.
--   prerequisites day-type ids that must be DEMONSTRATED first — completed
--                 twice (any ratio), rolled up across modalities. Tier-1 types
--                 have none, so month one (the assessment month) is unaffected.
--
-- Readiness, not the calendar, gates which types the sequencer may use (the
-- month-based pool in run-resequence is replaced in a follow-up). The monthly
-- time trial stays pinned to day one of every month regardless.
--
-- Also: rocket_races_b's coaching_intent was a verbatim copy of A's; rewritten.
-- is_support_day is dropped — a relic flipped by hand on `ascending`, undefined,
-- read by nothing that mattered.

alter table public.engine_day_types
  add column if not exists class text not null default 'develop'
    check (class in ('develop', 'assess')),
  add column if not exists trains text[] not null default '{}'::text[],
  add column if not exists prerequisites text[] not null default '{}'::text[];

update public.engine_day_types as d set class = v.class, trains = v.trains, prerequisites = v.prereqs
from (values
  ('time_trial',        'assess',  array['AB','AP'],            array[]::text[]),
  ('endurance',         'develop', array['AB'],                 array[]::text[]),
  ('max_aerobic_power', 'develop', array['AP'],                 array[]::text[]),
  ('threshold',         'develop', array['LT'],                 array[]::text[]),
  ('anaerobic',         'develop', array['GL'],                 array[]::text[]),
  ('interval',          'develop', array['AP','LT','GL'],       array[]::text[]),
  ('polarized',         'develop', array['AB','PH'],            array[]::text[]),
  ('flux',              'develop', array['LT','AB','DEN'],      array['endurance','threshold']),
  ('flux_stages',       'develop', array['LT','DUR','PSY'],     array['flux','threshold']),
  ('ascending',         'develop', array['AP','GL','PAC'],      array['anaerobic']),
  ('rocket_races_a',    'develop', array['PAC'],                array['max_aerobic_power']),
  ('rocket_races_b',    'assess',  array['PAC'],                array['rocket_races_a']),
  ('hybrid_aerobic',    'develop', array['AP','DUR','DEN'],     array['max_aerobic_power','flux']),
  ('hybrid_anaerobic',  'develop', array['GL','DUR'],           array['anaerobic']),
  ('devour',            'develop', array['AB','LT','DUR'],      array['anaerobic','max_aerobic_power']),
  ('ascending_devour',  'develop', array['AB','LT','DUR'],      array['devour','ascending']),
  ('descending_devour', 'develop', array['AB','DEN'],           array['devour']),
  ('towers',            'develop', array['AB','AP','DUR'],      array['devour','max_aerobic_power']),
  ('atomic',            'develop', array['PH','AP'],            array['max_aerobic_power','polarized']),
  ('infinity',          'assess',  array['INT','PAC','PSY'],    array['hybrid_aerobic','devour','flux_stages']),
  ('afterburner',       'assess',  array['GL','AP','INT','PSY'],array['anaerobic','towers']),
  ('synthesis',         'assess',  array['INT'],                array['endurance','max_aerobic_power','threshold','anaerobic','interval','polarized','flux','flux_stages','ascending','rocket_races_a','hybrid_aerobic','hybrid_anaerobic','devour','ascending_devour','descending_devour','towers','atomic'])
) as v(id, class, trains, prereqs)
where d.id = v.id;

-- Every prerequisite must name a real day type.
do $$
declare bad text;
begin
  select string_agg(d.id || ' -> ' || p, ', ') into bad
  from public.engine_day_types d, unnest(d.prerequisites) as p
  where not exists (select 1 from public.engine_day_types x where x.id = p);
  if bad is not null then raise exception 'engine_day_types.prerequisites references unknown types: %', bad; end if;
end $$;

update public.engine_day_types set coaching_intent =
  'Structure: The same intervals as Rocket Races A, re-raced at tighter rest' || E'\n' ||
  'Primary Stimulus: Pacing control with less recovery' || E'\n' ||
  'Primary Adaptations: None (consistency check)' || E'\n' ||
  'System Role: Readout of pacing repeatability. Always paired with Rocket Races A in the same week; rounds, work and pace inherit from A, only the rest changes.'
where id = 'rocket_races_b';

alter table public.engine_day_types drop column if exists is_support_day;
