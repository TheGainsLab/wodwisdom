/**
 * Training Log, Strength and Skills tabs: a logged entry lands on the card the
 * AI said its movement counts toward, not the card its spelling suggests.
 * An entry nobody labelled is sorted by name, as before.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import TrainingLogPage from '../../src/pages/TrainingLogPage';
import { openPage, expectNoCrash, USER } from './harness';
import { programTables } from './fixtures';

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const entry = (id: string, block: string, movement: string, counts_toward: string | null, extra: Record<string, unknown> = {}) => ({
  id, log_id: 'log1', block_id: block, movement, counts_toward, sets: 1, reps: 5, weight: 100, weight_unit: 'lbs', set_number: 1,
  reps_completed: 5, rpe: 7, scaling_note: null, block_label: null, hold_seconds: null, distance: null, distance_unit: null,
  quality: null, variation: null, faults_observed: null, sort_order: 0, ...extra,
});

function tables(entries: Record<string, unknown>[]) {
  const base = programTables({ weeks: [[1, 1, 'written']] }, ['programming', 'ai_chat', 'nutrition']);
  return {
    ...base,
    workout_logs: [{ id: 'log1', user_id: USER, source_type: 'program', source_id: 'm1w1d1', status: 'completed', workout_date: day(3), created_at: new Date(Date.now() - 3 * 86400000).toISOString(), workout_text: 'x', workout_type: 'strength' }],
    workout_log_blocks: [
      { id: 'blk-strength', log_id: 'log1', sort_order: 1, block_type: 'strength', rx: true, rpe: 7, notes: null, score: null, capped: false },
      { id: 'blk-skills', log_id: 'log1', sort_order: 2, block_type: 'skills', rx: true, rpe: 7, notes: null, score: null, capped: false },
    ],
    workout_log_entries: entries,
  };
}

async function open(entries: Record<string, unknown>[], tab: 'Strength' | 'Skills') {
  const page = await openPage({ data: { userId: USER, tables: tables(entries) }, path: '/training-log?view=analytics', route: '/training-log', element: (s) => <TrainingLogPage session={s} /> });
  expectNoCrash(page);
  fireEvent.click(await waitFor(() => page.getByText(tab, { selector: 'button.tl-tab' })));
  await waitFor(() => expect(page.container.querySelectorAll('.tl-movement-card').length).toBeGreaterThan(0));
  return page;
}
/** "Press" → the text of that card's header, e.g. "Press1 day▼…". */
const card = (page: Awaited<ReturnType<typeof open>>, title: string) =>
  [...page.container.querySelectorAll('.tl-movement-card')].map((c) => c.textContent ?? '').find((t) => t.startsWith(title + '0') || t.startsWith(title + '1') || t.startsWith(title + '2')) ?? null;

describe('Training Log cards', () => {
  it('strength: labelled entries go where the AI said', async () => {
    const page = await open([
      entry('e1', 'blk-strength', 'Military Press', 'press'),
      entry('e2', 'blk-strength', 'Snatch Grip Deadlift', 'deadlift'),
      entry('e3', 'blk-strength', 'Clean Pull', 'none'),
    ], 'Strength');
    expect(card(page, 'Press')).toMatch(/^Press1 day/);
    expect(card(page, 'Deadlift')).toMatch(/^Deadlift1 day/);
    expect(card(page, 'Snatch') ?? 'Snatch0 days').toMatch(/^Snatch0 days/); // by name it used to land here (a card with nothing is not shown)
    expect(card(page, 'Clean & Jerk') ?? 'Clean & Jerk0 days').toMatch(/^Clean & Jerk0 days/); // and here
    expect(card(page, 'Other Strength')).toMatch(/^Other Strength1 day/);
    expectNoCrash(page);
  });

  it('strength: an entry nobody labelled is sorted by name, as before', async () => {
    const page = await open([entry('e1', 'blk-strength', 'Back Squat', null), entry('e2', 'blk-strength', 'Military Press', null)], 'Strength');
    expect(card(page, 'Back Squat')).toMatch(/^Back Squat1 day/);
    expect(card(page, 'Other Strength')).toMatch(/^Other Strength1 day/);
  });

  it('skills: the catalogue name and the profile skill no longer have to match', async () => {
    const page = await open([
      entry('e1', 'blk-skills', 'Chest To Bar', 'chest_to_bar_pull_ups'),
      entry('e2', 'blk-skills', 'Ring Muscle Up', 'muscle_ups'),
      entry('e3', 'blk-skills', 'Step Up', 'none'),
    ], 'Skills');
    expect(card(page, 'Pull-Up')).toMatch(/^Pull-Up1 day/);
    expect(card(page, 'Muscle-Up')).toMatch(/^Muscle-Up1 day/);
    expect(card(page, 'Box Jump') ?? 'Box Jump0 days').toMatch(/^Box Jump0 days/); // "Step Up" used to count as a box jump
    expectNoCrash(page);
  });
});
