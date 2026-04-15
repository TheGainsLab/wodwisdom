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

// Lazy-loaded — feature modules loaded on demand
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminUserDetailPage = lazy(() => import('./pages/AdminUserDetailPage'));
const AdminAthleteProfilePage = lazy(() => import('./pages/AdminAthleteProfilePage'));
const AthletePage = lazy(() => import('./pages/AthletePage'));
const WorkoutReviewPage = lazy(() => import('./pages/WorkoutReviewPage'));
const StartWorkoutPage = lazy(() => import('./pages/StartWorkoutPage'));
const TrainingLogPage = lazy(() => import('./pages/TrainingLogPage'));
const WorkoutAnalysisPage = lazy(() => import('./pages/WorkoutAnalysisPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const CheckoutCompletePage = lazy(() => import('./pages/CheckoutCompletePage'));

// Programs
const ProgramsListPage = lazy(() => import('./pages/ProgramsListPage'));
const AddProgramPage = lazy(() => import('./pages/AddProgramPage'));
const ProgramDetailPage = lazy(() => import('./pages/ProgramDetailPage'));
const ProgramEditPage = lazy(() => import('./pages/ProgramEditPage'));
const ProgramAnalysisPage = lazy(() => import('./pages/ProgramAnalysisPage'));
const ProgramComparePage = lazy(() => import('./pages/ProgramComparePage'));
const ProgramReviewPage = lazy(() => import('./pages/ProgramReviewPage'));

// Engine
const EngineDashboardPage = lazy(() => import('./pages/EngineDashboardPage'));
const EngineTrainingDayPage = lazy(() => import('./pages/EngineTrainingDayPage'));
const EngineAnalyticsPage = lazy(() => import('./pages/EngineAnalyticsPage'));
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      // Safety net: claim any pending subscription that matches this user's
      // email. Runs on every app load for logged-in users; no-op if nothing
      // to claim. Backs up the claim_pending_subscription trigger.
      if (session) {
        supabase.rpc('claim_my_pending_subscription').then(() => {}, () => {});
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
  const [profileChecked, setProfileChecked] = useState(false);
  const [hasProfile, setHasProfile] = useState(true);
  const hideTabBar = HIDE_TAB_BAR_ROUTES.some(r => location.pathname === r) ||
    location.pathname.startsWith('/features');

  useEffect(() => {
    supabase
      .from('athlete_profiles')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setHasProfile(!!data);
        setProfileChecked(true);
      });
  }, [session.user.id, location.pathname]);

  // Redirect new users to profile page (except if already there or on settings/checkout)
  const skipRedirect = ['/profile', '/settings', '/checkout', '/checkout/complete'];
  if (profileChecked && !hasProfile && !skipRedirect.includes(location.pathname)) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<ChatPage session={session} />} />
            <Route path="/workout-review" element={<WorkoutReviewPage session={session} />} />
            <Route path="/workout/start" element={<StartWorkoutPage session={session} />} />
            <Route path="/workout-analysis" element={<WorkoutAnalysisPage session={session} />} />
            <Route path="/training-log" element={<TrainingLogPage session={session} />} />
            <Route path="/programs" element={<ProgramsListPage session={session} />} />
            <Route path="/programs/new" element={<AddProgramPage session={session} />} />
            <Route path="/programs/:id/edit" element={<ProgramEditPage session={session} />} />
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
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="/admin/users/:id" element={<AdminUserDetailPage session={session} />} />
            <Route path="/admin/users/:id/athlete-profile" element={<AdminAthleteProfilePage session={session} />} />
            <Route path="/engine" element={<EngineDashboardPage session={session} />} />
            <Route path="/engine/dashboard" element={<EngineDashboardPage session={session} />} />
            <Route path="/engine/training/:dayNumber" element={<EngineTrainingDayPage session={session} />} />
            <Route path="/engine/analytics" element={<EngineAnalyticsPage session={session} />} />
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
