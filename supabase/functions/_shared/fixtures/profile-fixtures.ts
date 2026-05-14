/**
 * profile-fixtures.ts
 *
 * Hand-crafted fake athlete profiles covering the cohort spread, used
 * to test the v2 payload assembler + audit functions without hitting
 * a real database.
 *
 * Each fixture provides:
 *   - profileRow: the shape buildWriterPayload reads from athlete_profiles
 *   - bundle: a structurally-valid Tier4Bundle, or null when unlinked
 *
 * The numbers are illustrative and explicitly NOT real-athlete data —
 * they're plausible test inputs spanning beginner → games-athlete,
 * different goals, different injury states, linked vs unlinked.
 */

import type { Tier4Bundle } from "../fetch-tier4-bundle.ts";

export interface FixtureProfileRow {
  age: number | null;
  height: number | null;
  bodyweight: number | null;
  gender: string | null;
  units: string | null;
  lifts: Record<string, unknown> | null;
  skills: Record<string, unknown> | null;
  conditioning: Record<string, unknown> | null;
  equipment: Record<string, unknown> | null;
  days_per_week: number | null;
  session_length_minutes: number | null;
  goal: string | null;
  injuries_constraints: string | null;
  self_perception_level: string | null;
  competition_athlete_id: string | null;
}

export interface ProfileFixture {
  name: string;
  description: string;
  profileRow: FixtureProfileRow;
  bundle: Tier4Bundle | null;
}

// ============================================================
// Fixture A — T2-only beginner male, fitness goal
// ============================================================

export const FIXTURE_BEGINNER_FITNESS: ProfileFixture = {
  name: "beginner_fitness",
  description: "New-ish male athlete, modest lifts, beginner skills, basic conditioning, no Tier 4 linkage. Goal: get fitter + lose weight.",
  profileRow: {
    age: 32,
    height: 70,
    bodyweight: 180,
    gender: "male",
    units: "lbs",
    lifts: {
      back_squat: 225,
      deadlift: 275,
      bench_press: 185,
      snatch: 95,
      clean_and_jerk: 135,
      // optional lifts unfilled
    },
    skills: {
      strict_pull_ups: "beginner",
      kipping_pull_ups: "beginner",
      butterfly_pull_ups: "none",
      chest_to_bar_pull_ups: "none",
      muscle_ups: "none",
      bar_muscle_ups: "none",
      strict_ring_muscle_ups: "none",
      toes_to_bar: "beginner",
      wall_facing_hspu: "none",
      hspu: "none",
      strict_hspu: "none",
      deficit_hspu: "none",
      handstand_walk: "none",
      rope_climbs: "beginner",
      legless_rope_climbs: "none",
      ring_dips: "beginner",
      l_sit: "beginner",
      double_unders: "beginner",
      pistols: "beginner",
    },
    conditioning: {
      "1_mile_run": "8:30",
      "5k_run": "28:00",
      "1k_row": "4:00",
      "2k_row": "8:00",
      "5k_row": "21:00",
      "1min_bike_cals": 18,
      "10min_bike_cals": 145,
    },
    equipment: {
      barbell: true,
      dumbbells: true,
      kettlebells: false,
      rower: true,
      assault_bike: false,
      ski_erg: false,
      treadmill: false,
      pull_up_bar: true,
      rings: false,
      rope: false,
      ghd: false,
      parallettes: false,
      pegboard: false,
      box: true,
      wall_ball: true,
      sled: false,
      blocks: false,
      bands: true,
    },
    days_per_week: 4,
    session_length_minutes: 60,
    goal: "Get in shape, lose 15 lbs, be able to do CrossFit workouts at my local box.",
    injuries_constraints: "None.",
    self_perception_level: "beginner",
    competition_athlete_id: null,
  },
  bundle: null,
};

// ============================================================
// Fixture B — T2-only intermediate female, competitor goal
// ============================================================

