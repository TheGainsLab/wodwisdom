-- Workout Signatures — the athlete layer (build phase item 1 foundations,
-- 2026-11-02). Four structures from the universal-language decision
-- (design doc, 2026-10-31), created now that the validation campaign closed:
--
--   signature_axes             — the 12 development axes as reference data
--                                (definition, dose unit, engine-vs-strength
--                                class) so prompts, UI and audits read ONE
--                                source instead of re-declaring the list.
--   signature_evidence         — the evidence ledger: one row per
--                                (athlete, workout, score) observation that
--                                feeds a profile. Profiles are summaries;
--                                THESE rows are the source of truth, so any
--                                model improvement refits every athlete from
--                                raw evidence (nothing is stranded on an old
--                                model's conclusions).
--   athlete_capability_vectors — the current fitted profile: per-athlete,
--                                per-axis posterior (mean, sd, in both
--                                percentile and z units) + provenance.
--                                Always recomputable from the ledger.
--   athlete_gate_possession    — binary skill switches (muscle-up: yes/no),
--                                kept OUTSIDE the continuous axes per the
--                                gate doctrine: a wall-stuck score updates
--                                the switch, never the dials.
--   signature_model_params     — versioned fitted parameters of the profile
--                                model (prior covariance, loading matrix,
--                                noise, calibration constant, evidence-age
--                                weights), seeded from the 2026-11-02
--                                validation campaign (30k athletes, fresh-
--                                sample replicated). The fit function reads
--                                these; changing the model = inserting a new
--                                params row, never editing code constants.

-- ------------------------------------------------------------------
-- 1. The axes as reference data
-- ------------------------------------------------------------------
create table if not exists public.signature_axes (
  axis text primary key,
  class text not null check (class in ('strength', 'gymnastics_skill', 'conditioning')),
  dose_unit text not null check (dose_unit in ('minutes', 'tonnage')),
  definition text not null
);

insert into public.signature_axes (axis, class, dose_unit, definition) values
  ('olympic_lifting',          'strength',        'tonnage', 'Snatch and clean & jerk: speed-strength, receiving positions, barbell cycling at moderate-heavy loads'),
  ('powerlifting_strength',    'strength',        'tonnage', 'Maximal slow-lift strength: heavy squats, deadlifts, presses near limit loads'),
  ('posterior_chain',          'strength',        'tonnage', 'Hinge-pattern capacity under volume: deadlifts, swings, cleans off the floor, pulling endurance'),
  ('upper_body_pressing',      'strength',        'tonnage', 'Horizontal/vertical pressing capacity: push-ups, presses, jerks, dips under fatigue'),
  ('gymnastics_pulling',       'gymnastics_skill','minutes', 'Bodyweight pulling: pull-ups, chest-to-bar, toes-to-bar, bar/ring muscle-ups — skill and capacity under fatigue'),
  ('gymnastics_pressing',      'gymnastics_skill','minutes', 'Inverted/pressing gymnastics: HSPU, handstand walks, wall walks, ring dips'),
  ('midline',                  'gymnastics_skill','minutes', 'Trunk flexion/stabilization capacity: GHD, L-sits, high-rep core under fatigue'),
  ('skill_coordination',       'gymnastics_skill','minutes', 'Rhythm/coordination skills: double-unders, pistols, rope climbs — possession and cycling'),
  ('squat_cycling',            'conditioning',    'minutes', 'High-rep squat capacity under fatigue: wall balls, light thrusters, lunge volume (leg muscular endurance, not maximal strength)'),
  ('aerobic_capacity',         'conditioning',    'minutes', 'Sustained-pace engine: long time domains, monostructural volume, pacing'),
  ('anaerobic_capacity',       'conditioning',    'minutes', 'Repeated high-power output: sprints, short pain-cave efforts, recovery between surges'),
  ('mixed_modal_conditioning', 'conditioning',    'minutes', 'Transition economy across mixed implements: chippers, odd objects, grip/posture switching')
on conflict (axis) do nothing;

-- ------------------------------------------------------------------
-- 2. The evidence ledger
-- ------------------------------------------------------------------
create table if not exists public.signature_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The workout's identity (content hash of the canonical structure — the
  -- universal join key) and, when it is in the library, its signature row.
  workout_hash text not null,
  workout_signature_id uuid references public.workout_signatures(id),

  -- What was observed. score_raw is the result as performed (reps/time/load);
  -- percentile and z are the field-relative placements the fit consumes.
  -- A structure-estimated percentile (score-scale model) carries wider
  -- obs_noise_var than a leaderboard one — the acceptance protocol's error
  -- lands HERE, per observation, feeding calibration instead of sitting
  -- beside it.
  score_raw jsonb not null,
  percentile numeric check (percentile >= 0 and percentile <= 100),
  z numeric,
  obs_noise_var numeric,

  source text not null check (source in
    ('open_linked', 'logged_class', 'logged_solo', 'benchmark', 'intake_declaration')),
  signature_version text,
  cohort text not null default 'open_rx_general',
  performed_at date not null,
  created_at timestamptz not null default now()
);

