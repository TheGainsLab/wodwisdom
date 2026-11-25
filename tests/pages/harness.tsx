/**
 * Opens one page the way the app does: inside the router and the member's
 * access, with a stand-in database. A crash anywhere in the page is caught by
 * the app's own ErrorBoundary; `expectNoCrash` fails the test on it and on
 * any error React reported.
 */
import { render, waitFor, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import ErrorBoundary from '../../src/components/ErrorBoundary';
import { EntitlementsProvider } from '../../src/hooks/useEntitlements';
import { fakeSupabase, type FakeData } from './fakeSupabase';

import { holder } from './holder';

export { USER } from './ids';
import { USER } from './ids';
export const sessionOf = (fake: ReturnType<typeof fakeSupabase>) => fake.session as never;

/** A member's access rows. */
export const access = (...features: string[]) => features.map((feature, i) => ({ id: `e${i}`, user_id: USER, feature, source: 'admin', expires_at: null }));

export interface Opened extends RenderResult { errors: string[]; fake: ReturnType<typeof fakeSupabase> }

export async function openPage(opts: { data: FakeData; path: string; route: string; element: (session: never) => ReactElement }): Promise<Opened> {
  const fake = fakeSupabase(opts.data);
  holder.fake = fake;
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    const text = a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : '')).join(' ');
    // React reports a crash through console.error before the boundary shows.
    if (/before initialization|is not defined|is not a function|Cannot read prop|ErrorBoundary|The above error occurred|Uncaught/.test(text)) errors.push(text.slice(0, 300));
  });
  const view = render(
    <MemoryRouter initialEntries={[opts.path]}>
      <EntitlementsProvider userId={opts.data.userId}>
        <ErrorBoundary>
          <Routes>
            <Route path={opts.route} element={opts.element(sessionOf(fake))} />
            <Route path="*" element={<div>navigated away</div>} />
          </Routes>
        </ErrorBoundary>
      </EntitlementsProvider>
    </MemoryRouter>,
  );
  // Let the page's data loads and the re-renders they cause all happen.
  await waitFor(() => expect(document.querySelector('.loading-pulse')).toBeNull(), { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  spy.mockRestore();
  return Object.assign(view, { errors, fake });
}

export function expectNoCrash(page: Opened) {
  expect(page.queryByText('Something went wrong'), 'the page showed the error screen').toBeNull();
  expect(page.errors, 'React reported an error while rendering').toEqual([]);
}
