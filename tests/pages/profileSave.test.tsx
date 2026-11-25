/**
 * The profile page intake, Steps 1 and 2: every save must do what its button
 * says, and the screen must show the result at once, with no reload.
 *
 * Two saves exist on purpose (founder, 2026-11-25):
 *  - the floating pill, "Save work in progress": stores what is typed and
 *    never completes a step, so a member can leave and come back;
 *  - the section button, "Section complete — save my numbers": stores it
 *    and completes Step 2, which unlocks the evaluation.
 *
 * 2026-11-25: a member who tapped the pill and then the section button had
 * Step 2 completed in the database while the screen stayed on the red
 * button with no "Complete". The page's "last saved" snapshot was only
 * retaken when the unsaved-changes flag flipped, and the pill had already
 * cleared it.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import AthletePage from '../../src/pages/AthletePage';
import { openPage, expectNoCrash, USER } from './harness';
import { programTables } from './fixtures';

const FULL = {
  lifts: { back_squat: 405, deadlift: 535, bench_press: 245, snatch: 245, clean_and_jerk: 315 },
  conditioning: { '2k_row': '6:13', '1_mile_run': '7:00' },
  skills: {},
};
const SPARSE = { lifts: { back_squat: 405 }, conditioning: {}, skills: {} };
const STEP1 = { units: 'lbs', age: 51, height: 75, bodyweight: 225, gender: 'male' };

/** A Programming member with no program yet. */
function tables(profile: Record<string, unknown> | null) {
  const base = programTables({ weeks: [] as never }, ['programming', 'ai_chat', 'nutrition']);
  return {
    ...base, programs: [], program_workouts: [], program_month_skeletons: [],
    // A new member: no evaluation yet, so completing Step 2 offers the first one.
    profile_evaluations: [], training_evaluations: [],
    athlete_profiles: profile ? [{ user_id: USER, eval_credits_remaining: 1, equipment: {}, athletic_reviewed_at: null, ...profile }] : [],
  };
}
type Page = Awaited<ReturnType<typeof openPage>>;
const open = async (profile: Record<string, unknown> | null) => {
  const page = await openPage({ data: { userId: USER, tables: tables(profile) }, path: '/profile', route: '/profile', element: (s) => <AthletePage session={s} /> });
  expectNoCrash(page);
  return page;
};
const BUTTON = /Section complete — save my numbers/;
const pill = () => document.querySelector('.unsaved-pill') as HTMLButtonElement | null;
const saves = (page: Page) => page.fake.writes.filter((w) => w.table === 'athlete_profiles' && w.op === 'upsert').map((w) => w.payload as Record<string, unknown>);
const lastSave = (page: Page) => saves(page).pop();
const completeCount = (page: Page) => page.queryAllByText(/Complete ✓/).length;

async function openStep2(profile: Record<string, unknown>) {
  const page = await open({ ...STEP1, ...profile });
  fireEvent.click(page.getByText('Your Numbers'));
  await waitFor(() => expect(page.getByText(/1RM Lifts/)).toBeTruthy());
  return page;
}
async function editSquat(page: Page, to: string) {
  if (!page.queryByDisplayValue('405') && !page.queryByDisplayValue('410')) fireEvent.click(page.getByText(/1RM Lifts/));
  const box = await waitFor(() => page.getByDisplayValue(/^(405|410)$/));
  fireEvent.change(box, { target: { value: to } });
  await waitFor(() => expect(pill(), 'the pill did not appear after an edit').toBeTruthy());
}
const tapPill = async (page: Page) => { const before = saves(page).length; fireEvent.click(pill()!); await waitFor(() => expect(saves(page).length).toBe(before + 1)); await waitFor(() => expect(pill()).toBeNull()); };

describe('Profile intake: Step 1', () => {
  it('saving Basics shows Step 1 complete and does not complete Step 2', async () => {
    const page = await open(null);
    fireEvent.click(page.getByText('Basics'));
    const boxes = await waitFor(() => { const b = page.container.querySelectorAll('input[type="number"]'); expect(b.length).toBeGreaterThanOrEqual(3); return b; });
    fireEvent.change(boxes[0], { target: { value: '51' } });
    fireEvent.change(boxes[1], { target: { value: '75' } });
    fireEvent.change(boxes[2], { target: { value: '225' } });
    fireEvent.click(page.getByText('Male'));
    fireEvent.click(page.getByText(/^Save/, { selector: 'button.auth-btn' }));
    await waitFor(() => expect(lastSave(page)).toBeTruthy());
    expect(lastSave(page)).toMatchObject({ age: 51, height: 75, bodyweight: 225, gender: 'male' });
    expect(lastSave(page)?.athletic_reviewed_at ?? null).toBeNull();
    await waitFor(() => expect(completeCount(page)).toBe(1));
    expectNoCrash(page);
  });
});

