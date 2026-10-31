-- Workout Signatures — the measured layer (phase 1 outputs, swept 2026-10-31).
--
-- Three small reference tables holding what the competition-service data
-- measured over ~10.6M general-population Open results. The signature-workout
-- function joins them into every draft and measure call, so drafts cite
-- measurements instead of judgment:
--
--   signature_duration_curve — median relative IQR (p75-p25)/p50 by observed
--     duration bin, split by scoring type. U-shaped: sprints separate hardest,
--     10-16 min is the compression valley, genuine re-spread past 16 min.
--     Open, general segment only (QF bins were too small/unstable to keep).
--
--   signature_gate_catalog — per workout, the single score where the largest
--     share of the field piled up. Pile positions decode to named walls
--     (20.5 F: rep 200 = the ring-MU boundary, 72% of the field). A pile is
--     EVIDENCE (high discrimination); whether it is also a gate is the
--     editorial mechanism call (unlock wall vs load cliff — 13.1's pile at
--     the 165lb bar is discrimination, never a gate).
--
--   signature_censoring — fraction of the field that never finished (capped),
--     validated against is_finisher ground truth (22.3 M: 77.6% to the
--     decimal). Only workouts >15% censored are listed: absence = mildly or
--     un-censored. observed_median_s carries one known upstream data-quality
--     bug (17.3) — trust capped_frac over it.
--
-- Data is a snapshot by design (Open history is append-only, one new season
-- per year); refresh = re-run the phase-1 sweep and reseed.

create table if not exists public.signature_duration_curve (
  competition_type text not null,
  rep_scored boolean not null,
  bin_min_s integer not null,
  bin_max_s integer not null,
  workouts integer not null,
  median_rel_iqr numeric not null,
  measured_at date not null default '2026-10-31',
  primary key (competition_type, rep_scored, bin_min_s)
);

create table if not exists public.signature_gate_catalog (
  workout_name text not null,
  year integer not null,
  gender text not null check (gender in ('M','F')),
  pile_at_score numeric not null,
  pile_share numeric not null,
  n_total integer not null,
  time_cap_seconds integer,
  measured_at date not null default '2026-10-31',
  primary key (workout_name, year, gender)
);

create table if not exists public.signature_censoring (
  workout_name text not null,
  year integer not null,
  gender text not null check (gender in ('M','F')),
  competition_type text not null,
  time_cap_seconds integer,
  observed_median_s integer,
  capped_frac numeric not null,
  n integer not null,
  measured_at date not null default '2026-10-31',
  primary key (workout_name, year, gender)
);

alter table public.signature_duration_curve enable row level security;
alter table public.signature_gate_catalog enable row level security;
alter table public.signature_censoring enable row level security;
-- No policies: read through the signature-workout function (service role).

insert into public.signature_duration_curve
  (competition_type, rep_scored, bin_min_s, bin_max_s, workouts, median_rel_iqr) values
  ('open', false, 348, 366, 3, 0.6491),
  ('open', false, 403, 573, 6, 0.5592),
  ('open', false, 640, 720, 4, 0.2718),
  ('open', false, 806, 941, 9, 0.2438),
  ('open', false, 1042, 1163, 8, 0.5145),
  ('open', true, 240, 300, 4, 0.8095),
  ('open', true, 420, 595, 23, 0.3760),
  ('open', true, 600, 794, 29, 0.3198),
  ('open', true, 800, 997, 25, 0.2958),
  ('open', true, 1017, 1163, 11, 0.4887),
  ('open', true, 1200, 1200, 12, 0.4212)
on conflict do nothing;

