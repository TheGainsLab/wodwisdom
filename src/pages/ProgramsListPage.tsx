import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { Plus, Zap, Brain, Calendar, BarChart3 } from 'lucide-react';

interface Program {
  id: string;
  name: string;
  created_at: string;
  source?: string;
  workout_count?: number;
  generated_months?: number;
  month_counts?: Record<number, number>;
}

export default function ProgramsListPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasEvaluation, setHasEvaluation] = useState(false);
  const { hasFeature, isAdmin } = useEntitlements(session.user.id);
  const hasEngine = hasFeature('engine');
  const hasProgramming = hasFeature('programming');

  useEffect(() => {
    loadAll();
  }, [session.user.id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [progData, profileRes, evalRes] = await Promise.all([
        supabase
          .from('programs')
          .select('id, name, created_at, source, generated_months, program_workouts(month_number)')
          .eq('user_id', session.user.id)
          .neq('committed', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('athlete_profiles')
          .select('lifts, skills, conditioning')
          .eq('user_id', session.user.id)
          .maybeSingle(),
        supabase
          .from('profile_evaluations')
          .select('id')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      // Check profile has meaningful data
      if (profileRes.data) {
        const d = profileRes.data;
        const hasLifts = d.lifts && Object.values(d.lifts).some((v: any) => v > 0);
        const hasSkills = d.skills && Object.values(d.skills).some((v: any) => v && v !== 'none');
        const hasConditioning = d.conditioning && Object.values(d.conditioning).some((v: any) => v);
        setHasProfile(!!(hasLifts || hasSkills || hasConditioning));
      }

      setHasEvaluation(!!(evalRes.data && evalRes.data.length > 0));

      if (progData.data) {
        setPrograms(progData.data.map((p: any) => {
          const rows: { month_number?: number }[] = p.program_workouts ?? [];
          const monthCounts: Record<number, number> = {};
          for (const r of rows) {
            const m = r.month_number ?? 1;
            monthCounts[m] = (monthCounts[m] ?? 0) + 1;
          }
          return {
            ...p,
            workout_count: rows.length,
            month_counts: monthCounts,
          };
        }));
      }
    } catch (err) {
      console.error('[ProgramsListPage] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, programId: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this program? This cannot be undone.')) return;
    const { error } = await supabase.from('programs').delete().eq('id', programId).eq('user_id', session.user.id);
    if (!error) setPrograms(prev => prev.filter(p => p.id !== programId));
  };

  const handleDeleteMonth = async (e: React.MouseEvent, programId: string, month: number) => {
    e.stopPropagation();
    if (!window.confirm(`Delete Month ${month}? This will remove all Month ${month} workouts and cannot be undone.`)) return;

    // Delete all workouts for this month
    const { error: wkErr } = await supabase
      .from('program_workouts')
      .delete()
      .eq('program_id', programId)
      .eq('month_number', month);
    if (wkErr) return;

    // Update generated_months to month - 1 (so next generation will produce this month again)
    await supabase
      .from('programs')
      .update({ generated_months: Math.max(month - 1, 1) })
      .eq('id', programId)
      .eq('user_id', session.user.id);

    // Refresh the list
    loadAll();
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>My Programs</h1>
        </header>
        <div className="page-body">
          <div className="programs-list-wrap">
            {/* My Calendar — schedule + log + launch (anyone with training access) */}
            {(hasProgramming || hasEngine || isAdmin) && (
              <div
                className="history-item"
                style={{ marginBottom: 16, cursor: 'pointer', borderLeft: '3px solid var(--accent)' }}
                onClick={() => navigate('/training-log')}
              >
                <div className="history-item-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Calendar size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span className="history-question">My Calendar</span>
                  <span className="history-time" style={{ marginLeft: 'auto' }}>Schedule &amp; log your training</span>
                </div>
              </div>
            )}

            {/* Analytics — progress dashboards (AI Programming only) */}
            {(hasProgramming || isAdmin) && (
              <div
                className="history-item"
                style={{ marginBottom: 16, cursor: 'pointer', borderLeft: '3px solid var(--accent)' }}
                onClick={() => navigate('/training-log?view=analytics')}
              >
                <div className="history-item-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <BarChart3 size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span className="history-question">Analytics</span>
                  <span className="history-time" style={{ marginLeft: 'auto' }}>Strength, metcons &amp; progress</span>
                </div>
              </div>
            )}

            {/* Engine card */}
            {hasEngine && (
              <div
                className="history-item"
                style={{ marginBottom: 16, cursor: 'pointer', borderLeft: '3px solid var(--accent)' }}
                onClick={() => navigate('/engine')}
              >
                <div className="history-item-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Zap size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span className="history-question">Year of the Engine</span>
                  <span className="history-time" style={{ marginLeft: 'auto' }}>720-day conditioning program</span>
                </div>
              </div>
            )}

            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : !hasProgramming ? (
              <div style={{
                textAlign: 'center',
                maxWidth: 480,
                margin: '0 auto',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 24,
              }}>
                {/* Hero */}
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'var(--accent-glow)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent)',
                  margin: '0 auto 16px',
                }}>
                  <Brain size={28} />
                </div>
                <p style={{ fontWeight: 700, fontSize: 20, marginBottom: 6 }}>AI Programming</p>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                  The program that follows you. AI builds a fully personalized training
                  program from your profile, adapts it as you train, and coaches you
                  through every session.
                </p>

                {/* Upgrade options */}
                {(() => {
                  const has = (f: string) => hasFeature(f);
                  const hasAnySub = has('ai_chat') || has('engine') || has('nutrition');

                  const options = [
                    { key: 'programming', name: 'AI Programming', price: '$29.99/mo',
                      includes: ['AI Coach', 'Nutrition', 'AI Programming'],
                      features: ['programming', 'ai_chat', 'nutrition'] },
                    { key: 'all_access', name: 'All Access', price: '$49.99/mo',
                      includes: ['AI Coach', 'Nutrition', 'AI Programming', 'Year of the Engine'],
                      features: ['ai_chat', 'programming', 'engine', 'nutrition'],
                      featured: true },
                  ].filter(opt => {
                    const curr = ['ai_chat', 'programming', 'engine', 'nutrition'].filter(f => has(f));
                    return curr.every(f => opt.features.includes(f)) && opt.features.some(f => !has(f));
                  });

                  const fMap: Record<string, string> = {
                    'AI Coach': 'ai_chat', 'Nutrition': 'nutrition',
                    'Year of the Engine': 'engine', 'AI Programming': 'programming',
                  };
                  const desc = (opt: typeof options[0], idx: number) => {
                    if (!hasAnySub) {
                      if (idx === 0) return opt.includes.join(' + ');
                      const prev = new Set(options[idx - 1].includes);
                      const added = opt.includes.filter(l => !prev.has(l));
                      if (added.length === 0) return opt.includes.join(' + ');
                      return 'Everything above + ' + added.join(' + ');
                    }
                    const kept = opt.includes.filter(l => fMap[l] && has(fMap[l]));
                    const gained = opt.includes.filter(l => !fMap[l] || !has(fMap[l]));
                    const parts: string[] = [];
                    if (kept.length > 0) parts.push('Keep ' + kept.join(', '));
                    if (gained.length > 0) parts.push('Add ' + gained.join(', '));
                    return parts.join(' · ');
                  };

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                      {options.map((opt, idx) => (
                        <button
                          key={opt.key}
                          className="auth-btn"
                          onClick={() => navigate(`/checkout?plan=${opt.key}&interval=monthly`)}
                          style={{ width: '100%', display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: 4,
                            border: opt.featured ? '2px solid var(--accent)' : undefined }}
                        >
                          <span style={{ fontWeight: 700 }}>{opt.name} — {opt.price}</span>
                          <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{desc(opt, idx)}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

                {/* Features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', marginBottom: 24 }}>
                  {[
                    'Personalized training based on your goals and fitness level',
                    'Comprehensive evaluations of fitness, training, and nutrition',
                    'Personalized coaching for every training session',
                    'AI updates your programs as you go',
                    'Comprehensive analytics to track all aspects of your performance',
                  ].map(text => (
                    <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-dim)' }}>
                      <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0 }}>&#10003;</span>
                      {text}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => navigate(-1 as any)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', marginTop: 12, fontFamily: 'inherit' }}
                >
                  Go Back
                </button>
              </div>
            ) : programs.length === 0 ? (
              <div className="empty-state">
                {!hasProfile ? (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Set up your athlete profile</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Add your lifts, skills, and benchmarks so the AI can build a program tailored to you.</p>
                    <button className="auth-btn" onClick={() => navigate('/profile')}>Go to Profile</button>
                  </>
                ) : !hasEvaluation ? (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Get your profile evaluated</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Your profile is set up. Run your AI evaluation on your profile to continue.</p>
                    <button className="auth-btn" onClick={() => navigate('/profile')}>Go to Evaluation</button>
                  </>
                ) : (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Your profile is ready</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Head to your profile to continue.</p>
                    <button className="auth-btn" onClick={() => navigate('/profile')}>Go to Profile</button>
                  </>
                )}
              </div>
            ) : (
              <div className="history-list">
                {[...programs].sort((a, b) => {
                  const aIsOwn = a.source !== 'external' ? 0 : 1;
                  const bIsOwn = b.source !== 'external' ? 0 : 1;
                  if (aIsOwn !== bIsOwn) return aIsOwn - bIsOwn;
                  return 0;
                }).flatMap(p => {
                  const isOwn = p.source !== 'external';
                  const isGenerated = p.source === 'generated';
                  // Expand into "Month N" cards from the months ACTUALLY present
                  // (a migrated v3 program may start at month 2, so we must not
                  // assume a contiguous 1..generated_months). A single month-1
                  // program renders as one card; a single month-N>1 (migration)
                  // still shows as "Month N".
                  const presentMonths = Object.keys(p.month_counts || {})
                    .map(Number)
                    .filter((m) => m >= 1)
                    .sort((a, b) => a - b);
                  const isMulti = isGenerated &&
                    (presentMonths.length > 1 || (presentMonths.length === 1 && presentMonths[0] > 1));
                  const months = isMulti ? [...presentMonths].reverse() : [0];

                  return months.map(month => {
                    const isMonthCard = month > 0;
                    const label = isMonthCard ? `Month ${month}` : p.name;
                    const count = isMonthCard ? (p.month_counts?.[month] ?? 0) : (p.workout_count ?? 0);
                    const workoutLabel = `${count} workout${count !== 1 ? 's' : ''}`;

                    return (
                      <div
                        key={isMonthCard ? `${p.id}-m${month}` : p.id}
                        className="history-item"
                        style={{ borderLeft: '3px solid var(--accent)' }}
                        onClick={() => navigate(isMonthCard ? `/programs/${p.id}?month=${month}` : `/programs/${p.id}`)}
                      >
                        <div className="history-item-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {isOwn && <Zap size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                          <span className="history-question">{label}</span>
                          <span className="history-time">{workoutLabel}</span>
                          <div className="program-list-actions" onClick={e => e.stopPropagation()}>
                            {(!isMonthCard || isAdmin) && (
                              <button
                                type="button"
                                className="program-list-btn program-list-btn-delete"
                                onClick={e => isMonthCard ? handleDeleteMonth(e, p.id, month) : handleDelete(e, p.id)}
                                title={isMonthCard ? `Delete Month ${month}` : 'Delete'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                              </button>
                            )}
                          </div>
                        </div>
                        {!isMonthCard && (
                          <div className="history-answer" style={{ padding: '8px 18px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
                            Created {formatDate(p.created_at)}
                          </div>
                        )}
                      </div>
                    );
                  });
                })}

                {/* Add Program button — admin only */}
                {isAdmin && (
                  <button
                    className="auth-btn"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '14px 16px', fontSize: 14, width: '100%', marginTop: 16 }}
                    onClick={() => navigate('/ailog/upload')}
                  >
                    <Plus size={16} /> Add Program
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

