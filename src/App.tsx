import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AuthPage from './pages/AuthPage';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';
import HistoryPage from './pages/HistoryPage';
import BookmarksPage from './pages/BookmarksPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import AthletePage from './pages/AthletePage';
import WorkoutReviewPage from './pages/WorkoutReviewPage';
import StartWorkoutPage from './pages/StartWorkoutPage';
import TrainingLogPage from './pages/TrainingLogPage';
import ProgramsListPage from './pages/ProgramsListPage';
import AddProgramPage from './pages/AddProgramPage';
import ProgramDetailPage from './pages/ProgramDetailPage';
import ProgramEditPage from './pages/ProgramEditPage';
import ProgramAnalysisPage from './pages/ProgramAnalysisPage';
import ProgramComparePage from './pages/ProgramComparePage';
import ProgramReviewPage from './pages/ProgramReviewPage';
import WorkoutAnalysisPage from './pages/WorkoutAnalysisPage';
import CheckoutPage from './pages/CheckoutPage';
import CheckoutCompletePage from './pages/CheckoutCompletePage';
import EngineDashboardPage from './pages/EngineDashboardPage';
import EngineTrainingDayPage from './pages/EngineTrainingDayPage';
import EngineAnalyticsPage from './pages/EngineAnalyticsPage';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        window.location.href = '/settings';
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="loading-screen"><div className="loading-pulse" /></div>;
  if (!session) return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );

  return (
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
      <Route path="/dashboard" element={<DashboardPage session={session} />} />
      <Route path="/bookmarks" element={<BookmarksPage session={session} />} />
      <Route path="/settings" element={<SettingsPage session={session} />} />
      <Route path="/profile" element={<AthletePage session={session} />} />
      <Route path="/admin" element={<AdminPage session={session} />} />
      <Route path="/engine" element={<EngineDashboardPage session={session} />} />
      <Route path="/engine/dashboard" element={<EngineDashboardPage session={session} />} />
      <Route path="/engine/training/:dayNumber" element={<EngineTrainingDayPage session={session} />} />
      <Route path="/engine/analytics" element={<EngineAnalyticsPage session={session} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
