/**
 * The program page, opened in every state a member can be in.
 * Run: npm run test:pages
 */
import { describe, it, expect } from 'vitest';
import ProgramDetailPage from '../../src/pages/ProgramDetailPage';
import { openPage, expectNoCrash, USER } from './harness';
import { programTables, P, type ProgramShape } from './fixtures';

const open = (shape: ProgramShape, features = ['programming', 'ai_chat', 'nutrition']) =>
  openPage({
    data: { userId: USER, tables: programTables(shape, features) },
    path: `/programs/${P}`,
    route: '/programs/:id',
    element: (session) => <ProgramDetailPage session={session} />,
  });

describe('program page', () => {
  it('opens for a new weekly program: week 1 written, weeks 2-4 not yet (the 2026-11-24 crash)', async () => {
    const page = await open({ weeks: [[1, 1, 'written'], [1, 2, 'outline'], [1, 3, 'outline'], [1, 4, 'outline']] });
    expectNoCrash(page);
    expect(page.getAllByText(/Week 1/).length).toBeGreaterThan(0);
    expect(page.container.textContent).toMatch(/written when you've logged every day of week 1, or on .+ at the latest/i);
  });

  it('opens while a week is being written', async () => {
    const page = await open({ weeks: [[1, 1, 'written'], [1, 2, 'outline'], [1, 3, 'outline'], [1, 4, 'outline']], writing: [1, 2] });
    expectNoCrash(page);
    expect(page.container.textContent).toMatch(/being written now/i);
  });

  it('opens with every week written', async () => {
    const page = await open({ weeks: [[1, 1, 'written'], [1, 2, 'written'], [1, 3, 'written'], [1, 4, 'written']] });
    expectNoCrash(page);
    expect(page.container.textContent).not.toMatch(/This is a starting point/);
  });

  it('opens in month two with unwritten weeks, logged days, a day in progress and saved notes', async () => {
    const page = await open({
      weeks: [[1, 1, 'written'], [1, 2, 'written'], [1, 3, 'written'], [1, 4, 'written'], [2, 1, 'written'], [2, 2, 'outline'], [2, 3, 'outline'], [2, 4, 'outline']],
      loggedDays: [1, 2], inProgressDay: 3, notes: true,
    }, ['programming', 'engine', 'ai_chat', 'nutrition', 'research_chat']);
    expectNoCrash(page);
  });

  it('opens for an older program written a month at a time', async () => {
    const page = await open({ weekly: false, weeks: [[1, 1, 'written'], [1, 2, 'written'], [1, 3, 'written'], [1, 4, 'written']] });
    expectNoCrash(page);
  });

  it('opens for an archived program', async () => {
    const page = await open({ archived: true, weeks: [[1, 1, 'written'], [1, 2, 'outline'], [1, 3, 'outline'], [1, 4, 'outline']] });
    expectNoCrash(page);
  });

  it('opens when the program has no days at all', async () => {
    const page = await open({ weeks: [] as never });
    expectNoCrash(page);
  });
});