create index if not exists signature_evidence_user_idx
  on public.signature_evidence (user_id, performed_at desc);
create index if not exists signature_evidence_hash_idx
  on public.signature_evidence (workout_hash);

alter table public.signature_evidence enable row level security;
create policy signature_evidence_select_own on public.signature_evidence
  for select using (user_id = auth.uid());

-- ------------------------------------------------------------------
-- 3. The capability vectors (current fitted profile — always recomputable)
-- ------------------------------------------------------------------
create table if not exists public.athlete_capability_vectors (
  user_id uuid not null references auth.users(id) on delete cascade,
  axis text not null references public.signature_axes(axis),

  -- Posterior over the athlete's deviation-from-own-level on this axis.
  -- RELATIVE dial, never absolute ability (factor doctrine 2026-11-02):
  -- display copy must not let a negative value read as weak-in-absolute.
  mean_pct numeric not null,
  sd_pct numeric not null,
  mean_z numeric,
  sd_z numeric,

  n_evidence integer not null default 0,
  source_mix jsonb not null default '{}'::jsonb,
  model_params_key text not null,
  fitted_at timestamptz not null default now(),
  primary key (user_id, axis)
);

alter table public.athlete_capability_vectors enable row level security;
create policy acv_select_own on public.athlete_capability_vectors
  for select using (user_id = auth.uid());

-- ------------------------------------------------------------------
-- 4. Gate possession — the switches, outside the dials
-- ------------------------------------------------------------------
create table if not exists public.athlete_gate_possession (
  user_id uuid not null references auth.users(id) on delete cascade,
  movement text not null,
  status text not null check (status in ('has', 'lacks', 'unknown')),
  -- how we know: athlete said so, or the evidence showed it
  source text not null check (source in
    ('intake_declaration', 'crossed_wall', 'stuck_at_wall', 'logged_rep')),
  observed_at date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, movement)
);

alter table public.athlete_gate_possession enable row level security;
create policy agp_select_own on public.athlete_gate_possession
  for select using (user_id = auth.uid());

-- ------------------------------------------------------------------
-- 5. Fitted model parameters, seeded from the validation campaign
-- ------------------------------------------------------------------
create table if not exists public.signature_model_params (
  key text primary key,
  params jsonb not null,
  notes text,
  created_at timestamptz not null default now()
);

