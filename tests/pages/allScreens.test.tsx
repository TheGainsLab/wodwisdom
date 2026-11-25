/**
 * Every member-facing screen is opened for every kind of member. A screen
 * that shows the error screen, or makes React report an error, fails here.
 * Run: npm run test:pages
 */
import { describe, it } from 'vitest';
import type { ReactElement } from 'react';
import { openPage, expectNoCrash, USER } from './harness';
import { programTables, P, type ProgramShape } from './fixtures';

import HomePage from '../../src/pages/HomePage';
import ChatPage from '../../src/pages/ChatPage';
import ProgramsListPage from '../../src/pages/ProgramsListPage';
import ProgramDetailPage from '../../src/pages/ProgramDetailPage';
import DayPage from '../../src/pages/DayPage';
import TrainingLogPage from '../../src/pages/TrainingLogPage';
import LogActivityPage from '../../src/pages/LogActivityPage';
import AthletePage from '../../src/pages/AthletePage';
import SettingsPage from '../../src/pages/SettingsPage';
import HistoryPage from '../../src/pages/HistoryPage';
import BookmarksPage from '../../src/pages/BookmarksPage';
import EngineDashboardPage from '../../src/pages/EngineDashboardPage';
import EngineTrainingDayPage from '../../src/pages/EngineTrainingDayPage';
import EngineTrainingDayReviewPage from '../../src/pages/EngineTrainingDayReviewPage';
import EngineAnalyticsPage from '../../src/pages/EngineAnalyticsPage';
import NutritionDashboardPage from '../../src/pages/NutritionDashboardPage';
import WorkoutReviewPage from '../../src/pages/WorkoutReviewPage';
import StartWorkoutPage from '../../src/pages/StartWorkoutPage';
import CheckoutCompletePage from '../../src/pages/CheckoutCompletePage';
import CheckoutPage from '../../src/pages/CheckoutPage';
import PricingPage from '../../src/pages/PricingPage';
import ProgramsFeaturePage from '../../src/pages/features/ProgramsFeaturePage';

const NEW_WEEKLY: ProgramShape = { weeks: [[1, 1, 'written'], [1, 2, 'outline'], [1, 3, 'outline'], [1, 4, 'outline']], loggedDays: [1], inProgressDay: 2, notes: true };

/** The kinds of member. `shape` null = no program. */
const MEMBERS: Array<{ name: string; features: string[]; shape: ProgramShape | null }> = [
  { name: 'Programming member with a new weekly program', features: ['programming', 'ai_chat', 'nutrition'], shape: NEW_WEEKLY },
  { name: 'All Access member with a program', features: ['programming', 'engine', 'ai_chat', 'nutrition', 'research_chat'], shape: NEW_WEEKLY },
  { name: 'Programming member with no program yet', features: ['programming', 'ai_chat', 'nutrition'], shape: null },
  { name: 'Engine-only member', features: ['engine', 'ai_chat', 'nutrition'], shape: null },
  { name: 'free member', features: [], shape: null },
];

type S = never;
const SCREENS: Array<{ name: string; path: string; route: string; el: (s: S) => ReactElement }> = [
  { name: 'Home', path: '/', route: '/', el: (s) => <HomePage session={s} /> },
  { name: 'Coach chat', path: '/chat', route: '/chat', el: (s) => <ChatPage session={s} /> },
  { name: 'Programs list', path: '/programs', route: '/programs', el: (s) => <ProgramsListPage session={s} /> },
  { name: 'Program', path: `/programs/${P}`, route: '/programs/:id', el: (s) => <ProgramDetailPage session={s} /> },
  { name: 'Program day', path: '/day/m1w1d1', route: '/day/:workoutId', el: (s) => <DayPage session={s} /> },
  { name: 'Training log', path: '/training-log', route: '/training-log', el: (s) => <TrainingLogPage session={s} /> },
  { name: 'Add external activity', path: '/log-activity', route: '/log-activity', el: (s) => <LogActivityPage session={s} /> },
  { name: 'Profile', path: '/profile', route: '/profile', el: (s) => <AthletePage session={s} /> },
  { name: 'Settings', path: '/settings', route: '/settings', el: (s) => <SettingsPage session={s} /> },
  { name: 'History', path: '/history', route: '/history', el: (s) => <HistoryPage session={s} /> },
  { name: 'Bookmarks', path: '/bookmarks', route: '/bookmarks', el: (s) => <BookmarksPage session={s} /> },
  { name: 'Engine dashboard', path: '/engine', route: '/engine', el: (s) => <EngineDashboardPage session={s} /> },
  { name: 'Engine day', path: '/engine/training/1', route: '/engine/training/:dayNumber', el: (s) => <EngineTrainingDayPage session={s} /> },
  { name: 'Engine day chat', path: '/engine/training/1/review', route: '/engine/training/:dayNumber/review', el: (s) => <EngineTrainingDayReviewPage session={s} /> },
  { name: 'Engine analytics', path: '/engine/analytics', route: '/engine/analytics', el: (s) => <EngineAnalyticsPage session={s} /> },
  { name: 'Nutrition', path: '/nutrition', route: '/nutrition', el: (s) => <NutritionDashboardPage session={s} /> },
  { name: 'Workout review', path: '/workout-review', route: '/workout-review', el: (s) => <WorkoutReviewPage session={s} /> },
  { name: 'Logger', path: '/workout/start', route: '/workout/start', el: (s) => <StartWorkoutPage session={s} /> },
  { name: 'Checkout', path: '/checkout?plan=programming', route: '/checkout', el: (s) => <CheckoutPage session={s} /> },
  { name: 'Checkout complete', path: '/checkout/complete', route: '/checkout/complete', el: () => <CheckoutCompletePage /> },
  { name: 'Pricing', path: '/pricing', route: '/pricing', el: () => <PricingPage signedIn /> },
  { name: 'Programming sales page', path: '/features/programs', route: '/features/programs', el: () => <ProgramsFeaturePage signedIn /> },
];

for (const m of MEMBERS) {
  describe(m.name, () => {
    for (const sc of SCREENS) {
      it(`${sc.name} opens`, async () => {
        const tables = m.shape ? programTables(m.shape, m.features) : { ...programTables({ weeks: [] as never }, m.features), programs: [], program_workouts: [], program_month_skeletons: [] };
        const page = await openPage({ data: { userId: USER, tables }, path: sc.path, route: sc.route, element: sc.el });
        expectNoCrash(page);
        if (process.env.SHOW_PAGES && m === MEMBERS[0]) console.log(`[${sc.name}] ${(page.container.textContent ?? '').replace(/\s+/g, ' ').slice(0, 260)}`);
      });
    }
  });
}
