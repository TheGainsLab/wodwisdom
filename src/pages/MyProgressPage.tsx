import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import { useEntitlements } from '../hooks/useEntitlements';
import { MYPROGRESS_PUBLIC_TIER } from '../lib/featureFlags';
import {
  type AdherenceRow, type LiftProgress, type SkillVolume,
  AdherenceRowCard, LiftProgressCard, SkillVolumeCard,
} from '../components/progress/ProgressCards';

/**
 * My Progress (v1, Sep '26) — the AI Programming analytics page: the same
 * aggregates the admin user page has shown since May, self-scoped to the
 * signed-in athlete via the my_* RPC wrappers. Admin-gated behind
 * MYPROGRESS_PUBLIC_TIER for founder review; the RPCs themselves are safe
 * for all users (auth.uid()-scoped), so the flag flip is frontend-only.
 */

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--accent)', marginTop: 28, marginBottom: 12 }}>
      {children}
    </h3>
  );
}

interface EvalRow {
  id: string;
  month_number: number | null;
  created_at: string;
  analysis: string | null;
}

export default function MyProgressPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const { isAdmin, loading: entLoading } = useEntitlements();
  const [loading, setLoading] = useState(true);
  const [adherence, setAdherence] = useState<AdherenceRow[]>([]);
  const [lifts, setLifts] = useState<LiftProgress[]>([]);
  const [skills, setSkills] = useState<SkillVolume[]>([]);
  const [evals, setEvals] = useState<EvalRow[]>([]);
  const [logCounts, setLogCounts] = useState<{ total: number; last30: number } | null>(null);
  const [openEval, setOpenEval] = useState<string | null>(null);

  const hasAccess = isAdmin || MYPROGRESS_PUBLIC_TIER;

  useEffect(() => {
    if (!entLoading && !hasAccess) navigate('/programs', { replace: true });
  }, [entLoading, hasAccess, navigate]);

  useEffect(() => {
    if (entLoading || !hasAccess) return;
    (async () => {
      const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [adh, lp, sv, ev, totalLogs, recentLogs] = await Promise.all([
        supabase.rpc('my_adherence'),
        supabase.rpc('my_lift_progress', { days_back: 90 }),
        supabase.rpc('my_skill_volume', { days_back: 90 }),
        supabase
          .from('profile_evaluations')
          .select('id, month_number, created_at, analysis')
          .eq('user_id', session.user.id)
          .eq('visible', true)
          .eq('status', 'complete')
          .order('created_at', { ascending: false })
          .limit(24),
        supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id),
        supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id).gte('workout_date', cutoff30),
      ]);
      setAdherence((adh.data as AdherenceRow[]) ?? []);
      setLifts((lp.data as LiftProgress[]) ?? []);
      setSkills((sv.data as SkillVolume[]) ?? []);
      setEvals((ev.data as EvalRow[]) ?? []);
      setLogCounts({ total: totalLogs.count ?? 0, last30: recentLogs.count ?? 0 });
      setLoading(false);
    })();
  }, [entLoading, hasAccess, session.user.id]);

  const hasAnything = lifts.length > 0 || skills.length > 0 || adherence.length > 0 || (logCounts?.total ?? 0) > 0;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>My Progress</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {loading || entLoading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : !hasAnything ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                Your progress charts appear here as you log training — lift trends, skill volume, and your monthly evaluations, all built from what you actually do.
              </div>
            ) : (
              <>
                {/* Header stats */}
                {logCounts && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Workouts logged', value: logCounts.total },
                      { label: 'Last 30 days', value: logCounts.last30 },
                      { label: 'Evaluations', value: evals.length },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, minWidth: 120, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Strength */}
                {lifts.length > 0 && (
                  <>
                    <SectionHeader>Strength — last 90 days</SectionHeader>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {lifts.map(l => <LiftProgressCard key={l.lift_key} lift={l} />)}
                    </div>
                  </>
                )}

                {/* Skills */}
                {skills.length > 0 && (
                  <>
                    <SectionHeader>Skill volume — last 90 days</SectionHeader>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {skills.map(s => <SkillVolumeCard key={s.skill_key} skill={s} />)}
                    </div>
                  </>
                )}

                {/* Adherence per program */}
                {adherence.length > 0 && (
                  <>
                    <SectionHeader>Program adherence</SectionHeader>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {adherence.map(r => <AdherenceRowCard key={r.id} row={r} />)}
                    </div>
                  </>
                )}

                {/* Monthly reports */}
                {evals.length > 0 && (
                  <>
                    <SectionHeader>Monthly reports</SectionHeader>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                      {evals.map(e => (
                        <div key={e.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                          <button
                            onClick={() => setOpenEval(openEval === e.id ? null : e.id)}
                            style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: "'Outfit', sans-serif", fontSize: 13 }}
                          >
                            <span style={{ fontWeight: 500 }}>
                              {e.month_number != null ? `Month ${e.month_number} evaluation` : 'Evaluation'}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                              {new Date(e.created_at).toLocaleDateString()}
                            </span>
                          </button>
                          {openEval === e.id && e.analysis && (
                            <div style={{ padding: '0 16px 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                              {e.analysis}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
