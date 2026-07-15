import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import BottomTabBar from './components/BottomTabBar';
import InstallPrompt from './components/InstallPrompt';
import ErrorBoundary from './components/ErrorBoundary';

// Eagerly loaded — core pages users hit immediately
import AuthPage from './pages/AuthPage';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';
import HomePage from './pages/HomePage';

// Lazy-loaded — feature modules loaded on demand
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminUserDetailPage = lazy(() => import('./pages/AdminUserDetailPage'));
const AdminAthleteProfilePage = lazy(() => import('./pages/AdminAthleteProfilePage'));
const AdminAthleteModelPage = lazy(() => import('./pages/AdminAthleteModelPage'));
const AdminEvaluationsPage = lazy(() => import('./pages/AdminEvaluationsPage'));
const AdminEngineSessionsPage = lazy(() => import('./pages/AdminEngineSessionsPage'));
const AdminEngineSessionDetailPage = lazy(() => import('./pages/AdminEngineSessionDetailPage'));
const AdminEngineResequencePage = lazy(() => import('./pages/AdminEngineResequencePage'));
const AdminChatPage = lazy(() => import('./pages/AdminChatPage'));
const AdminUserTimelinePage = lazy(() => import('./pages/AdminUserTimelinePage'));
const AdminRatingsPage = lazy(() => import('./pages/AdminRatingsPage'));
const AdminWorkoutLogsPage = lazy(() => import('./pages/AdminWorkoutLogsPage'));
const AdminWorkoutLogDetailPage = lazy(() => import('./pages/AdminWorkoutLogDetailPage'));
const AdminProgramsPage = lazy(() => import('./pages/AdminProgramsPage'));
const AdminNutritionPage = lazy(() => import('./pages/AdminNutritionPage'));
const AthletePage = lazy(() => import('./pages/AthletePage'));
const AthleteDataPage = lazy(() => import('./pages/AthleteDataPage'));
const WorkoutReviewPage = lazy(() => import('./pages/WorkoutReviewPage'));
const StartWorkoutPage = lazy(() => import('./pages/StartWorkoutPage'));
const DayPage = lazy(() => import('./pages/DayPage'));
const TrainingLogPage = lazy(() => import('./pages/TrainingLogPage'));
const WorkoutAnalysisPage = lazy(() => import('./pages/WorkoutAnalysisPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const CheckoutCompletePage = lazy(() => import('./pages/CheckoutCompletePage'));
// REMOVED (Decision 11 class sweep): the Engine Class pages (F4/F5 leaderboard/TV/view,
// JoinEnginePage) are deleted — Engine Class is not a product. REMOVED (Decision 12a,
// Phase C): ClaimSeatPage + the claim flow — gym members live on their gym's member app
// and never hold a wodwisdom account. Both old link shapes get the dead-link stub below.

// A retired gym link (the pre-Decision-11 engine-join flow and the pre-Decision-12a
// /claim/:token seat claim). Members now sign into their GYM's member app — the gym
// issues that login link from its portal roster.
function RetiredInviteNotice() {
  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 0.5rem' }}>This link has been replaced</h1>
      <p style={{ opacity: 0.8 }}>
        Your gym now has its own member app. Ask your gym for a fresh app login link —
        they can issue one from their dashboard.
      </p>
    </div>
  );
}

// Programs
const ProgramsListPage = lazy(() => import('./pages/ProgramsListPage'));
const AddProgramPage = lazy(() => import('./pages/AddProgramPage'));
const ProgramDetailPage = lazy(() => import('./pages/ProgramDetailPage'));
const ProgramAnalysisPage = lazy(() => import('./pages/ProgramAnalysisPage'));
const ProgramComparePage = lazy(() => import('./pages/ProgramComparePage'));
const ProgramReviewPage = lazy(() => import('./pages/ProgramReviewPage'));

// Engine
const EngineDashboardPage = lazy(() => import('./pages/EngineDashboardPage'));
const EngineTrainingDayPage = lazy(() => import('./pages/EngineTrainingDayPage'));
const EngineTrainingDayReviewPage = lazy(() => import('./pages/EngineTrainingDayReviewPage'));
const EngineAnalyticsPage = lazy(() => import('./pages/EngineAnalyticsPage'));
const EngineLeaderboardPage = lazy(() => import('./pages/EngineLeaderboardPage'));
const EngineTaxonomyPage = lazy(() => import('./pages/EngineTaxonomyPage'));

// Nutrition
const NutritionDashboardPage = lazy(() => import('./pages/NutritionDashboardPage'));
const NutritionCalendarPage = lazy(() => import('./pages/NutritionCalendarPage'));

// AI Log
const AILogDashboardPage = lazy(() => import('./pages/AILogDashboardPage'));
const AILogUploadPage = lazy(() => import('./pages/AILogUploadPage'));
const AILogProgramPage = lazy(() => import('./pages/AILogProgramPage'));

// Feature landing pages
const FeaturesHubPage = lazy(() => import('./pages/features/FeaturesHubPage'));
const AICoachingFeaturePage = lazy(() => import('./pages/features/AICoachingFeaturePage'));
const ProgramsFeaturePage = lazy(() => import('./pages/features/ProgramsFeaturePage'));
const EngineFeaturePage = lazy(() => import('./pages/features/EngineFeaturePage'));
const NutritionFeaturePage = lazy(() => import('./pages/features/NutritionFeaturePage'));

function PageLoader() {
  return <div className="loading-screen"><div className="loading-pulse" /></div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const syncTimezone = (userId: string) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      supabase.from('profiles').update({ timezone: tz })
        .eq('id', userId).neq('timezone', tz)
        .then(() => {}, () => {});
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      // Safety net: claim any pending subscription that matches this user's
      // email. Runs on every app load for logged-in users; no-op if nothing
      // to claim. Backs up the claim_pending_subscription trigger.
      if (session) {
        supabase.rpc('claim_my_pending_subscription').then(() => {}, () => {});
        syncTimezone(session.user.id);
      }
    }).catch(() => {
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        window.location.href = '/settings';
      }
      // Safety net: try to claim any pending subscription on sign-in.
      if (event === 'SIGNED_IN' && session) {
        supabase.rpc('claim_my_pending_subscription').then(() => {}, () => {});
        syncTimezone(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <PageLoader />;
  if (!session) return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/features" element={<FeaturesHubPage />} />
          <Route path="/features/coaching" element={<AICoachingFeaturePage />} />
          <Route path="/features/programs" element={<ProgramsFeaturePage />} />
          <Route path="/features/engine" element={<EngineFeaturePage />} />
          <Route path="/features/nutrition" element={<NutritionFeaturePage />} />
          <Route path="/checkout/complete" element={<CheckoutCompletePage />} />
          {/* Dead-link stubs for the retired gym flows (Decisions 11 / 12a). */}
          <Route path="/join/engine/:token" element={<RetiredInviteNotice />} />
          <Route path="/claim/:token" element={<RetiredInviteNotice />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );

  return (
    <AuthenticatedApp session={session} />
  );
}

const HIDE_TAB_BAR_ROUTES = ['/workout/start', '/checkout', '/checkout/complete'];

function AuthenticatedApp({ session }: { session: Session }) {
  const location = useLocation();
  const hideTabBar = HIDE_TAB_BAR_ROUTES.some(r => location.pathname === r) ||
    location.pathname.startsWith('/features');

  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<HomePage session={session} />} />
            <Route path="/join/engine/:token" element={<RetiredInviteNotice />} />
            <Route path="/claim/:token" element={<RetiredInviteNotice />} />
            {/* REMOVED (Decision 11): the /gym, /gym/leaderboard, /tv/:token class surfaces are deleted. */}
            <Route path="/chat" element={<ChatPage session={session} />} />
            <Route path="/workout-review" element={<WorkoutReviewPage session={session} />} />
            <Route path="/workout/start" element={<StartWorkoutPage session={session} />} />
            <Route path="/day/:workoutId" element={<DayPage session={session} />} />
            <Route path="/workout-analysis" element={<WorkoutAnalysisPage session={session} />} />
            <Route path="/training-log" element={<TrainingLogPage session={session} />} />
            <Route path="/programs" element={<ProgramsListPage session={session} />} />
            <Route path="/programs/new" element={<AddProgramPage session={session} />} />
            <Route path="/programs/:id/analyze" element={<ProgramAnalysisPage session={session} />} />
            <Route path="/programs/:id/modify/:modificationId/compare" element={<ProgramComparePage session={session} />} />
            <Route path="/programs/:id/modify/:modificationId/review" element={<ProgramReviewPage session={session} />} />
            <Route path="/programs/:id" element={<ProgramDetailPage session={session} />} />
            <Route path="/checkout" element={<CheckoutPage session={session} />} />
            <Route path="/checkout/complete" element={<CheckoutCompletePage />} />
            <Route path="/history" element={<HistoryPage session={session} />} />
            <Route path="/bookmarks" element={<BookmarksPage session={session} />} />
            <Route path="/settings" element={<SettingsPage session={session} />} />
            <Route path="/profile" element={<AthletePage session={session} />} />
            <Route path="/athletedata" element={<AthleteDataPage session={session} />} />
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="/admin/ratings" element={<AdminRatingsPage session={session} />} />
            <Route path="/admin/users/:id" element={<AdminUserDetailPage session={session} />} />
            <Route path="/admin/users/:id/timeline" element={<AdminUserTimelinePage session={session} />} />
            <Route path="/admin/users/:id/athlete-profile" element={<AdminAthleteProfilePage session={session} />} />
            <Route path="/admin/users/:id/athlete-model" element={<AdminAthleteModelPage session={session} />} />
            <Route path="/admin/users/:id/evaluations" element={<AdminEvaluationsPage session={session} />} />
            <Route path="/admin/users/:id/evaluations/:evalType/:evalId" element={<AdminEvaluationsPage session={session} />} />
            <Route path="/admin/users/:id/engine-sessions" element={<AdminEngineSessionsPage session={session} />} />
            <Route path="/admin/users/:id/engine-sessions/:sessionId" element={<AdminEngineSessionDetailPage session={session} />} />
            <Route path="/admin/users/:id/engine-resequence" element={<AdminEngineResequencePage session={session} />} />
            <Route path="/admin/users/:id/chat" element={<AdminChatPage session={session} />} />
            <Route path="/admin/users/:id/workouts" element={<AdminWorkoutLogsPage session={session} />} />
            <Route path="/admin/users/:id/workouts/:workoutId" element={<AdminWorkoutLogDetailPage session={session} />} />
            <Route path="/admin/users/:id/programs" element={<AdminProgramsPage session={session} />} />
            <Route path="/admin/users/:id/programs/:programId" element={<AdminProgramsPage session={session} />} />
            <Route path="/admin/users/:id/nutrition" element={<AdminNutritionPage session={session} />} />
            <Route path="/engine" element={<EngineDashboardPage session={session} />} />
            <Route path="/engine/dashboard" element={<EngineDashboardPage session={session} />} />
            <Route path="/engine/training/:dayNumber" element={<EngineTrainingDayPage session={session} />} />
            <Route path="/engine/training/:dayNumber/review" element={<EngineTrainingDayReviewPage session={session} />} />
            <Route path="/engine/analytics" element={<EngineAnalyticsPage session={session} />} />
            <Route path="/engine/leaderboard" element={<EngineLeaderboardPage session={session} />} />
            <Route path="/engine/taxonomy" element={<EngineTaxonomyPage session={session} />} />
            <Route path="/nutrition" element={<NutritionDashboardPage session={session} />} />
            <Route path="/nutrition/calendar" element={<NutritionCalendarPage session={session} />} />
            <Route path="/ailog" element={<AILogDashboardPage session={session} />} />
            <Route path="/ailog/upload" element={<AILogUploadPage session={session} />} />
            <Route path="/ailog/:id" element={<AILogProgramPage session={session} />} />
            <Route path="/features" element={<FeaturesHubPage />} />
            <Route path="/features/coaching" element={<AICoachingFeaturePage />} />
            <Route path="/features/programs" element={<ProgramsFeaturePage />} />
            <Route path="/features/engine" element={<EngineFeaturePage />} />
            <Route path="/features/nutrition" element={<NutritionFeaturePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      {!hideTabBar && <BottomTabBar />}
      <InstallPrompt />
    </>
  );
}
