/**
 * Realistic data for page tests, shaped like production rows.
 */
import { USER } from './ids';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

export const P = 'prog-1';
const DAYS = [1, 2, 3, 4];

const sk = (weeks: number[]) => ({
  month_plan: { summary: 'Strength base with aerobic work.' },
  weeks: weeks.map((w) => ({
    week_num: w, focus: `Week ${w} focus`,
    days: DAYS.map((d) => ({
      day_num: d, day_intent: 'Squat and conditioning', block_types: ['warm-up', 'skills', 'strength', 'accessory', 'metcon', 'cool-down'],
      primary_lift: 'Back Squat', metcon_focus: 'Sustained aerobic; even pace',
      block_minutes: [{ block_type: 'strength', minutes: 25 }, { block_type: 'metcon', minutes: 20 }],
    })),
  })),
});

const workout = (month: number, week: number, day: number, status: 'written' | 'outline') => ({
  id: `m${month}w${week}d${day}`, program_id: P, month_number: month, week_num: week, day_num: day, status,
  workout_text: null, sort_order: (month - 1) * 100 + (week - 1) * 10 + day,
});

const blocksFor = (wid: string) => [
  { id: `${wid}-b0`, program_workout_id: wid, block_type: 'warm-up', block_label: null, block_scheme: null, scheme_format: null, time_cap_seconds: null, block_notes: null, sort_order: 0, expected_benchmark: null },
  { id: `${wid}-b1`, program_workout_id: wid, block_type: 'strength', block_label: null, block_scheme: 'Same weight across all sets. 2 min rest.', scheme_format: { format: 'work_sets', rest_seconds: 120 }, time_cap_seconds: null, block_notes: 'internal', sort_order: 1, expected_benchmark: null },
  { id: `${wid}-b2`, program_workout_id: wid, block_type: 'metcon', block_label: null, block_scheme: '4 rounds: 5:00 on / 1:15 off', scheme_format: { format: 'intervals', rounds: 4, work_seconds: 300, rest_seconds: 75 }, time_cap_seconds: null, block_notes: 'Even pace.', stimulus_note: 'Sustained aerobic cruise; repeat round 1 pace.', sort_order: 2, expected_benchmark: null },
  { id: `${wid}-b3`, program_workout_id: wid, block_type: 'metcon', block_label: null, block_scheme: 'AMRAP 12', scheme_format: { format: 'amrap', minutes: 12 }, time_cap_seconds: 720, block_notes: null, sort_order: 3, expected_benchmark: { median_score: '5+10', excellent_score: '7+0' } },
  { id: `${wid}-b4`, program_workout_id: wid, block_type: 'active-recovery', block_label: null, block_scheme: null, scheme_format: null, time_cap_seconds: null, block_notes: null, sort_order: 4, expected_benchmark: null },
];
const movementsFor = (wid: string) => [
  { id: `${wid}-m0`, block_id: `${wid}-b0`, movement: 'Row', sort_order: 0 },
  { id: `${wid}-m1`, block_id: `${wid}-b1`, movement: 'Back Squat', sets: 5, reps: 25, rep_scheme: [5, 5, 5, 5, 5], weight: 100, weight_unit: 'kg', sort_order: 0 },
  { id: `${wid}-m2`, block_id: `${wid}-b2`, movement: 'Kettlebell Swing', reps: 15, rep_scheme: [15], weight: 24, weight_unit: 'kg', sort_order: 0 },
  { id: `${wid}-m3`, block_id: `${wid}-b3`, movement: 'Wall Ball', reps: 20, rep_scheme: [20], weight: 9, weight_unit: 'kg', sort_order: 0 },
  { id: `${wid}-m4`, block_id: `${wid}-b4`, movement: 'Easy Walk', sort_order: 0 },
];

export interface ProgramShape {
  /** [month, week, status] for every week that exists. */
  weeks: Array<[number, number, 'written' | 'outline']>;
  weekly?: boolean;
  archived?: boolean;
  /** Days of (month 1, week 1) the member has fully logged. */
  loggedDays?: number[];
  /** A day started but not finished. */
  inProgressDay?: number;
  notes?: boolean;
  /** A week job running right now for [month, week]. */
  writing?: [number, number];
}