describe('Profile intake: Step 2, the pill is a partial save', () => {
  it('stores the numbers, does not complete Step 2, and the section button is still there', async () => {
    const page = await openStep2(FULL);
    await editSquat(page, '410');
    await tapPill(page);
    expect((lastSave(page)?.lifts as Record<string, number>).back_squat).toBe(410);
    expect(lastSave(page)?.athletic_reviewed_at ?? null).toBeNull();
    expect(completeCount(page)).toBe(1); // Step 1 only
    expect(page.getByText(BUTTON)).toBeTruthy();
    expect(page.queryByText(/Run Evaluation/)).toBeNull();
  });

  it('with core numbers blank it still just saves: no dialog, nothing completed', async () => {
    const page = await openStep2(SPARSE);
    await editSquat(page, '410');
    await tapPill(page);
    expect(page.queryByText('Some numbers are still blank')).toBeNull();
    expect(lastSave(page)?.athletic_reviewed_at ?? null).toBeNull();
    expect(completeCount(page)).toBe(1);
  });

  it('can be used again and again without completing anything', async () => {
    const page = await openStep2(FULL);
    await editSquat(page, '410'); await tapPill(page);
    await editSquat(page, '405'); await tapPill(page);
    expect(saves(page).length).toBe(2);
    expect(saves(page).every((s) => (s.athletic_reviewed_at ?? null) === null)).toBe(true);
    expect(completeCount(page)).toBe(1);
  });
});

describe('Profile intake: Step 2, the section button completes the step', () => {
  const expectComplete = async (page: Page) => {
    await waitFor(() => expect(lastSave(page)?.athletic_reviewed_at, 'the save did not complete Step 2').toBeTruthy());
    await waitFor(() => expect(completeCount(page), 'the screen does not show Step 2 complete').toBe(2));
    expect(page.queryByText(BUTTON), 'the button still asks to be tapped').toBeNull();
    expect(page.getAllByText(/Saved ✓/).length).toBeGreaterThan(0);
    await waitFor(() => expect(page.getByText(/Run Evaluation/), 'the evaluation is not offered').toBeTruthy());
    expectNoCrash(page);
  };

  it('straight after edits', async () => {
    const page = await openStep2(FULL);
    await editSquat(page, '410');
    fireEvent.click(page.getByText(BUTTON));
    await expectComplete(page);
  });

  it('after the pill saved first (the path that was stuck)', async () => {
    const page = await openStep2(FULL);
    await editSquat(page, '410');
    await tapPill(page);
    fireEvent.click(page.getByText(BUTTON));
    await expectComplete(page);
    expect(saves(page).length).toBe(2);
  });

  it('with nothing edited since the page opened', async () => {
    const page = await openStep2(FULL);
    fireEvent.click(page.getByText(BUTTON));
    await expectComplete(page);
  });

  it('blank core numbers: the dialog, then "that\'s everything I have" completes it', async () => {
    const page = await openStep2(SPARSE);
    fireEvent.click(page.getByText(BUTTON));
    await waitFor(() => expect(page.getByText('Some numbers are still blank')).toBeTruthy());
    expect(lastSave(page)).toBeUndefined();
    fireEvent.click(page.getByText(/that's everything I have/));
    await expectComplete(page);
    expect(page.queryByText('Some numbers are still blank')).toBeNull();
  });

  it('blank core numbers: "I\'ll add more later" saves and leaves the step open', async () => {
    const page = await openStep2(SPARSE);
    await editSquat(page, '410');
    fireEvent.click(page.getByText(BUTTON));
    await waitFor(() => expect(page.getByText('Some numbers are still blank')).toBeTruthy());
    fireEvent.click(page.getByText(/I'll add more later/));
    await waitFor(() => expect(lastSave(page)).toBeTruthy());
    expect(lastSave(page)?.athletic_reviewed_at ?? null).toBeNull();
    await waitFor(() => expect(page.queryByText('Some numbers are still blank')).toBeNull());
    expect(completeCount(page)).toBe(1);
    expect(page.getByText(BUTTON)).toBeTruthy();
  });

  it('after "I\'ll add more later", the pill, then the button and "everything I have": complete', async () => {
    const page = await openStep2(SPARSE);
    await editSquat(page, '410');
    fireEvent.click(page.getByText(BUTTON));
    fireEvent.click(await waitFor(() => page.getByText(/I'll add more later/)));
    await waitFor(() => expect(saves(page).length).toBe(1));
    await editSquat(page, '405');
    await tapPill(page);
    fireEvent.click(page.getByText(BUTTON));
    fireEvent.click(await waitFor(() => page.getByText(/that's everything I have/)));
    await expectComplete(page);
  });
});

describe('Profile intake: after Step 2 is complete', () => {
  it('a later edit saved with the pill keeps the step complete', async () => {
    const page = await openStep2({ ...FULL, athletic_reviewed_at: '2026-11-20T10:00:00.000Z' });
    expect(completeCount(page)).toBe(2);
    await editSquat(page, '410');
    await tapPill(page);
    expect(lastSave(page)?.athletic_reviewed_at).toBe('2026-11-20T10:00:00.000Z');
    await waitFor(() => expect(completeCount(page)).toBe(2));
    expect(page.getAllByText(/Saved ✓/).length).toBeGreaterThan(0);
  });
});

describe('Profile intake: a save that fails', () => {
  it('the section button: an error is shown and the step is not marked complete', async () => {
    const page = await openStep2(FULL);
    await editSquat(page, '410');
    page.fake.failUpserts.add('athlete_profiles');
    fireEvent.click(page.getByText(BUTTON));
    await waitFor(() => expect(page.getByText(/write refused/)).toBeTruthy());
    expect(completeCount(page)).toBe(1);
    expect(page.getByText(BUTTON)).toBeTruthy();
    // And it works on the next tap once saving works again.
    page.fake.failUpserts.clear();
    fireEvent.click(page.getByText(BUTTON));
    await waitFor(() => expect(completeCount(page)).toBe(2));
  });
});
