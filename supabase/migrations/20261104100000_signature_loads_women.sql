-- Women's RX loads for the Open signature library (engine fix #1 from
-- acceptance audit run 2, 2026-11-04). The signature prescriptions carry
-- the MEN'S loads only, and toWorkCalcMovement fed that single weight
-- into both gender slots — so the women's field was modeled lifting
-- men's bars, which is the near-certain cause of the women's-ladder
-- underprediction family (11.6 W predicted 28 reps vs observed 73 at a
-- 100 lb thruster that is really 65).
--
-- WHY A SIBLING COLUMN, not the workout jsonb: workout_hash is the
-- strict canonical-JSON identity governing provenance staleness, and a
-- direct jsonb edit would silently desync it. loads_women maps movement
-- INDEX (as a string key, matching the movements array position) to the
-- women's pounds; the engine merges it in-memory before measuring.
--
-- FOUNDER REVIEW REQUIRED on the values: this is editorial data entry
-- from Open history. Flagged as lower-confidence: 23.3 final snatch
-- (155), 25.3 (clean 85 / snatch 65), 26.1/26.2 (standard 14 lb ball /
-- 35 lb dumbbell assumed). 26.3 is left NULL — loads unknown here; fill
-- with the women's clean/thruster ladder when confirmed. A wrong value
-- is a one-line UPDATE to fix and an engine_version-stale rescore.

alter table public.workout_signatures
  add column if not exists loads_women jsonb;

comment on column public.workout_signatures.loads_women is
  'Women''s RX loads by movement index (string key -> lbs). Sibling to workout jsonb so workout_hash identity never desyncs. Merged in-memory by the measurement engine.';

update public.workout_signatures set loads_women = '{"1": 55}'::jsonb where name = '11.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 100}'::jsonb where name = '11.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 110, "1": 110}'::jsonb where name = '11.3' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 90}'::jsonb where name = '11.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 100, "2": 14}'::jsonb where name = '11.5' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '11.6' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 45, "1": 75, "2": 100, "3": 120}'::jsonb where name = '12.2' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 75}'::jsonb where name = '12.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 14}'::jsonb where name = '12.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '12.5' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 45, "2": 75, "3": 100, "4": 120}'::jsonb where name = '13.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 75, "1": 75}'::jsonb where name = '13.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 14}'::jsonb where name = '13.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 95}'::jsonb where name = '13.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '13.5' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 55}'::jsonb where name = '14.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '14.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 95, "2": 135, "4": 155, "6": 185, "8": 205, "10": 225}'::jsonb where name = '14.3' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 14, "3": 95}'::jsonb where name = '14.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '14.5' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 75, "2": 75}'::jsonb where name = '15.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '15.2' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 14}'::jsonb where name = '15.3' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 125}'::jsonb where name = '15.4' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 65}'::jsonb where name = '15.5' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65, "2": 65}'::jsonb where name = '16.1' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 85, "5": 115, "8": 145, "11": 175, "14": 205}'::jsonb where name = '16.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 55}'::jsonb where name = '16.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 155, "1": 14}'::jsonb where name = '16.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '16.5' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35}'::jsonb where name = '17.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35, "2": 35}'::jsonb where name = '17.2' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 65, "2": 95, "3": 135, "4": 155, "5": 175, "6": 185}'::jsonb where name = '17.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 155, "1": 14}'::jsonb where name = '17.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '17.5' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 35}'::jsonb where name = '18.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35}'::jsonb where name = '18.2' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 80, "3": 35}'::jsonb where name = '18.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '18.5' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 85, "5": 115, "8": 145, "11": 175, "14": 205}'::jsonb where name = '19.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35, "1": 35}'::jsonb where name = '19.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '19.4' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '19.5' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65}'::jsonb where name = '20.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35}'::jsonb where name = '20.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 155, "2": 205}'::jsonb where name = '20.3' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 65, "3": 85, "5": 115, "7": 145, "9": 175, "11": 205}'::jsonb where name = '20.4' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 14}'::jsonb where name = '20.5' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35}'::jsonb where name = '21.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65, "2": 65}'::jsonb where name = '21.3' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 35}'::jsonb where name = '22.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 155}'::jsonb where name = '22.2' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 65, "5": 75, "8": 85}'::jsonb where name = '22.3' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 14, "3": 95}'::jsonb where name = '23.1' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 65, "5": 95, "8": 125, "11": 155}'::jsonb where name = '23.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35, "2": 35}'::jsonb where name = '24.1' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 125}'::jsonb where name = '24.2' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 65, "2": 85}'::jsonb where name = '24.3' and source = 'open';
update public.workout_signatures set loads_women = '{"1": 35, "2": 35}'::jsonb where name = '25.1' and source = 'open';
update public.workout_signatures set loads_women = '{"2": 65, "5": 75, "8": 85}'::jsonb where name = '25.2' and source = 'open';
update public.workout_signatures set loads_women = '{"3": 155, "5": 85, "7": 65}'::jsonb where name = '25.3' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 14, "2": 14}'::jsonb where name = '26.1' and source = 'open';
update public.workout_signatures set loads_women = '{"0": 35, "1": 35, "3": 35, "4": 35, "6": 35, "7": 35}'::jsonb where name = '26.2' and source = 'open';
