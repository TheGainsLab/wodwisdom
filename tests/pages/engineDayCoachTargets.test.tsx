/**
 * The Engine day page: what the AI Coach is sent must be what is on the
 * screen.
 *
 * Opens a real Engine day for an Engine member with a time trial, expands
 * "Workout Details", reads every row off the screen, then taps each of the
 * three ways into the coach and compares what was handed over, line by line.
 *
 * 2026-11-26: the coach was sent one averaged pace and told it was the number
 * on the athlete's screen. A member reported the coach's pacing disagreeing
 * with Workout Details.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import EngineTrainingDayPage from '../../src/pages/EngineTrainingDayPage';
import ErrorBoundary from '../../src/components/ErrorBoundary';
import { EntitlementsProvider } from '../../src/hooks/useEntitlements';
import { fakeSupabase } from './fakeSupabase';
import { holder } from './holder';
import { USER } from './ids';

const today = new Date().toISOString().slice(0, 10);

/** An Engine member on day 1 of the 5-day program, Echo bike in calories, baseline 20 cal/min. */
function tables(blocks: Record<string, unknown>) {
  return {
    profiles: [{ id: USER, role: 'user', full_name: 'Engine Member', email: 'engine@example.com', timezone: 'UTC' }],
    user_entitlements: ['engine', 'ai_chat', 'nutrition'].map((feature, i) => ({ id: `e${i}`, user_id: USER, feature, source: 'admin', expires_at: null })),
    athlete_profiles: [{ user_id: USER, engine_program_version: 'main_5day', engine_current_day: 1, engine_months_unlocked: 1, engine_goal: null, engine_ai_sequencing: false, engine_restarts: null, engine_targets_v2: false, units: 'lbs' }],
    engine_program_mapping: [{ id: 'm1', engine_program_id: 'main_5day', program_sequence_order: 1, engine_workout_day_number: 1, month: 1, week_number: 1 }],
    engine_workouts: [{ id: 'w1', program_type: 'main_5day', day_number: 1, day_type: 'interval', phase: 1, block_count: 2, set_rest_seconds: 180, total_duration_minutes: 30, base_intensity_percent: 85, month: 1, ...blocks }],
    engine_day_types: [{ id: 'interval', name: 'Interval', max_duration_minutes: 40 }],
    engine_user_modality_preferences: [{ id: 'p1', user_id: USER, modality: 'last_selected', primary_unit: 'cal', secondary_unit: 'echo_bike' }],
    engine_time_trials: [{ id: 't1', user_id: USER, modality: 'echo_bike', units: 'cal', total_output: 200, calculated_rpm: 20, is_current: true, date: today, created_at: new Date().toISOString() }],
    engine_user_performance_metrics: [],
    engine_workout_sessions: [],
    engine_user_day_overrides: [],
    engine_programs: [{ id: 'main_5day', name: 'Year of the Engine', days_per_week: 5 }],
  };
}

let handedOver: Record<string, unknown> | null = null;
function Review() {
  handedOver = (useLocation().state ?? null) as Record<string, unknown> | null;
  return <div>coach screen</div>;
}

async function openDay(blocks: Record<string, unknown>) {
  holder.fake = fakeSupabase({ userId: USER, tables: tables(blocks) });
  handedOver = null;
  const view = render(
    <MemoryRouter initialEntries={['/engine/training/1']}>
      <EntitlementsProvider userId={USER}>
        <ErrorBoundary>
          <Routes>
            <Route path="/engine/training/:dayNumber" element={<EngineTrainingDayPage session={holder.fake.session as never} />} />
            <Route path="/engine/training/:dayNumber/review" element={<Review />} />
            <Route path="*" element={<div>navigated away</div>} />
          </Routes>
        </ErrorBoundary>
      </EntitlementsProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await waitFor(() => view.getByText(/See workout/), { timeout: 8000 }));
  fireEvent.click(await waitFor(() => view.getByText('Workout Details')));
  await waitFor(() => expect(view.container.querySelectorAll('.engine-breakdown-row').length).toBeGreaterThan(0));
  // The baseline loads a moment after the machine is chosen: wait for a computed target.
  await waitFor(() => expect(view.container.querySelector('.engine-breakdown-goal .goal-inline')).toBeTruthy(), { timeout: 4000 });
  return view;
}

