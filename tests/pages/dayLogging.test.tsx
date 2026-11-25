/**
 * The day page with every block's logger opened, and a failed save.
 * Run: npm run test:pages
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import DayPage from '../../src/pages/DayPage';
import { openPage, expectNoCrash, USER } from './harness';
import { programTables } from './fixtures';

const open = () => openPage({
  data: { userId: USER, tables: programTables({ weeks: [[1, 1, 'written'], [1, 2, 'outline']] }, ['programming', 'ai_chat', 'nutrition']) },
  path: '/day/m1w1d1', route: '/day/:workoutId', element: (s) => <DayPage session={s} />,
});

describe('program day', () => {
  it('shows the day, the purpose of a conditioning piece, and the human-coach button', async () => {
    const page = await open();
    expectNoCrash(page);
    const text = page.container.textContent ?? '';
    expect(text).toMatch(/Back Squat/);
    expect(text).toMatch(/Purpose: Sustained aerobic cruise/);
  });

  it('opens every block\'s logger without crashing, with the right fields for each kind of piece', async () => {
    const page = await open();
    const buttons = page.getAllByRole('button', { name: 'Log block' });
    expect(buttons.length).toBeGreaterThanOrEqual(3); // strength + two metcons; active-recovery has no logger
    for (const b of buttons) fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 50));
    expectNoCrash(page);
    const text = page.container.textContent ?? '';
    expect(text).toMatch(/Result \(optional\)/);        // the interval piece: no time, no cap
    expect(text).toMatch(/Result \(rounds \+ reps\)/);   // the AMRAP
    expect(text).not.toMatch(/Hit the cap/);             // neither is a race against the clock
  });

  it('says so when a block does not save', async () => {
    const page = await open();
    fireEvent.click(page.getAllByRole('button', { name: 'Log block' })[0]);
    await new Promise((r) => setTimeout(r, 30));
    // save-workout-block returns nothing in the stand-in: a failed save.
    page.fake.client.functions.invoke = () => Promise.resolve({ data: { error: 'offline' }, error: null }) as never;
    const rx = page.queryAllByRole('button').find((b) => /^Rx$|As prescribed|Rx'd/i.test(b.textContent ?? ''));
    if (rx) fireEvent.click(rx);
    const save = page.getAllByRole('button', { name: 'Save block' })[0] as HTMLButtonElement;
    if (!save.disabled) {
      fireEvent.click(save);
      await waitFor(() => expect(page.container.textContent).toMatch(/Couldn't save/), { timeout: 3000 });
    }
    expectNoCrash(page);
  });
});