insert into public.signature_gate_catalog
  (workout_name, year, gender, pile_at_score, pile_share, n_total, time_cap_seconds) values
  ('20.5', 2020, 'F', 200, 0.722, 52948, 1200),
  ('19.4', 2019, 'F', 66, 0.637, 75592, 720),
  ('16.3', 2016, 'F', 10, 0.568, 57170, 420),
  ('18.3', 2018, 'F', 220, 0.522, 77806, 840),
  ('17.2', 2017, 'F', 78, 0.507, 75820, 720),
  ('19.3', 2019, 'F', 90, 0.483, 81073, 600),
  ('26.2', 2026, 'F', 112, 0.398, 59229, 900),
  ('12.2', 2012, 'F', 60, 0.324, 13634, 600),
  ('20.5', 2020, 'M', 200, 0.304, 85483, 1200),
  ('26.2', 2026, 'M', 112, 0.284, 90826, 900),
  ('22.3', 2022, 'F', 156, 0.283, 58368, 720),
  ('12.4', 2012, 'F', 240, 0.277, 12803, 720),
  ('25.2', 2025, 'F', 156, 0.269, 49757, 720),
  ('21.3', 2021, 'F', 135, 0.244, 52722, 900),
  ('18.4', 2018, 'F', 21, 0.239, 78535, 540),
  ('13.3', 2013, 'F', 240, 0.238, 30456, 720),
  ('17.2', 2017, 'M', 78, 0.229, 142980, 720),
  ('23.1', 2023, 'F', 180, 0.229, 71176, 840),
  ('24.3', 2024, 'F', 107, 0.224, 69304, 900),
  ('23.1', 2023, 'M', 180, 0.224, 124847, 840),
  ('19.4', 2019, 'M', 66, 0.219, 127853, 720),
  ('20.4', 2020, 'F', 160, 0.219, 55570, 1200),
  ('20.3', 2020, 'F', 21, 0.209, 47123, 540),
  ('18.3', 2018, 'M', 220, 0.204, 134248, 840),
  ('13.5', 2013, 'F', 15, 0.200, 27827, 240),
  ('14.2', 2014, 'F', 10, 0.199, 48168, 0),
  ('14.4', 2014, 'M', 180, 0.199, 70624, 840),
  ('12.2', 2012, 'M', 60, 0.189, 23762, 600),
  ('13.1', 2013, 'M', 100, 0.185, 50931, 1020),
  ('17.3', 2017, 'F', 43, 0.184, 56608, 1440),
  ('20.4', 2020, 'M', 160, 0.184, 88506, 1200),
  ('13.1', 2013, 'F', 150, 0.179, 32130, 1020),
  ('17.4', 2017, 'F', 165, 0.179, 77720, 780),
  ('15.2', 2015, 'F', 10, 0.174, 53356, 0),
  ('16.4', 2016, 'F', 165, 0.159, 58173, 780),
  ('12.5', 2012, 'F', 3, 0.155, 12803, 420),
  ('18.2a', 2018, 'F', 0, 0.154, 126891, 720),
  ('16.3', 2016, 'M', 10, 0.154, 107095, 420),
  ('23.3', 2023, 'F', 125, 0.149, 65828, 900),
  ('21.3', 2021, 'M', 135, 0.149, 85054, 900),
  ('19.3', 2019, 'M', 90, 0.144, 133977, 600),
  ('14.4', 2014, 'F', 180, 0.144, 44985, 840),
  ('17.3', 2017, 'M', 43, 0.139, 128424, 1440),
  ('12.4', 2012, 'M', 240, 0.139, 22187, 720),
  ('13.3', 2013, 'M', 240, 0.124, 48137, 720),
  ('18.2a', 2018, 'M', 0, 0.119, 185244, 720),
  ('22.3', 2022, 'M', 156, 0.114, 98947, 720),
  ('19.5', 2019, 'F', 33, 0.110, 62760, 1200),
  ('23.3', 2023, 'M', 125, 0.110, 108446, 900),
  ('24.3', 2024, 'M', 107, 0.109, 117957, 900),
  ('25.2', 2025, 'M', 156, 0.109, 84217, 720),
  ('17.4', 2017, 'M', 165, 0.100, 131640, 780),
  ('18.5', 2018, 'F', 3, 0.095, 78222, 420),
  ('15.1a', 2015, 'F', 125, 0.095, 53361, 360),
  ('16.4', 2016, 'M', 165, 0.095, 101032, 780),
  ('15.4', 2015, 'F', 3, 0.090, 28894, 480),
  ('15.1a', 2015, 'M', 205, 0.090, 110571, 360),
  ('15.3', 2015, 'F', 1, 0.081, 11703, 840),
  ('14.3', 2014, 'F', 90, 0.080, 46985, 480),
  ('19.2', 2019, 'M', 165, 0.075, 124098, 1200)
on conflict do nothing;

