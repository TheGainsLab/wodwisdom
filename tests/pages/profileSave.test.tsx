/**
 * The profile page, Step 2 ("Your Numbers"): a save that completes the step
 * must SHOW that it did.
 *
 * 2026-11-25: a member who tapped the floating "Unsaved changes" pill and
 * then "Save My Numbers" had Step 2 completed in the database while the
 * screen stayed on a red "Save My Numbers" with no "Complete". The page's
 * "last saved" snapshot was only retaken when the unsaved-changes flag
 * flipped, and the pill had already cleared it.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import AthletePage from '../../src/pages/AthletePage';
import { openPage, expectNoCrash, USER } from './harness';
import { programTables } from './fixtures';

const numbers = {
  lifts: { back_squat: 405, deadlift: 535, bench_press: 245, snatch: 245, clean_and_jerk: 315 },
  conditioning: { '2k_row': '6:13', '1_mile_run': '7:00' },
  skills: {},
};

/** A Programming member, no program yet, Step 1 done, Step 2 not completed. */
function tables(profile: Record<string, unknown>) {
  const base = programTables({ weeks: [] as never }, ['programming', 'ai_chat', 'nutrition']);
  return {
    ...base, programs: [], program_workouts: [], program_month_skeletons: [],
    athlete_profiles: [{ user_id: USER, units: 'lbs', age: 51, height: 75, bodyweight: 225, gender: 'male', eval_credits_remaining: 1, equipment: {}, athletic_reviewed_at: null, ...profile }],
  };
}

async function openStep2(profile: Record<string, unknown>) {
  const page = await openPage({ data: { userId: USER, tables: tables(profile) }, path: '/profile', route: '/profile', element: (s) => <AthletePage session={s} /> });
  expectNoCrash(page);
  fireEvent.click(page.getByText('Your Numbers'));
  await waitFor(() => expect(page.getByText('Save My Numbers')).toBeTruthy());
  return page;
}

const lastSave = (page: Awaited<ReturnType<typeof openStep2>>) =>
  page.fake.writes.filter((w) => w.table === 'athlete_profiles' && w.op === 'upsert').pop()?.payload as Record<string, unknown> | undefined;

describe('Profile, Step 2 save', () => {
  it('Save My Numbers on an already-saved form shows the step complete', async () => {
    const page = await openStep2(numbers);
    // Nothing edited: the form is clean, exactly as it is after the pill saved.
    fireEvent.click(page.getByText('Save My Numbers'));
    await waitFor(() => expect(lastSave(page)?.athletic_reviewed_at).toBeTruthy());
    await waitFor(() => expect(page.queryByText('Save My Numbers'), 'the button still says Save My Numbers after a save that completed the step').toBeNull());
    expect(page.getAllByText(/Saved ✓/).length).toBeGreaterThan(0);
    expect(page.getAllByText(/Complete ✓/).length).toBe(2); // Step 1 and Step 2
    expectNoCrash(page);
  });

  it('the pill, after a number was edited, completes the step like Save My Numbers', async () => {
    const page = await openStep2(numbers);
    fireEvent.click(page.getByText(/1RM Lifts/));
    const box = await waitFor(() => page.getByDisplayValue('405'));
    fireEvent.change(box, { target: { value: '410' } });
    const pill = await waitFor(() => page.getByText(/Unsaved changes/));
    fireEvent.click(pill);
    await waitFor(() => expect(lastSave(page)?.athletic_reviewed_at, 'the pill saved without completing Step 2').toBeTruthy());
    await waitFor(() => expect(page.getAllByText(/Complete ✓/).length).toBe(2));
    expectNoCrash(page);
  });

  it('the pill with core numbers blank opens the two-choice dialog instead of saving blind', async () => {
    const page = await openStep2({ lifts: { back_squat: 405 }, conditioning: {}, skills: {} });
    fireEvent.click(page.getByText(/1RM Lifts/));
    fireEvent.change(await waitFor(() => page.getByDisplayValue('405')), { target: { value: '410' } });
    fireEvent.click(await waitFor(() => page.getByText(/Unsaved changes/)));
    await waitFor(() => expect(page.getByText('Some numbers are still blank')).toBeTruthy());
    expect(lastSave(page)).toBeUndefined();
  });

  it('the pill after a Step 1 edit only does not complete Step 2', async () => {
    const page = await openStep2(numbers);
    fireEvent.click(page.getByText('Basics'));
    fireEvent.change(await waitFor(() => page.getByDisplayValue('51')), { target: { value: '52' } });
    fireEvent.click(await waitFor(() => page.getByText(/Unsaved changes/)));
    await waitFor(() => expect(lastSave(page)).toBeTruthy());
    expect(lastSave(page)?.athletic_reviewed_at ?? null).toBeNull();
  });
});