/** Every Workout Details row as the athlete reads it: "LABEL duration: target". */
function rowsOnScreen(view: ReturnType<typeof render>): string[] {
  const out: string[] = [];
  const blocks = [...view.container.querySelectorAll('.engine-breakdown > div')];
  for (const block of blocks) {
    const header = block.querySelector('.engine-breakdown-block-header span')?.textContent ?? '';
    for (const row of block.querySelectorAll('.engine-breakdown-row')) {
      const label = row.querySelector('.engine-breakdown-label')?.textContent ?? '';
      const dur = row.querySelector('.engine-breakdown-dur')?.textContent ?? '';
      const goalCell = row.querySelector('.engine-breakdown-goal');
      const goal = goalCell ? (goalCell.querySelector('.goal-inline')?.textContent ?? goalCell.textContent ?? '') : null;
      if (label === 'BLOCK REST') { out.push(`BLOCK REST ${dur}`); continue; }
      const where = header && blocks.length > 1 ? `${header} ` : '';
      out.push(goal == null ? `${where}${label} ${dur}` : `${where}${label} ${dur}: ${goal}`);
    }
  }
  return out;
}

const SESSIONS: Array<[string, Record<string, unknown>]> = [
  ['rising rounds, then a max-effort block', {
    block_1_params: { rounds: 3, workDuration: 120, restDuration: 60, paceRange: [0.7, 0.9], paceProgression: 'increasing' },
    block_2_params: { rounds: 2, workDuration: 30, restDuration: 120, paceRange: 'max_effort' },
  }],
  ['base and flux parts at different paces', {
    block_count: 1,
    block_1_params: { rounds: 1, workProgression: 'alternating_paces', workDuration: 720, baseDuration: 300, fluxDuration: 60, paceRange: [0.7, 0.75], basePace: [0.65, 0.7], fluxPaceRange: [0.9, 0.95] },
  }],
  ['flux stages, each stepping up', {
    block_count: 1,
    block_1_params: { rounds: 1, workProgression: 'progressive_flux_intensity', workDuration: 720, baseDuration: 300, fluxDuration: 60, paceRange: [0.7, 0.7], fluxStartIntensity: 0.8, fluxIncrement: 0.1 },
  }],
  ['base with max-effort bursts', {
    block_count: 1,
    block_1_params: { rounds: 1, workProgression: 'continuous_with_bursts', workDuration: 660, burstTiming: 'every_5_minutes', burstDuration: 30, paceRange: [0.7, 0.7] },
  }],
];

describe('Engine day: the coach is sent what the screen shows', () => {
  for (const [name, blocks] of SESSIONS) {
    it(name, async () => {
      const view = await openDay(blocks);
      const shown = rowsOnScreen(view);
      expect(shown.length).toBeGreaterThan(1);
      if (process.env.SHOW_PAGES) console.log('SCREEN>>', JSON.stringify(shown));
      // The session has parts with DIFFERENT targets or a part with none: the case one average cannot describe.
      const targets = new Set(shown.filter((l) => l.includes(': ')).map((l) => l.split(': ')[1]));
      expect(targets.size, 'this session should show more than one distinct target').toBeGreaterThan(1);

      for (const button of ['AI Coach', 'Pace this', 'Warm-up']) {
        fireEvent.click(view.getByText(button));
        await waitFor(() => expect(view.getByText('coach screen')).toBeTruthy());
        expect(handedOver?.screenTargets, `"${button}" did not hand the screen's rows to the coach`).toEqual(shown);
        // back to the day for the next button
        view.unmount();
        if (button !== 'Warm-up') Object.assign(view, await openDay(blocks));
      }
      expect(view.queryByText('Something went wrong')).toBeNull();
    });
  }
});
