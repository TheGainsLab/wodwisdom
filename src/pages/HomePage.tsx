import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { MessageSquare, Trophy, Flame, Dumbbell, Apple, User, ChevronRight, Lock } from 'lucide-react';

/**
 * HomePage — the persistent landing at `/` (chat moved to `/chat`).
 *
 * One unified layout for everyone:
 *   - A context-aware primary card (the obvious next action given the user's
 *     profile / eval / program state; for a no-program user it leads with the
 *     free AI Coach trial).
 *   - A full tile grid. Free/owned surfaces are active; paid surfaces the user
 *     doesn't have render dimmed + locked and route to checkout. Coach (free
 *     trial), Athlete Data (free), and Profile are always active.
 */
export default function HomePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  const [navOpen, setNavOpen] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasEvaluation, setHasEvaluation] = useState(false);
  const [hasProgram, setHasProgram] = useState(false);
  const [hasCompetitionLink, setHasCompetitionLink] = useState(false);
  const [loading, setLoading] = useState(true);

  const hasProgramming = isAdmin || hasFeature('programming');
  const hasEngine = isAdmin || hasFeature('engine');
  const hasNutrition = isAdmin || hasFeature('nutrition');
  // Show the All Access bundle CTA to anyone missing at least one paid module
  // (hidden for all-access users + admin).
  const showAllAccess = !isAdmin && !(hasProgramming && hasEngine && hasNutrition);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [progRes, profileRes, evalRes] = await Promise.all([
          supabase.from('programs').select('id').eq('user_id', session.user.id).neq('committed', false).limit(1),
          supabase.from('athlete_profiles').select('lifts, skills, conditioning, competition_athlete_id').eq('user_id', session.user.id).maybeSingle(),
          supabase.from('profile_evaluations').select('id').eq('user_id', session.user.id).limit(1),
        ]);
        if (cancelled) return;
        if (profileRes.data) {
          const d = profileRes.data as { lifts?: Record<string, unknown>; skills?: Record<string, unknown>; conditioning?: Record<string, unknown>; competition_athlete_id?: string | null };
          const hasLifts = d.lifts && Object.values(d.lifts).some((v) => typeof v === 'number' && v > 0);
          const hasSkills = d.skills && Object.values(d.skills).some((v) => v && v !== 'none');
          const hasConditioning = d.conditioning && Object.values(d.conditioning).some((v) => !!v);
          setHasProfile(!!(hasLifts || hasSkills || hasConditioning));
          setHasCompetitionLink(!!d.competition_athlete_id);
        }
        setHasEvaluation(!!(evalRes.data && evalRes.data.length > 0));
        setHasProgram(!!(progRes.data && progRes.data.length > 0));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session.user.id]);

  // ── Context card: the single most relevant next action. ──
  const primary = (() => {
    if (hasProgramming && !hasProfile) {
      return { title: 'Set up your athlete profile', body: 'Add your lifts, skills, and benchmarks so the AI can build a program tailored to you.', cta: 'Go to Profile', to: '/profile' };
    }
    if (hasProgramming && !hasEvaluation) {
      return { title: 'Run your evaluation', body: 'Your profile is set up. Run your AI evaluation to unlock program generation.', cta: 'Go to Profile', to: '/profile' };
    }
    if (hasProgramming && !hasProgram) {
      return { title: 'Generate your program', body: 'Your evaluation is complete — head to your profile to generate your first program.', cta: 'Go to Profile', to: '/profile' };
    }
    if (hasProgram) {
      return { title: "Today's training", body: 'Pick up your program — view your calendar, start a session, and log your results.', cta: 'Open My Calendar', to: '/training-log' };
    }
    if (hasEngine) {
      return { title: 'Your Engine training', body: 'Jump into your Engine dashboard and log a session.', cta: 'Open Engine', to: '/engine' };
    }
    // Free / no program journey: when setup is incomplete, the "Make your AI
    // Coach personal" card below is the hero — don't stack a generic Coach card
    // on top of it. Once fully set up, show the plain Coach invite.
    if (!hasProfile || !hasCompetitionLink) return null;
    return { title: 'Ask the AI Coach', body: 'Get coaching answers from the full knowledge base — 3 free questions to start.', cta: 'Try the Coach', to: '/chat' };
  })();

  // ── Tiles. locked=true → dimmed + lock badge → routes to checkout for `plan`. ──
  const tiles: Array<{ key: string; label: string; sub: string; to: string; icon: React.ReactNode; locked: boolean; plan: string }> = [
    { key: 'coach', label: 'AI Coach', sub: 'Ask anything', to: '/chat', icon: <MessageSquare size={20} />, locked: false, plan: '' },
    { key: 'training', label: 'Training', sub: 'Programs & calendar', to: '/programs', icon: <Dumbbell size={20} />, locked: !hasProgramming, plan: 'programming' },
    { key: 'engine', label: 'Engine', sub: 'Year of the Engine', to: '/engine', icon: <Flame size={20} />, locked: !hasEngine, plan: 'engine' },
    { key: 'nutrition', label: 'Nutrition', sub: 'Log & track', to: '/nutrition', icon: <Apple size={20} />, locked: !hasNutrition, plan: 'nutrition' },
    { key: 'athletedata', label: 'Athlete Data', sub: 'Competition history', to: '/athletedata', icon: <Trophy size={20} />, locked: false, plan: '' },
    { key: 'profile', label: 'Profile', sub: 'Your athlete data', to: '/profile', icon: <User size={20} />, locked: false, plan: '' },
  ];

  const onTile = (t: { locked: boolean; plan: string; to: string }) =>
    t.locked ? navigate(`/checkout?plan=${t.plan}&interval=monthly`) : navigate(t.to);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Home</h1>
        </header>

        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {loading || entLoading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : (
              <>
                {primary && (
                  <button type="button" className="settings-card" style={{ textAlign: 'left', cursor: 'pointer', borderColor: 'var(--accent)' }} onClick={() => navigate(primary.to)}>
                    <h2 className="settings-card-title" style={{ marginBottom: 4, color: 'var(--text)' }}>{primary.title}</h2>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 14 }}>{primary.body}</div>
                    <span className="auth-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13 }}>
                      {primary.cta} <ChevronRight size={16} />
                    </span>
                  </button>
                )}

                {(!hasProfile || !hasCompetitionLink) && (
                  <div className="settings-card" style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <MessageSquare size={18} style={{ color: 'var(--accent)' }} />
                      <strong style={{ color: 'var(--text)', fontSize: 14 }}>Make your AI Coach personal</strong>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
                      {!hasProfile && !hasCompetitionLink
                        ? 'Complete your profile and link your competition history, and the Coach grounds its answers in your real numbers, results, and percentiles.'
                        : !hasProfile
                          ? 'Complete your profile and the Coach grounds its answers in your lifts, skills, and benchmarks.'
                          : 'Link your competition history and the Coach grounds its answers in your Open, Quarterfinals, and Games results.'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {!hasProfile && (
                        <button type="button" className="auth-btn" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => navigate('/profile')}>Complete profile</button>
                      )}
                      {!hasCompetitionLink && (
                        <button type="button" className="auth-btn" style={{ padding: '6px 14px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)' }} onClick={() => navigate('/athletedata')}>Link competition history</button>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-muted)', marginTop: 4 }}>Explore</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                  {[...tiles].sort((a, b) => Number(a.locked) - Number(b.locked)).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="settings-card"
                      style={{ textAlign: 'left', cursor: 'pointer', padding: 16, position: 'relative', opacity: t.locked ? 0.6 : 1 }}
                      onClick={() => onTile(t)}
                    >
                      {t.locked && <Lock size={14} style={{ position: 'absolute', top: 12, right: 12, color: 'var(--text-muted)' }} />}
                      <div style={{ color: t.locked ? 'var(--text-muted)' : 'var(--accent)', marginBottom: 8 }}>{t.icon}</div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{t.label}</div>
                      <div style={{ fontSize: 12, color: t.locked ? 'var(--accent)' : 'var(--text-dim)' }}>{t.locked ? 'Unlock →' : t.sub}</div>
                    </button>
                  ))}
                </div>

                {showAllAccess && (
                  <button
                    type="button"
                    className="settings-card"
                    style={{ textAlign: 'center', cursor: 'pointer', borderColor: 'var(--accent)' }}
                    onClick={() => navigate('/checkout?plan=all_access&interval=monthly')}
                  >
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>Get All Access</div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>AI Coach, Programming, Engine and Nutrition — everything in one plan.</div>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
