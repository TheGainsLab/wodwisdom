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
      <Route path="/history" element={<HistoryPage session={session} />} />
      <Route path="/dashboard" element={<DashboardPage session={session} />} />
      <Route path="/bookmarks" element={<BookmarksPage session={session} />} />
      <Route path="/settings" element={<SettingsPage session={session} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