export const FIXTURE_INTERMEDIATE_COMPETITOR: ProfileFixture = {
  name: "intermediate_competitor",
  description: "Female athlete with solid intermediate lifts, mixed skills, moderate-strong conditioning. Goal: make Quarterfinals. No T4 yet.",
  profileRow: {
    age: 28,
    height: 65,
    bodyweight: 145,
    gender: "female",
    units: "lbs",
    lifts: {
      back_squat: 215,
      front_squat: 185,
      overhead_squat: 145,
      deadlift: 275,
      bench_press: 145,
      snatch: 130,
      power_snatch: 115,
      clean: 165,
      clean_and_jerk: 175,
      jerk: 175,
      power_clean: 145,
      push_jerk: 165,
      press: 95,
      push_press: 125,
    },
    skills: {
      strict_pull_ups: "intermediate",
      kipping_pull_ups: "advanced",
      butterfly_pull_ups: "intermediate",
      chest_to_bar_pull_ups: "intermediate",
      muscle_ups: "beginner",
      bar_muscle_ups: "beginner",
      strict_ring_muscle_ups: "none",
      toes_to_bar: "intermediate",
      wall_facing_hspu: "intermediate",
      hspu: "intermediate",
      strict_hspu: "beginner",
      deficit_hspu: "none",
      handstand_walk: "beginner",
      rope_climbs: "intermediate",
      legless_rope_climbs: "none",
      ring_dips: "intermediate",
      l_sit: "intermediate",
      double_unders: "advanced",
      pistols: "intermediate",
    },
    conditioning: {
      "1_mile_run": "7:00",
      "5k_run": "23:00",
      "1k_row": "3:50",
      "2k_row": "7:45",
      "5k_row": "20:30",
      "1min_bike_cals": 16,
      "10min_bike_cals": 130,
    },
    equipment: {
      barbell: true,
      dumbbells: true,
      kettlebells: true,
      rower: true,
      assault_bike: true,
      ski_erg: false,
      treadmill: false,
      pull_up_bar: true,
      rings: true,
      rope: true,
      ghd: true,
      parallettes: false,
      pegboard: false,
      box: true,
      wall_ball: true,
      sled: false,
      blocks: false,
      bands: true,
    },
    days_per_week: 5,
    session_length_minutes: 75,
    goal: "Make Quarterfinals next year. Need to improve my muscle-ups (especially bar) and my olympic lifting consistency.",
    injuries_constraints: "None currently.",
    self_perception_level: "intermediate",
    competition_athlete_id: null,
  },
  bundle: null,
};

// ============================================================
// Fixture C — strong male, strength_and_power, weak conditioning + skills
// ============================================================

export const FIXTURE_STRONG_LOWCARDIO: ProfileFixture = {
  name: "strong_lowcardio",
  description: "Strong male (advanced lifts) with weak gymnastics and weak conditioning. Asymmetric profile. Goal: bigger lifts; conditioning is maintenance.",
  profileRow: {
    age: 35,
    height: 72,
    bodyweight: 200,
    gender: "male",
    units: "lbs",
    lifts: {
      back_squat: 405,
      front_squat: 320,
      overhead_squat: 185,
      deadlift: 475,
      bench_press: 305,
      snatch: 165,
      power_snatch: 145,
      clean: 245,
      clean_and_jerk: 235,
      jerk: 235,
      power_clean: 215,
      push_jerk: 235,
      press: 175,
      push_press: 225,
    },
    skills: {
      strict_pull_ups: "beginner",
      kipping_pull_ups: "beginner",
      butterfly_pull_ups: "none",
      chest_to_bar_pull_ups: "none",
      muscle_ups: "none",
      bar_muscle_ups: "none",
      strict_ring_muscle_ups: "none",
      toes_to_bar: "beginner",
      wall_facing_hspu: "none",
      hspu: "none",
      strict_hspu: "none",
      deficit_hspu: "none",
      handstand_walk: "none",
      rope_climbs: "beginner",
      legless_rope_climbs: "none",
      ring_dips: "beginner",
      l_sit: "none",
      double_unders: "beginner",
      pistols: "beginner",
    },
    conditioning: {
      "1_mile_run": "10:00",
      "5k_run": "32:00",
      "1k_row": "4:15",
      "2k_row": "8:45",
      "5k_row": "23:30",
      "1min_bike_cals": 14,
      "10min_bike_cals": 115,
    },
    equipment: {
      barbell: true,
      dumbbells: true,
      kettlebells: true,
      rower: true,
      assault_bike: false,
      ski_erg: false,
      treadmill: false,
      pull_up_bar: true,
      rings: false,
      rope: false,
      ghd: false,
      parallettes: false,
      pegboard: false,
      box: true,
      wall_ball: false,
      sled: false,
      blocks: true,
      bands: true,
    },
    days_per_week: 4,
    session_length_minutes: 90,
    goal: "Add 50lbs to my back squat over the next year. Maintain conditioning. I'm a powerlifter trying to add some CrossFit work.",
    injuries_constraints: "Mild chronic lower back stiffness. No issues with squats or deads if I warm up properly.",
    self_perception_level: "intermediate",
    competition_athlete_id: null,
  },
  bundle: null,
};