insert into public.signature_censoring
  (workout_name, year, gender, competition_type, time_cap_seconds, observed_median_s, capped_frac, n) values
  ('18.3', 2018, 'F', 'open', 840, 840, 1.000, 77806),
  ('18.3', 2018, 'M', 'open', 840, 840, 0.995, 134248),
  ('26.1', 2026, 'M', 'open', 720, 720, 0.995, 102246),
  ('19.3', 2019, 'M', 'open', 600, 575, 0.995, 133977),
  ('19.3', 2019, 'F', 'open', 600, 559, 0.995, 81073),
  ('18.4', 2018, 'M', 'open', 540, 540, 0.995, 137391),
  ('17.3', 2017, 'F', 'open', 1440, 358, 0.995, 56608),
  ('17.3', 2017, 'M', 'open', 1440, 366, 0.995, 128424),
  ('20.4', 2020, 'M', 'open', 1200, 890, 0.995, 88506),
  ('26.3', 2026, 'M', 'open', 960, 960, 0.995, 91191),
  ('18.4', 2018, 'F', 'open', 540, 540, 0.995, 78535),
  ('19.2', 2019, 'M', 'open', 1200, 1163, 0.995, 124098),
  ('26.3', 2026, 'F', 'open', 960, 960, 0.995, 67510),
  ('19.2', 2019, 'F', 'open', 1200, 1134, 0.995, 68266),
  ('26.1', 2026, 'F', 'open', 720, 702, 0.995, 70933),
  ('23.3', 2023, 'F', 'open', 900, 668, 0.990, 65828),
  ('20.3', 2020, 'M', 'open', 540, 403, 0.990, 84781),
  ('22.2', 2022, 'F', 'open', 600, 600, 0.990, 78125),
  ('21.1', 2021, 'F', 'open', 900, 860, 0.990, 58333),
  ('23.3', 2023, 'M', 'open', 900, 681, 0.990, 108446),
  ('20.3', 2020, 'F', 'open', 540, 348, 0.990, 47123),
  ('20.4', 2020, 'F', 'open', 1200, 834, 0.990, 55570),
  ('21.1', 2021, 'M', 'open', 900, 900, 0.985, 94667),
  ('19.4', 2019, 'F', 'open', 720, 720, 0.985, 75592),
  ('22.2', 2022, 'M', 'open', 600, 600, 0.980, 115563),
  ('24.3', 2024, 'F', 'open', 900, 900, 0.970, 69304),
  ('20.5', 2020, 'F', 'open', 1200, 896, 0.970, 52948),
  ('Event 2', 2021, 'F', 'quarterfinals', 1200, 1130, 0.961, 5517),
  ('26.2', 2026, 'F', 'open', 900, 900, 0.960, 59229),
  ('Event 3', 2024, 'F', 'quarterfinals', 900, 766, 0.946, 13442),
  ('19.4', 2019, 'M', 'open', 720, 685, 0.945, 127853),
  ('21.3', 2021, 'F', 'open', 900, 800, 0.945, 52722),
  ('24.3', 2024, 'M', 'open', 900, 816, 0.940, 117957),
  ('Event 2', 2021, 'M', 'quarterfinals', 1200, 1137, 0.931, 7339),
  ('Event 2', 2024, 'F', 'quarterfinals', 1200, 1149, 0.931, 13788),
  ('Event 2', 2024, 'M', 'quarterfinals', 1200, 1149, 0.901, 16639),
  ('22.3', 2022, 'F', 'open', 720, 601, 0.876, 58368),
  ('26.2', 2026, 'M', 'open', 900, 748, 0.871, 90826),
  ('25.2', 2025, 'F', 'open', 720, 591, 0.871, 49757),
  ('Event 1', 2023, 'F', 'quarterfinals', 900, 738, 0.871, 5253),
  ('21.3', 2021, 'M', 'open', 900, 794, 0.866, 85054),
  ('19.5', 2019, 'F', 'open', 1200, 1051, 0.851, 62760),
  ('20.1', 2020, 'F', 'open', 900, 900, 0.841, 65683),
  ('Event 1', 2021, 'F', 'quarterfinals', 600, 534, 0.814, 5299),
  ('20.5', 2020, 'M', 'open', 1200, 941, 0.811, 85483),
  ('Event 3', 2024, 'M', 'quarterfinals', 900, 754, 0.808, 16210),
  ('Event 2', 2022, 'F', 'quarterfinals', 900, 745, 0.804, 4893),
  ('Event 3', 2023, 'F', 'quarterfinals', 600, 480, 0.800, 5329),
  ('20.1', 2020, 'M', 'open', 900, 900, 0.796, 105362),
  ('Event 3', 2023, 'M', 'quarterfinals', 600, 494, 0.794, 7211),
  ('25.2', 2025, 'M', 'open', 720, 595, 0.786, 84217),
  ('22.3', 2022, 'M', 'open', 720, 595, 0.776, 98947),
  ('19.5', 2019, 'M', 'open', 1200, 1044, 0.771, 114806),
  ('25.3', 2025, 'F', 'open', 1200, 1089, 0.732, 53519),
  ('Event 5', 2022, 'F', 'quarterfinals', 420, 331, 0.720, 4762),
  ('Event 2', 2026, 'F', 'quarterfinals', 900, 743, 0.679, 10016),
  ('Event 1', 2023, 'M', 'quarterfinals', 900, 738, 0.658, 7361),
  ('Event 5', 2021, 'F', 'quarterfinals', 420, 305, 0.652, 3513),
  ('Event 1', 2021, 'M', 'quarterfinals', 600, 534, 0.629, 7483),
  ('25.3', 2025, 'M', 'open', 1200, 1064, 0.617, 83235)
on conflict do nothing;
