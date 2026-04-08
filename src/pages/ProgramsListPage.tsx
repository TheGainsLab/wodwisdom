import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { Plus, Zap, User, Brain, Dumbbell, MessageSquare, RefreshCw, BarChart3 } from 'lucide-react';

interface Program {
  id: string;
  name: string;
  created_at: string;
  source?: string;
  workout_count?: number;
}

export default function ProgramsListPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasEvaluation, setHasEvaluation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const { hasFeature, isAdmin } = useEntitlements(session.user.id);
  const hasEngine = hasFeature('engine');
  const hasProgramming = hasFeature('programming');
  const hasOtherSub = !hasProgramming && (hasFeature('ai_chat') || hasFeature('engine') || hasFeature('nutrition'));

  useEffect(() => {
    loadAll();
  }, [session.user.id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [progData, profileRes, evalRes] = await Promise.all([
        supabase
          .from('programs')
          .select('id, name, created_at, source, program_workouts(count)')
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
        setPrograms(progData.data.map((p: any) => ({
          ...p,
          workout_count: p.program_workouts?.[0]?.count ?? 0,
        })));
      }
    } catch (err) {
      console.error('[ProgramsListPage] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError('');
    try {
      const { data, error } = await supabase.functions.invoke('generate-program', {
        body: {},
      });
      if (error) throw new Error(error.message || 'Failed to generate program');
      if (data?.error) throw new Error(data.error || 'Failed to generate program');
      const jobId = data?.job_id;
      if (!jobId) throw new Error('No job ID returned');

      let delay = 3000;
      const maxDelay = 8000;
      const maxAttempts = 80;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, delay));
        const { data: status, error: statusErr } = await supabase.functions.invoke('program-job-status', {
          body: { job_id: jobId },
        });
        if (statusErr) throw new Error(statusErr.message || 'Failed to check job status');
        if (status?.error && status?.status !== 'failed') throw new Error(status.error);

        if (status?.status === 'complete') {
          if (status.program_id) {
            navigate(`/programs/${status.program_id}`);
            return;
          }
          throw new Error('Program completed but no ID returned');
        }
        if (status?.status === 'failed') {
          throw new Error(status.error || 'Program generation failed');
        }
        delay = Math.min(delay + 1000, maxDelay);
      }
      throw new Error('Program generation timed out');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate program');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, programId: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this program? This cannot be undone.')) return;
    const { error } = await supabase.from('programs').delete().eq('id', programId).eq('user_id', session.user.id);
    if (!error) setPrograms(prev => prev.filter(p => p.id !== programId));
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

                {hasOtherSub && (
                  <p style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginBottom: 16 }}>
                    You have an active subscription — upgrade to All Access to add AI Programming.
                  </p>
                )}

                {/* Top CTA */}
                <button
                  className="auth-btn"
                  onClick={() => navigate('/checkout')}
                  style={{ width: '100%', marginBottom: 24 }}
                >
                  {hasOtherSub ? 'Upgrade to All Access — $49.99/mo' : 'Upgrade to AI Programming — $29.99/mo'}
                </button>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

                {/* How It Works */}
                <p style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 16 }}>
                  How It Works
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left', marginBottom: 24 }}>
                  {[
                    { step: '1', title: 'Build Your Profile', desc: 'Enter your lifts, skills, conditioning benchmarks, and goals' },
                    { step: '2', title: 'Get Your Evaluation', desc: 'AI analyzes your strengths, weaknesses, and priorities' },
                    { step: '3', title: 'Receive Your Program', desc: 'A custom training program built around your numbers and goals' },
                    { step: '4', title: 'Train & Adapt', desc: 'Log results, get coaching, and watch your program evolve' },
                  ].map(({ step, title, desc }) => (
                    <div key={step} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}>
                        {step}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

                {/* Features */}
                <p style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 16 }}>
                  What You Get
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left', marginBottom: 24 }}>
                  {([
                    [User, 'Personalized to You', 'Every workout built from your lifts, skills, and conditioning level'],
                    [Brain, 'AI Evaluation', 'Detailed analysis of your strengths, weaknesses, and priorities'],
                    [Dumbbell, 'Custom Programming', 'Training blocks designed for your numbers, equipment, and goals'],
                    [MessageSquare, 'Built-in Coaching', 'Training intent, movement cues, pacing strategy for every session'],
                    [RefreshCw, 'Adaptive Programs', 'Log results and the AI adjusts — flag weaknesses, increase challenges'],
                    [BarChart3, 'Training Analysis', 'Track progress over time with AI-powered training reviews'],
                  ] as const).map(([Icon, title, desc]) => (
                    <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'var(--surface2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <Icon size={16} style={{ color: 'var(--accent)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

                {/* Bottom CTA */}
                <button
                  className="auth-btn"
                  onClick={() => navigate('/checkout')}
                  style={{ width: '100%' }}
                >
                  {hasOtherSub ? 'Upgrade to All Access — $49.99/mo' : 'Upgrade to AI Programming — $29.99/mo'}
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
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Your profile is set up. Run an AI evaluation to unlock program generation.</p>
                    <button className="auth-btn" onClick={() => navigate('/profile')}>Go to Evaluation</button>
                  </>
                ) : (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Ready to generate your program</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Your evaluation is complete. Generate a personalized program based on your profile and analysis.</p>
                    {generateError && <div className="error-msg" style={{ marginBottom: 12 }}>{generateError}</div>}
                    <button className="auth-btn" onClick={handleGenerate} disabled={generating}>
                      {generating ? 'Generating...' : 'Generate Program'}
                    </button>
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
                }).map(p => {
                  const isOwn = p.source !== 'external';
                  return (
                  <div
                    key={p.id}
                    className="history-item"
                    style={{ borderLeft: '3px solid var(--accent)' }}
                    onClick={() => navigate(`/programs/${p.id}`)}
                  >
                    <div className="history-item-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {isOwn && <Zap size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                      <span className="history-question">{p.name}</span>
                      <span className="history-time">
                        {p.workout_count} workout{p.workout_count !== 1 ? 's' : ''}
                      </span>
                      <div className="program-list-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" className="program-list-btn" onClick={() => navigate(`/programs/${p.id}/edit`)} title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button type="button" className="program-list-btn program-list-btn-delete" onClick={e => handleDelete(e, p.id)} title="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="history-answer" style={{ padding: '8px 18px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
                      Created {formatDate(p.created_at)}
                    </div>
                  </div>
                  );
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