export function programTables(shape: ProgramShape, features: string[]) {
  const workouts = shape.weeks.flatMap(([m, w, st]) => DAYS.map((d) => workout(m, w, d, st)));
  const written = workouts.filter((w) => w.status === 'written');
  const months = [...new Set(shape.weeks.map(([m]) => m))];
  const logs = [
    ...(shape.loggedDays ?? []).map((d) => ({ id: `log-d${d}`, user_id: USER, source_type: 'program', source_id: `m1w1d${d}`, status: 'completed', workout_date: iso(3).slice(0, 10), created_at: iso(3) })),
    ...(shape.inProgressDay ? [{ id: 'log-ip', user_id: USER, source_type: 'program', source_id: `m1w1d${shape.inProgressDay}`, status: 'in_progress', workout_date: iso(1).slice(0, 10), created_at: iso(1) }] : []),
  ];
  return {
    profiles: [{ id: USER, role: 'user', full_name: 'Test Member', email: 'member@example.com', timezone: 'UTC' }],
    user_entitlements: features.map((feature, i) => ({ id: `e${i}`, user_id: USER, feature, source: 'admin', expires_at: null })),
    athlete_profiles: [{ user_id: USER, units: 'kg', days_per_week: 4, session_length_minutes: 60, goal: 'Get stronger', injuries_constraints: 'None', engine_ai_sequencing: false, equipment: {}, lifts: { back_squat: 140 }, skills: {}, conditioning: {}, eval_credits_remaining: 0, t3_intro_seen_at: iso(20), program_intro_seen_at: iso(20), engine_program_version: null }],
    programs: [{ id: P, user_id: USER, name: 'My GAINS Program', source: 'generated', program_version: 'v3', weekly_mode: shape.weekly !== false, generated_months: Math.max(...months), archived_at: shape.archived ? iso(2) : null, created_at: iso(10), committed: true, month_plan: { summary: 'x' } }],
    program_workouts: workouts,
    program_month_skeletons: months.map((m) => ({ id: `sk${m}`, program_id: P, month_number: m, created_at: iso(2), skeleton: sk([1, 2, 3, 4]) })),
    program_blocks_v2: written.flatMap((w) => blocksFor(w.id)),
    program_movements_v2: written.flatMap((w) => movementsFor(w.id)),
    workout_logs: logs,
    workout_log_blocks: [
      ...(shape.loggedDays ?? []).flatMap((d) => [1, 2, 3].map((s) => ({ id: `lb-d${d}-${s}`, log_id: `log-d${d}`, sort_order: s, block_type: s === 1 ? 'strength' : 'metcon', rx: true, rpe: 7, notes: null, score: null, capped: false }))),
      ...(shape.inProgressDay ? [{ id: 'lb-ip', log_id: 'log-ip', sort_order: 1, block_type: 'strength', rx: true, rpe: 7, notes: null, score: null, capped: false }] : []),
    ],
    workout_log_entries: [],
    training_schedule: [],
    coach_notes: shape.notes ? [{ id: 'n1', user_id: USER, text: 'Hotel gym next week, dumbbells only', horizon: 'next_week', program_id: P, week_num: 1, source: 'coach', created_at: iso(1), expires_at: null, consumed_engine_at: null, consumed_programming_at: null }] : [],
    coach_states: [{ id: 'cs1', user_id: USER, version: 1, coach_state: { priorities: [{ rank: 1, title: 'Squat strength', athlete_facing_rationale: 'Your squat lags your pull.' }], deprioritized: [] } }],
    program_jobs: shape.writing ? [{ id: 'job1', user_id: USER, status: 'processing', updated_at: iso(0), created_at: iso(0), fill: { weekNum: shape.writing[1] }, month: shape.writing[0] }] : [],
    profile_evaluations: [{ id: 'ev1', user_id: USER, status: 'complete', visible: true, month_number: 1, created_at: iso(11), analysis: 'ok' }],
    training_evaluations: [],
    movements: [{ canonical_name: 'back_squat', display_name: 'Back Squat', modality: 'W', category: 'Weightlifting', aliases: [] }],
  };
}
