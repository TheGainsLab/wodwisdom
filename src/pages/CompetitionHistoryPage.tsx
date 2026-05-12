/**
 * CompetitionHistoryPage — the dedicated home for the Tier 4 competition-history
 * feature. Owns its own athlete_profiles fetch (the linkage + the user's age),
 * renders the full experience inside page chrome with the bottom tab bar still
 * visible (this is a child screen, not a takeover).
 *
 * Admin-gated for now (Phase B v1): non-admins are bounced to /profile. When
 * the feature goes GA this guard drops and the Tier 4 card on /profile becomes
 * the onboarding entry point.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import CompetitionHistoryExperience from '../components/competitionHistory/CompetitionHistoryExperience';

interface Linkage {
  id: string | null;
  label: string | null;
  photoUrl: string | null;
  bestFinish: string | null;
}

export default function CompetitionHistoryPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkage, setLinkage] = useState<Linkage>({ id: null, label: null, photoUrl: null, bestFinish: null });
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('athlete_profiles')
      .select('competition_athlete_id, competition_athlete_label, competition_athlete_photo_url, competition_athlete_best_finish, age')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const d = data as Record<string, unknown>;
          setLinkage({
            id: (d.competition_athlete_id as string | null) ?? null,
            label: (d.competition_athlete_label as string | null) ?? null,
            photoUrl: (d.competition_athlete_photo_url as string | null) ?? null,
            bestFinish: (d.competition_athlete_best_finish as string | null) ?? null,
          });
          const a = d.age == null ? NaN : Number(d.age);
          setAge(Number.isFinite(a) ? a : null);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.user.id]);

  // Admin-gate. Once entitlements have loaded, non-admins go back to /profile.
  useEffect(() => {
    if (!entLoading && !isAdmin) navigate('/profile', { replace: true });
  }, [entLoading, isAdmin, navigate]);

  const ready = !loading && !entLoading;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Competition History</h1>
        </header>
        <div className="page-body">
          {!ready ? (
            <div className="page-loading"><div className="loading-pulse" /></div>
          ) : !isAdmin ? null : (
            <CompetitionHistoryExperience
              userId={session.user.id}
              userAge={age}
              isAdmin={isAdmin}
              initialLinkedId={linkage.id}
              initialLinkedLabel={linkage.label}
              initialLinkedPhotoUrl={linkage.photoUrl}
              initialLinkedBestFinish={linkage.bestFinish}
              onLinkageChange={setLinkage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