// ============================================================
// Fixture D — Qualifier-tier athlete with Tier 4 link
// ============================================================

export const FIXTURE_QUALIFIER_LINKED: ProfileFixture = {
  name: "qualifier_linked",
  description: "Male qualifier-tier athlete with Tier 4 link. Strong across the board. Made Quarterfinals last 2 seasons.",
  profileRow: {
    age: 30,
    height: 70,
    bodyweight: 175,
    gender: "male",
    units: "lbs",
    lifts: {
      back_squat: 405,
      front_squat: 345,
      overhead_squat: 265,
      deadlift: 485,
      bench_press: 275,
      snatch: 245,
      power_snatch: 215,
      clean: 315,
      clean_and_jerk: 305,
      jerk: 305,
      power_clean: 275,
      push_jerk: 305,
      press: 175,
      push_press: 245,
    },
    skills: {
      strict_pull_ups: "advanced",
      kipping_pull_ups: "advanced",
      butterfly_pull_ups: "advanced",
      chest_to_bar_pull_ups: "advanced",
      muscle_ups: "advanced",
      bar_muscle_ups: "advanced",
      strict_ring_muscle_ups: "intermediate",
      toes_to_bar: "advanced",
      wall_facing_hspu: "advanced",
      hspu: "advanced",
      strict_hspu: "intermediate",
      deficit_hspu: "intermediate",
      handstand_walk: "advanced",
      rope_climbs: "advanced",
      legless_rope_climbs: "intermediate",
      ring_dips: "advanced",
      l_sit: "intermediate",
      double_unders: "advanced",
      pistols: "advanced",
    },
    conditioning: {
      "1_mile_run": "5:30",
      "5k_run": "18:30",
      "1k_row": "3:08",
      "2k_row": "6:50",
      "5k_row": "18:10",
      "1min_bike_cals": 25,
      "10min_bike_cals": 215,
    },
    equipment: {
      barbell: true,
      dumbbells: true,
      kettlebells: true,
      rower: true,
      assault_bike: true,
      ski_erg: true,
      treadmill: true,
      pull_up_bar: true,
      rings: true,
      rope: true,
      ghd: true,
      parallettes: true,
      pegboard: false,
      box: true,
      wall_ball: true,
      sled: true,
      blocks: true,
      bands: true,
    },
    days_per_week: 6,
    session_length_minutes: 120,
    goal: "Make Semifinals this season. Top weakness is heavy carries / odd-object work — needs prioritizing.",
    injuries_constraints: "Tendinopathy in left elbow when doing high-rep ring work. Manageable with reduced volume.",
    self_perception_level: "advanced",
    competition_athlete_id: "999001",
  },
  bundle: {
    identity: {
      name: "Fixture Athlete D",
      profile_url: null,
      competitor_id: "999001",
    },
    competition_summary: {
      overall_competitive_tier: "qualifier",
      seasons_competed: 4,
      latest_percentile: 96.2,
      trend: { direction: "improving", percentile_points_per_year: 1.8 },
      consistency: 0.82,
    },
    movement_affinity: [
      {
        category: "pulling",
        exposures: 18,
        avg_percentile: 94.5,
        trend: { direction: "improving", percentile_points_per_year: 2.0 },
        by_movement: {
          "pull-up": { exposures: 8, avg_percentile: 95.1 },
          "chest-to-bar pull-up": { exposures: 6, avg_percentile: 93.8 },
          "bar muscle-up": { exposures: 4, avg_percentile: 94.6 },
        },
        by_stage: {
          open: { exposures: 12, avg_percentile: 97.1 },
          quarterfinals: { exposures: 6, avg_percentile: 89.2 },
        },
      },
      {
        category: "olympic_lifting",
        exposures: 9,
        avg_percentile: 88.7,
        trend: { direction: "plateau", percentile_points_per_year: 0.3 },
        by_movement: {
          snatch: { exposures: 4, avg_percentile: 91.2 },
          "clean and jerk": { exposures: 5, avg_percentile: 86.5 },
        },
        by_stage: {
          open: { exposures: 6, avg_percentile: 93.4 },
          quarterfinals: { exposures: 3, avg_percentile: 79.2 },
        },
      },
    ],
    character_affinity: [
      { tag: "short_sprint", exposures: 10, avg_percentile: 94.0 },
      { tag: "medium_duration", exposures: 14, avg_percentile: 92.5 },
      { tag: "long_duration", exposures: 6, avg_percentile: 85.0 },
      { tag: "heavy_load", exposures: 5, avg_percentile: 90.3 },
    ],
    recent_raw_results: [
      {
        rank: 8420,
        movements: ["thruster", "chest-to-bar pull-up"],
        raw_score: 245,
        percentile: 96.5,
        time_domain: "short",
        scoring_unit: "reps",
        workout_label: "23.1",
      },
    ],
    time_domain_modality_breakdown: {
      short: {
        G_dominant: { exposures: 6, avg_percentile: 94.8 },
        W_dominant: { exposures: 4, avg_percentile: 91.0 },
        mixed: { exposures: 5, avg_percentile: 95.2 },
      },
      medium: {
        mixed: { exposures: 8, avg_percentile: 92.0 },
        G_dominant: { exposures: 4, avg_percentile: 90.5 },
      },
      long: {
        M_dominant: { exposures: 3, avg_percentile: 82.5 },
        mixed: { exposures: 3, avg_percentile: 87.2 },
      },
    },
    all_results: [
      {
        competition_workout_id: "fixture-23-1",
        year: 2023,
        stage: "open",
        ordinal: 1,
        workout_name: "23.1",
        division: 1,
        scaled_tier: "rx",
        workout: {
          classification: "structured",
          description: "Couplet of thrusters and chest-to-bar pull-ups.",
          scoring_unit: "reps",
          scoring_direction: "higher_is_better",
          is_dual_scoring: false,
          time_cap_seconds: 720,
          rep_target: null,
          time_domain: { bucket: "short", seconds: 720 },
          movements: [
            {
              name: "thruster",
              family: "weightlifting",
              position: 0,
              equipment: ["barbell"],
              mgw_category: "W",
              rounds: null,
              reps_total: 0,
              reps_per_round: null,
              reps_scheme: null,
              calories: null,
              load_lbs: 95,
              load_descriptor: "95 lbs",
              load_progression: null,
              distance_unit: null,
              distance_value: null,
              variant_tags: null,
            },
          ],
        },
        result: {
          valid: true,
          raw_score: 245,
          raw_score_text: "245 reps",
          scoring_unit: "reps",
          workout_rank: 8420,
          cohort_percentile: 96.5,
          worldwide_percentile: 94.2,
          cohort_n: 240000,
          worldwide_n: 320000,
          cohort_p99_threshold: 280,
          cohort_p99_threshold_unit: "reps",
        },
      },
    ],
    movement_competency: [
      { movement: "bar muscle-up", gap_signal: "likely_has", n_workouts: 4 },
      { movement: "ring muscle-up", gap_signal: "likely_has", n_workouts: 3 },
      { movement: "handstand walk", gap_signal: "likely_has", n_workouts: 2 },
    ],
    fitness_signature: {
      closable_gaps: [
        {
          dimension: "modality",
          bucket: "M_dominant",
          n_workouts: 6,
          cohort_percentile: 82.0,
          worldwide_percentile: 78.5,
          gap_vs_overall_pp: 14.2,
        },
      ],
      stage_progression: [
        { season: 2022, highest_stage_reached: "open", season_cohort_percentile: 92.0 },
        { season: 2023, highest_stage_reached: "quarterfinals", season_cohort_percentile: 95.5 },
        { season: 2024, highest_stage_reached: "quarterfinals", season_cohort_percentile: 96.2 },
      ],
      stimulus_breakdown: {
        overall: { all: { n_workouts: 24, cohort_percentile: 94.0, worldwide_percentile: 91.0 } },
        modality: {
          mixed: { n_workouts: 12, cohort_percentile: 95.0, worldwide_percentile: 92.0 },
          W_dominant: { n_workouts: 4, cohort_percentile: 92.0, worldwide_percentile: 89.0 },
          G_dominant: { n_workouts: 5, cohort_percentile: 96.0, worldwide_percentile: 93.0 },
          M_dominant: { n_workouts: 3, cohort_percentile: 82.0, worldwide_percentile: 78.0 },
        },
        load_class: {
          moderate: { n_workouts: 14, cohort_percentile: 94.0, worldwide_percentile: 91.0 },
          heavy: { n_workouts: 5, cohort_percentile: 90.0, worldwide_percentile: 87.0 },
          bodyweight: { n_workouts: 5, cohort_percentile: 96.0, worldwide_percentile: 93.0 },
        },
        skill_gated: {
          gated_present: { n_workouts: 11, cohort_percentile: 95.0, worldwide_percentile: 92.0 },
          gated_absent: { n_workouts: 13, cohort_percentile: 93.0, worldwide_percentile: 90.0 },
        },
        time_domain: {
          short: { n_workouts: 9, cohort_percentile: 95.5, worldwide_percentile: 92.5 },
          medium: { n_workouts: 11, cohort_percentile: 93.0, worldwide_percentile: 90.0 },
          long: { n_workouts: 4, cohort_percentile: 90.0, worldwide_percentile: 86.5 },
        },
      },
    },
  },
};

