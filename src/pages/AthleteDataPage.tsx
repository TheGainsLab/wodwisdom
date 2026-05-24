/**
 * AthleteDataPage — the dedicated home for the athlete-data surface (Tier 4
 * competition history + analytics). Owns its own athlete_profiles fetch (the
 * linkage + the user's age), renders the full experience inside page chrome
 * with the bottom tab bar still visible (this is a child screen, not a
 * takeover).
 *
 * Gated on the `athletedata` entitlement (plus admins). During the beta the
 * entitlement is hand-granted to a small allowlist; at GA a default-grant
 * trigger opens it to everyone.
 */

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import CompetitionHistoryExperience from '../components/competitionHistory/CompetitionHistoryExperience';

interface Linkage {
  id: string | null;
  label: string | null;
}

export default function AthleteDataPage({ session }: { session: Session }) {
  const { isAdmin, hasFeature, loading: entLoading } = useEntitlements(session.user.id);
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkage, setLinkage] = useState<Linkage>({ id: null, label: null });
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('athlete_profiles')
      .select('competition_athlete_id, competition_athlete_label, age')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const d = data as Record<string, unknown>;
          setLinkage({
            id: (d.competition_athlete_id as string | null) ?? null,
            label: (d.competition_athlete_label as string | null) ?? null,
          });
          const a = d.age == null ? NaN : Number(d.age);
          setAge(Number.isFinite(a) ? a : null);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.user.id]);

  // View tier is open to any authenticated user. The server-side gates on
  // search-competition-athletes and competition-catalog were also dropped;
  // verify-competition-athlete still enforces "linked athlete only (admins
  // bypass)" so the bundle endpoint isn't a public mirror.
  // Try-It (logging results against the cohort) is the paid action gate —
  // AI Programming, All-Access (both grant `programming`), or standalone
  // competition_log. Admins bypass for testing.
  const canLog = isAdmin || hasFeature('competition_log') || hasFeature('programming');

  const ready = !loading && !entLoading;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Athlete Data</h1>
        </header>
        <div className="page-body">
          {!ready ? (
            <div className="page-loading"><div className="loading-pulse" /></div>
          ) : (
            <CompetitionHistoryExperience
              userId={session.user.id}
              userAge={age}
              isAdmin={isAdmin}
              canLog={canLog}
              initialLinkedId={linkage.id}
              initialLinkedLabel={linkage.label}
              onLinkageChange={setLinkage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