insert into public.signature_model_params (key, params, notes) values (
  'open_rx_general_v1',
  '{"axes":["aerobic_capacity","anaerobic_capacity","gymnastics_pressing","gymnastics_pulling","midline","mixed_modal_conditioning","olympic_lifting","posterior_chain","powerlifting_strength","skill_coordination","squat_cycling","upper_body_pressing"],"prior_cov_pct":[[222.97,17.789,-57.003,-163.909,-4.628,27.469,-6.256,17.852,-31.275,-48.907,17.889,8.455],[17.789,120.154,16.047,-22.023,5.211,22.783,-41.159,2.833,-34.581,-17.396,-28.639,-5.885],[-57.003,16.047,226.892,30.66,5.303,-2.644,-67.362,-20.197,-39.624,48.149,-18.476,-22.195],[-163.909,-22.023,30.66,411.829,14.451,-12.164,-76.513,-44.319,-117.959,15.059,-54.227,-44.097],[-4.628,5.211,5.303,14.451,30.248,0.627,-8.654,-9.276,-13.286,-0.689,-1.596,-1.275],[27.469,22.783,-2.644,-12.164,0.627,29.76,-11.807,-1.284,-21.231,-9.531,-9.31,-6.115],[-6.256,-41.159,-67.362,-76.513,-8.654,-11.807,189.07,14.815,64.774,-23.77,1.774,14.949],[17.852,2.833,-20.197,-44.319,-9.276,-1.284,14.815,98.628,14.072,-25.705,-22.342,3.553],[-31.275,-34.581,-39.624,-117.959,-13.286,-21.231,64.774,14.072,196.998,-28.794,24.013,26.828],[-48.907,-17.396,48.149,15.059,-0.689,-9.531,-23.77,-25.705,-28.794,176.382,1.656,-2.529],[17.889,-28.639,-18.476,-54.227,-1.596,-9.31,1.774,-22.342,24.013,1.656,95.038,16.52],[8.455,-5.885,-22.195,-44.097,-1.275,-6.115,14.949,3.553,26.828,-2.529,16.52,46.821]],"signal_cov_pct":[[62.539,14.602,-22.723,-84.264,-3.385,11.894,-8.815,9.344,-18.235,-24.232,5.546,4.962],[14.602,10.184,0.635,-17.849,2.056,6.32,-16.728,-0.899,-19.088,-9.182,-3.054,-1.099],[-22.723,0.635,47.41,6.171,1.098,-2.011,-27.889,-7.703,-18.411,19.178,-7.545,-7.054],[-84.264,-17.849,6.171,154.466,8.299,-10.146,-43.085,-29.125,-63.113,7.632,-23.064,-20.128],[-3.385,2.056,1.098,8.299,0.158,0.749,-5.442,-3.632,-6.143,1.316,-1.656,-1.808],[11.894,6.32,-2.011,-10.146,0.749,1.923,-4.912,1.158,-9.114,-4.092,-0.26,-0.604],[-8.815,-16.728,-27.889,-43.085,-5.442,-4.912,39.795,6.877,40.602,-10.935,-3.276,6.884],[9.344,-0.899,-7.703,-29.125,-3.632,1.158,6.877,5.812,2.743,-12.5,-3.481,1.924],[-18.235,-19.088,-18.411,-63.113,-6.143,-9.114,40.602,2.743,51.052,-11.751,5.322,8.384],[-24.232,-9.182,19.178,7.632,1.316,-4.092,-10.935,-12.5,-11.751,26.884,-3.523,-1.721],[5.546,-3.054,-7.545,-23.064,-1.656,-0.26,-3.276,-3.481,5.322,-3.523,4.676,4.301],[4.962,-1.099,-7.054,-20.128,-1.808,-0.604,6.884,1.924,8.384,-1.721,4.301,3.083]],"loading_matrix_pct":[[-5.937,5.736,-1.981,-0.652],[-0.712,3.143,-0.162,0.97],[2.413,1.689,6.125,1.92],[12.443,-1.042,-2.866,0.13],[0.767,0.406,-0.045,-0.138],[-0.631,1.625,-0.411,0.131],[-3.742,-5.033,-1.216,0.071],[-2.083,0.194,-0.597,1.423],[-4.663,-5.918,0.94,0.619],[1.941,-0.325,3.851,-3.12],[-1.476,0.15,0.11,-1.225],[-1.548,-0.47,-0.041,-0.726]],"factor_names":["puller_grinder","strength_engine","inversion_skill","coordination"],"noise_var_pct":99.0,"calibration_sd_inflation":1.349,"evidence_age_weight":{"0":1.0,"1":1.0,"2":0.98,"3":0.82,"4":0.73},"fitted_on":"open_rx_general_30k_2026-11-02","cohort":"open_rx_general"}'::jsonb,
  'Fitted 2026-11-02 on 30k Open RX athletes (two independent 15k samples; all headline numbers replicated on the second). prior_cov_pct: covariance of ridge axis-deltas, deep athletes, percentile units. signal_cov_pct: split-half cross-covariance (noise-cancelled). loading_matrix_pct: four varimax factors (puller_grinder 53%, strength_engine 24%, inversion_skill 15%, coordination 4%). noise_var_pct: per-score noise from verbatim-repeat test-retest (sd ~10). calibration_sd_inflation: predictive sd multiplier (raw posterior overconfident; after x1.349, 80% intervals cover 80.2-83.6% in every depth band). evidence_age_weight: forward-prediction retention by years of gap (year-holdout aging curve).'
)
on conflict (key) do nothing;

-- source_ref: stable identity of the observation's origin
-- ('log:<log_id>:<sort_order>', 'open:<year>:<workout>', 'benchmark:<id>')
-- so destructive re-logging (log-workout wipes and re-inserts blocks) and
-- backfills stay idempotent: ingest paths upsert on (user_id, source_ref).
alter table public.signature_evidence
  add column if not exists source_ref text;

-- Full (not partial) unique index: upsert's ON CONFLICT (user_id, source_ref)
-- must infer it, and NULL source_refs stay freely insertable (nulls are
-- distinct under a unique index).
create unique index if not exists signature_evidence_user_source_ref_key
  on public.signature_evidence (user_id, source_ref);