// ============================================================
// Fixture E — Games-tier athlete with Tier 4 link
// ============================================================

export const FIXTURE_GAMES_LINKED: ProfileFixture = {
  name: "games_linked",
  description: "Female Games athlete (3 Games appearances). Elite across all dimensions. Tier 4 with rich data including cohort_p99_threshold from Ask 1.",
  profileRow: {
    age: 27,
    height: 66,
    bodyweight: 150,
    gender: "female",
    units: "lbs",
    lifts: {
      back_squat: 285,
      front_squat: 245,
      overhead_squat: 195,
      deadlift: 345,
      bench_press: 175,
      snatch: 185,
      power_snatch: 165,
      clean: 235,
      clean_and_jerk: 225,
      jerk: 225,
      power_clean: 205,
      push_jerk: 225,
      press: 125,
      push_press: 175,
    },
    skills: {
      strict_pull_ups: "advanced",
      kipping_pull_ups: "advanced",
      butterfly_pull_ups: "advanced",
      chest_to_bar_pull_ups: "advanced",
      muscle_ups: "advanced",
      bar_muscle_ups: "advanced",
      strict_ring_muscle_ups: "advanced",
      toes_to_bar: "advanced",
      wall_facing_hspu: "advanced",
      hspu: "advanced",
      strict_hspu: "advanced",
      deficit_hspu: "advanced",
      handstand_walk: "advanced",
      rope_climbs: "advanced",
      legless_rope_climbs: "advanced",
      ring_dips: "advanced",
      l_sit: "advanced",
      double_unders: "advanced",
      pistols: "advanced",
    },
    conditioning: {
      "1_mile_run": "5:45",
      "5k_run": "19:10",
      "1k_row": "3:20",
      "2k_row": "7:05",
      "5k_row": "18:45",
      "1min_bike_cals": 22,
      "10min_bike_cals": 195,
    },
    equipment: {
      barbell: true,
      dumbbells: true,
      kettlebells: true,
      rower: true,
      assault_bike: true,
      ski_erg: true,
      treadmill: true,
      pull_up_bar: true,
      rings: true,
      rope: true,
      ghd: true,
      parallettes: true,
      pegboard: true,
      box: true,
      wall_ball: true,
      sled: true,
      blocks: true,
      bands: true,
    },
    days_per_week: 6,
    session_length_minutes: 150,
    goal: "Top 10 at the Games this year. Weak spot last season was heavy odd-object work.",
    injuries_constraints: "None active. History of hip impingement (right side) — manage with mobility work.",
    self_perception_level: "advanced",
    competition_athlete_id: "999002",
  },
  bundle: {
    identity: {
      name: "Fixture Athlete E",
      profile_url: null,
      competitor_id: "999002",
    },
    competition_summary: {
      overall_competitive_tier: "games_athlete",
      seasons_competed: 6,
      latest_percentile: 99.95,
      trend: { direction: "plateau", percentile_points_per_year: 0.1 },
      consistency: 0.94,
    },
    movement_affinity: [
      {
        category: "olympic_lifting",
        exposures: 22,
        avg_percentile: 92.5,
        trend: { direction: "improving", percentile_points_per_year: 1.0 },
        by_movement: {
          snatch: { exposures: 8, avg_percentile: 94.2 },
          "clean and jerk": { exposures: 10, avg_percentile: 91.5 },
          "overhead squat": { exposures: 4, avg_percentile: 90.0 },
        },
        by_stage: {
          open: { exposures: 6, avg_percentile: 99.4 },
          quarterfinals: { exposures: 4, avg_percentile: 95.0 },
          semifinals: { exposures: 6, avg_percentile: 88.5 },
          games: { exposures: 6, avg_percentile: 78.0 },
        },
      },
    ],
    character_affinity: [
      { tag: "short_sprint", exposures: 14, avg_percentile: 95.0 },
      { tag: "medium_duration", exposures: 18, avg_percentile: 92.0 },
      { tag: "long_duration", exposures: 8, avg_percentile: 80.0 },
      { tag: "heavy_load", exposures: 6, avg_percentile: 72.0 },
    ],
    recent_raw_results: [
      {
        rank: 12,
        movements: ["snatch", "burpee box jump-over"],
        raw_score: 4 * 60 + 35,
        percentile: 88.0,
        time_domain: "short",
        scoring_unit: "time",
        workout_label: "Games '24 E1",
      },
    ],
    time_domain_modality_breakdown: {
      short: {
        G_dominant: { exposures: 12, avg_percentile: 94.0 },
        W_dominant: { exposures: 7, avg_percentile: 88.0 },
        mixed: { exposures: 9, avg_percentile: 91.0 },
      },
      medium: {
        mixed: { exposures: 14, avg_percentile: 90.5 },
        G_dominant: { exposures: 6, avg_percentile: 92.0 },
      },
      long: {
        M_dominant: { exposures: 5, avg_percentile: 78.0 },
        mixed: { exposures: 5, avg_percentile: 82.0 },
      },
    },
    all_results: [
      {
        competition_workout_id: "fixture-games24-e1",
        year: 2024,
        stage: "games",
        ordinal: 1,
        workout_name: "Event 1",
        division: 2,
        scaled_tier: "rx",
        workout: {
          classification: "structured",
          description: "Snatch ladder + burpee box jump-overs.",
          scoring_unit: "time",
          scoring_direction: "lower_is_better",
          is_dual_scoring: true,
          time_cap_seconds: 600,
          rep_target: null,
          time_domain: { bucket: "short", seconds: 275 },
          movements: [
            {
              name: "snatch",
              family: "weightlifting",
              position: 0,
              equipment: ["barbell"],
              mgw_category: "W",
              rounds: 1,
              reps_total: 9,
              reps_per_round: null,
              reps_scheme: "ladder",
              calories: null,
              load_lbs: 165,
              load_descriptor: "ascending 105-165 lbs",
              load_progression: "ladder",
              distance_unit: null,
              distance_value: null,
              variant_tags: null,
            },
          ],
        },
        result: {
          valid: true,
          raw_score: 275,
          raw_score_text: "4:35",
          scoring_unit: "time",
          workout_rank: 12,
          cohort_percentile: 78.0,
          worldwide_percentile: 99.92,
          cohort_n: 40,
          worldwide_n: 320000,
          cohort_p99_threshold: 252,
          cohort_p99_threshold_unit: "time",
        },
      },
    ],
    movement_competency: [
      { movement: "ring muscle-up", gap_signal: "likely_has", n_workouts: 12 },
      { movement: "bar muscle-up", gap_signal: "likely_has", n_workouts: 8 },
      { movement: "deficit hspu", gap_signal: "likely_has", n_workouts: 4 },
      { movement: "handstand walk", gap_signal: "likely_has", n_workouts: 6 },
      { movement: "pegboard", gap_signal: "likely_lacking", n_workouts: 2 },
    ],
    fitness_signature: {
      closable_gaps: [
        {
          dimension: "load_class",
          bucket: "heavy",
          n_workouts: 6,
          cohort_percentile: 72.0,
          worldwide_percentile: 99.4,
          gap_vs_overall_pp: 18.5,
        },
        {
          dimension: "time_domain",
          bucket: "long",
          n_workouts: 5,
          cohort_percentile: 78.0,
          worldwide_percentile: 99.6,
          gap_vs_overall_pp: 12.0,
        },
      ],
      stage_progression: [
        { season: 2020, highest_stage_reached: "quarterfinals", season_cohort_percentile: 98.5 },
        { season: 2021, highest_stage_reached: "semifinals", season_cohort_percentile: 99.2 },
        { season: 2022, highest_stage_reached: "games", season_cohort_percentile: 84.0 },
        { season: 2023, highest_stage_reached: "games", season_cohort_percentile: 79.0 },
        { season: 2024, highest_stage_reached: "games", season_cohort_percentile: 82.0 },
      ],
      stimulus_breakdown: {
        overall: { all: { n_workouts: 41, cohort_percentile: 90.5, worldwide_percentile: 99.8 } },
        modality: {
          mixed: { n_workouts: 20, cohort_percentile: 92.0, worldwide_percentile: 99.7 },
          W_dominant: { n_workouts: 7, cohort_percentile: 85.0, worldwide_percentile: 99.5 },
          G_dominant: { n_workouts: 9, cohort_percentile: 94.0, worldwide_percentile: 99.85 },
          M_dominant: { n_workouts: 5, cohort_percentile: 78.0, worldwide_percentile: 99.4 },
        },
        load_class: {
          moderate: { n_workouts: 22, cohort_percentile: 92.5, worldwide_percentile: 99.8 },
          heavy: { n_workouts: 6, cohort_percentile: 72.0, worldwide_percentile: 99.4 },
          bodyweight: { n_workouts: 13, cohort_percentile: 94.0, worldwide_percentile: 99.85 },
        },
        skill_gated: {
          gated_present: { n_workouts: 18, cohort_percentile: 93.0, worldwide_percentile: 99.85 },
          gated_absent: { n_workouts: 23, cohort_percentile: 88.5, worldwide_percentile: 99.7 },
        },
        time_domain: {
          short: { n_workouts: 17, cohort_percentile: 92.0, worldwide_percentile: 99.8 },
          medium: { n_workouts: 19, cohort_percentile: 91.0, worldwide_percentile: 99.75 },
          long: { n_workouts: 5, cohort_percentile: 78.0, worldwide_percentile: 99.6 },
        },
      },
    },
  },
};

// ============================================================
// Fixture F — Injured athlete (competitor goal + overhead restriction)
// ============================================================

export const FIXTURE_INJURED_COMPETITOR: ProfileFixture = {
  name: "injured_competitor",
  description: "Same shape as the intermediate competitor but with an overhead-pressing injury constraint that should trigger safety-review flags if the writer programs prohibited movements.",
  profileRow: {
    ...FIXTURE_INTERMEDIATE_COMPETITOR.profileRow,
    injuries_constraints: "Torn rotator cuff in left shoulder (3 months out). No overhead pressing of any kind — no snatches, no jerks, no push press, no HSPU, no overhead squats. Can press at chest level or below.",
  },
  bundle: null,
};

// ============================================================
// All fixtures exported as an array for iteration in tests.
// ============================================================

export const ALL_FIXTURES: ProfileFixture[] = [
  FIXTURE_BEGINNER_FITNESS,
  FIXTURE_INTERMEDIATE_COMPETITOR,
  FIXTURE_STRONG_LOWCARDIO,
  FIXTURE_QUALIFIER_LINKED,
  FIXTURE_GAMES_LINKED,
  FIXTURE_INJURED_COMPETITOR,
];
