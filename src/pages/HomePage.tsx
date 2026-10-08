import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { MessageSquare, Trophy, Flame, Dumbbell, Apple, User, ChevronRight, Lock, Settings, Shield } from 'lucide-react';

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
  const { hasFeature, hasEngineAccess, isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  const [navOpen, setNavOpen] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasEvaluation, setHasEvaluation] = useState(false);
  const [hasProgram, setHasProgram] = useState(false);
  const [hasCompetitionLink, setHasCompetitionLink] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [loading, setLoading] = useState(true);

  const hasProgramming = isAdmin || hasFeature('programming');
  const hasEngine = hasEngineAccess;
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
          supabase.from('athlete_profiles').select('lifts, skills, conditioning, competition_athlete_id, programming_resume_pending_at').eq('user_id', session.user.id).maybeSingle(),
          supabase.from('profile_evaluations').select('id').eq('user_id', session.user.id).limit(1),
        ]);
        if (cancelled) return;
        if (profileRes.data) {
          const d = profileRes.data as { lifts?: Record<string, unknown>; skills?: Record<string, unknown>; conditioning?: Record<string, unknown>; competition_athlete_id?: string | null; programming_resume_pending_at?: string | null };
          setResumePending(!!d.programming_resume_pending_at);
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

  // ── Resident welcome card (2026-10-08): until the user's evaluation
  // exists, the hero is the same three-step story the /welcome screen told
  // — where you are, what each step costs, what you get. It suppresses the
  // other setup-nudge cards (one next-action per screen) and retires the
  // moment an evaluation exists. Buyers get their purchase acknowledged in
  // the headline; the CTA tracks their actual next step.
  const showWelcomeCard = !hasEvaluation && !resumePending;

  // ── Context card: the single most relevant next action. ──
  const primary = (() => {
    if (showWelcomeCard) return null; // the welcome card is the hero
    // Returner pause outranks everything: their paid month is waiting on them.
    if (resumePending && hasProgram) {
      return { title: 'Welcome back — build your next month', body: 'Your next training month is paid for and waiting. Review your numbers on your profile, then tap Build my next month.', cta: 'Review & build', to: '/profile' };
    }
    if (hasProgramming && !hasProgram) {
      return { title: "Alright, here's the fun part.", body: "What are you training for? A competition? A PR? Just feeling fitter? Tell the coach your goal and schedule, and it'll combine them with everything your evaluation found to build a program that actually fits you.", cta: 'Go to Profile', to: '/profile' };
    }
    if (hasProgram) {
      return { title: "Today's training", body: 'Pick up your program — view your calendar, start a session, and log your results.', cta: 'Open My Programs', to: '/programs' };
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
  // Every tile answers "what is this and why would I tap it" — including
  // the locked ones, which pitch the feature instead of just the padlock
  // (2026-10-08 onboarding pass: hand-holding at the resting-copy level).
  const tiles: Array<{ key: string; label: string; sub: string; to: string; icon: React.ReactNode; locked: boolean; plan: string; badge?: boolean; lockLabel?: string; lockTo?: string }> = [
    { key: 'coach', label: 'AI Coach', sub: 'Ask any training question — 3 free to start.', to: '/chat', icon: <MessageSquare size={20} />, locked: false, plan: '' },
    { key: 'training', label: 'AI Program', sub: 'A month of training built around your numbers and goals.', to: '/programs', icon: <Dumbbell size={20} />, locked: !hasProgramming, plan: 'programming' },
    { key: 'engine', label: 'Engine', sub: 'Daily conditioning paced from your own time trial.', to: '/engine', icon: <Flame size={20} />, locked: !hasEngine, plan: 'engine' },
    // Nutrition is NOT sold standalone — it rides along with Engine or AI
    // Programming (founder, 2026-10-08). Locked state says so and sends the
    // user to the plans page instead of a nutrition checkout.
    { key: 'nutrition', label: 'Nutrition', sub: 'Snap or type your meals; the AI tracks the macros.', to: '/nutrition', icon: <Apple size={20} />, locked: !hasNutrition, plan: '', lockLabel: 'Included with Engine or AI Programming →', lockTo: '/pricing' },
    { key: 'athletedata', label: 'Athlete Data', sub: 'Done the Open? Link it — free percentile breakdown.', to: '/athletedata', icon: <Trophy size={20} />, locked: false, plan: '' },
    // Pre-eval, the tile tells the truth about itself: a dot + "not
    // finished" (2026-10-08). The welcome card above says it loudly; the
    // dot covers the explorer who scrolled straight to the grid.
    {
      key: 'profile', label: 'Profile',
      sub: hasEvaluation ? 'Your numbers — they power everything.' : 'Not finished — pick up where you left off.',
      to: '/profile', icon: <User size={20} />, locked: false, plan: '', badge: !hasEvaluation,
    },
    { key: 'settings', label: 'Settings', sub: 'Billing, account & sign out.', to: '/settings', icon: <Settings size={20} />, locked: false, plan: '' },
    // Admin-only: the sidebar menu is awkward on mobile, so admins get a tile.
    ...(isAdmin ? [{ key: 'admin', label: 'Admin', sub: 'Users, reports & ops', to: '/admin', icon: <Shield size={20} />, locked: false, plan: '' }] : []),
  ];

  const onTile = (t: { locked: boolean; plan: string; to: string; lockTo?: string }) =>
    t.locked ? navigate(t.lockTo ?? `/checkout?plan=${t.plan}&interval=monthly`) : navigate(t.to);

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

                {/* Resident welcome card — the "explain it all" banner,
                    permanently installed until the evaluation exists. Same
                    three-beat story as /welcome, so by the second sighting
                    it's the user's mental model. */}
                {showWelcomeCard && (
                  <div className="settings-card" style={{ textAlign: 'left', borderColor: 'var(--accent)' }}>
                    <h2 className="settings-card-title" style={{ marginBottom: 12, color: 'var(--text)' }}>
                      {hasProgramming ? "Your program is paid for — let's build it" : 'Welcome — here\'s how The Gains Lab works'}
                    </h2>
                    {([
                      ['Your profile', 'about 5 minutes. Your lifts, skills, and times — estimates are OK, and whatever you skip stays out of the analysis.', hasProfile],
                      ['Your free AI evaluation', 'a candid read of your fitness: strengths, gaps, and an optimal training strategy. Yours to keep.', hasEvaluation],
                      [hasProgramming ? 'Train' : 'AI Coach',
                        hasProgramming
                          ? 'AI programming built around your numbers, goals, and schedule.'
                          : 'complete your profile and the answers are personalized to you.',
                        false],
                    ] as Array<[string, string, boolean]>).map(([t, b, done], i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                        <span aria-hidden style={{ flex: 'none', width: 20, height: 20, borderRadius: '50%', marginTop: 1, background: 'var(--surface2, #1d1d21)', border: '1px solid var(--border)', color: done ? '#2ec486' : 'var(--accent)', fontWeight: 800, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {done ? '✓' : i + 1}
                        </span>
                        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                          <strong style={{ color: 'var(--text)' }}>{t}</strong> — {b}
                        </span>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="auth-btn"
                      style={{ width: '100%', marginTop: 10, padding: '11px 0', fontSize: 14 }}
                      onClick={() => navigate('/profile')}
                    >
                      {hasProfile ? 'Run my evaluation →' : 'Start my profile →'}
                    </button>
                    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 9 }}>
                      Done the CrossFit Open?{' '}
                      <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/athletedata'); }} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: 0 }}>
                        Link your history
                      </button>{' '}
                      and step 2 gets sharper.
                    </div>
                  </div>
                )}

                {/* Post-eval link-history nudge (the welcome card covers this
                    pitch before the eval exists). */}
                {!showWelcomeCard && hasProfile && !hasCompetitionLink && (
                  <div className="settings-card" style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <MessageSquare size={18} style={{ color: 'var(--accent)' }} />
                      <strong style={{ color: 'var(--text)', fontSize: 14 }}>Make your AI Coach personal</strong>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
                      Link your competition history and the Coach grounds its answers in your Open, Quarterfinals, and Games results.
                    </div>
                    <button type="button" className="auth-btn" style={{ padding: '6px 14px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)' }} onClick={() => navigate('/athletedata')}>Link competition history</button>
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
                      {t.badge && !t.locked && <span aria-hidden style={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
                      <div style={{ color: t.locked ? 'var(--text-muted)' : 'var(--accent)', marginBottom: 8 }}>{t.icon}</div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{t.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t.sub}</div>
                      {t.locked && <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>{t.lockLabel ?? 'Unlock →'}</div>}
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
