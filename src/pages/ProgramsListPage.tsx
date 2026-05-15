import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { Plus, Zap, Brain, ClipboardList } from 'lucide-react';
import { WriterPayloadDetails } from '../components/admin/WriterPayloadDetails';

interface Program {
  id: string;
  name: string;
  created_at: string;
  source?: string;
  workout_count?: number;
  generated_months?: number;
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
  // v2 admin testing state — Phase 1 only, gated on isAdmin.
  const [generatingV2, setGeneratingV2] = useState(false);
  const [v2Error, setV2Error] = useState('');
  const [v2Output, setV2Output] = useState<unknown>(null);
  const [v2ProgramId, setV2ProgramId] = useState<string | null>(null);
  const [v2Elapsed, setV2Elapsed] = useState<number | null>(null);
  const [v2Safety, setV2Safety] = useState<{ safe: boolean; reasoning: string; errored: boolean } | null>(null);
  const [v2Payload, setV2Payload] = useState<unknown>(null);
  // Compare-mode state: triggers both v1 + v2 in parallel; v2 renders
  // inline (above), v1 surfaces a link to its dedicated program page
  // when complete so admin can read both side-by-side across tabs.
  const [comparing, setComparing] = useState(false);
  const [compareV1Status, setCompareV1Status] = useState<'idle' | 'running' | 'ready' | 'failed'>('idle');
  const [compareV1ProgramId, setCompareV1ProgramId] = useState<string | null>(null);
  const [compareV1Error, setCompareV1Error] = useState('');
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
          .select('id, name, created_at, source, generated_months, program_workouts(count)')
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

  // Admin-only Phase 1 v2 generator. Single-shot, no job polling — the
  // edge fn returns the full structured output synchronously.
  const handleGenerateV2 = async () => {
    setGeneratingV2(true);
    setV2Error('');
    setV2Output(null);
    setV2ProgramId(null);
    setV2Elapsed(null);
    setV2Safety(null);
    setV2Payload(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-program-v2', {
        body: {},
      });
      if (error) throw new Error(error.message || 'Failed to generate v2 program');
      if (data?.error) throw new Error(data.message || data.error);
      if (!data?.ok || !data?.output) throw new Error('Unexpected v2 response shape');
      setV2Output(data.output);
      setV2ProgramId(data.program_id ?? null);
      setV2Elapsed(data.elapsed_ms ?? null);
      setV2Safety(data.safety ?? null);
      setV2Payload(data.payload ?? null);
    } catch (err) {
      setV2Error(err instanceof Error ? err.message : 'Failed to generate v2 program');
    } finally {
      setGeneratingV2(false);
    }
  };

  // Admin compare-mode: kick off v1 + v2 in parallel.
  // v2 renders inline via V2OutputPanel. v1 polls its async job and
  // surfaces a link to its dedicated program page when ready (admin
  // opens in a new tab and compares visually against v2).
  const handleCompare = async () => {
    setComparing(true);
    setCompareV1Error('');
    setCompareV1Status('idle');
    setCompareV1ProgramId(null);
    setV2Error('');
    setV2Output(null);
    setV2ProgramId(null);
    setV2Elapsed(null);
    setV2Safety(null);
    setV2Payload(null);

    // v1 path — same logic as handleGenerate but doesn't navigate.
    const v1Promise = (async () => {
      setCompareV1Status('running');
      try {
        const { data, error } = await supabase.functions.invoke('generate-program', { body: {} });
        if (error) throw new Error(error.message || 'v1 failed');
        if (data?.error) throw new Error(data.error);
        const jobId = data?.job_id;
        if (!jobId) throw new Error('v1: no job ID');
        let delay = 3000;
        for (let i = 0; i < 80; i++) {
          await new Promise((r) => setTimeout(r, delay));
          const { data: status, error: statusErr } = await supabase.functions.invoke('program-job-status', {
            body: { job_id: jobId },
          });
          if (statusErr) throw new Error(statusErr.message || 'v1: status check failed');
          if (status?.error && status?.status !== 'failed') throw new Error(status.error);
          if (status?.status === 'complete') {
            if (status.program_id) {
              setCompareV1ProgramId(status.program_id);
              setCompareV1Status('ready');
              return;
            }
            throw new Error('v1: complete but no program_id');
          }
          if (status?.status === 'failed') throw new Error(status.error || 'v1: generation failed');
          delay = Math.min(delay + 1000, 8000);
        }
        throw new Error('v1: timed out');
      } catch (err) {
        setCompareV1Error(err instanceof Error ? err.message : 'v1 failed');
        setCompareV1Status('failed');
      }
    })();

    // v2 path — synchronous edge fn call.
    const v2Promise = (async () => {
      setGeneratingV2(true);
      try {
        const { data, error } = await supabase.functions.invoke('generate-program-v2', { body: {} });
        if (error) throw new Error(error.message || 'v2 failed');
        if (data?.error) throw new Error(data.message || data.error);
        if (!data?.ok || !data?.output) throw new Error('v2: unexpected response');
        setV2Output(data.output);
        setV2ProgramId(data.program_id ?? null);
        setV2Elapsed(data.elapsed_ms ?? null);
        setV2Safety(data.safety ?? null);
        setV2Payload(data.payload ?? null);
      } catch (err) {
        setV2Error(err instanceof Error ? err.message : 'v2 failed');
      } finally {
        setGeneratingV2(false);
      }
    })();

    // Don't await both — each updates its own state independently.
    // Single Promise.all just keeps the comparing flag accurate.
    await Promise.allSettled([v1Promise, v2Promise]);
    setComparing(false);
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
            {/* View Training Log button — for paid users who have programs */}
            {(hasProgramming || hasEngine || isAdmin) && (
              <button
                type="button"
                onClick={() => navigate('/training-log')}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 16px',
                  marginBottom: 16,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  color: 'var(--text)',
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <ClipboardList size={16} style={{ color: 'var(--accent)' }} />
                View Training Log
              </button>
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
                    {isAdmin && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
                        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                          Admin · Phase 1 v2 testing
                        </p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            className="auth-btn"
                            onClick={handleGenerateV2}
                            disabled={generatingV2 || comparing}
                            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', flex: '1 1 auto' }}
                          >
                            {generatingV2 && !comparing ? 'Generating v2…' : 'Generate (v2)'}
                          </button>
                          <button
                            className="auth-btn"
                            onClick={handleCompare}
                            disabled={comparing || generatingV2}
                            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', flex: '1 1 auto' }}
                          >
                            {comparing ? 'Comparing…' : 'Compare v1 vs v2'}
                          </button>
                        </div>
                        {(comparing || compareV1Status !== 'idle' || compareV1Error) && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 8,
                              background: 'var(--surface2)',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              fontSize: 12,
                              color: 'var(--text-dim)',
                            }}
                          >
                            <strong style={{ color: 'var(--text)' }}>v1 status: </strong>
                            {compareV1Status === 'running' && 'generating (async job)…'}
                            {compareV1Status === 'ready' && (
                              <>
                                ready —{' '}
                                <a
                                  href={`/programs/${compareV1ProgramId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: 'var(--accent)' }}
                                >
                                  open in new tab →
                                </a>
                              </>
                            )}
                            {compareV1Status === 'failed' && (
                              <span style={{ color: 'var(--err, #c33)' }}>failed: {compareV1Error}</span>
                            )}
                            {compareV1Status === 'idle' && comparing && 'starting…'}
                          </div>
                        )}
                        {v2Error && <div className="error-msg" style={{ marginTop: 12 }}>{v2Error}</div>}
                        {v2Output != null && (
                          <V2OutputPanel
                            output={v2Output}
                            programId={v2ProgramId}
                            elapsedMs={v2Elapsed}
                            safety={v2Safety}
                            payload={v2Payload}
                          />
                        )}
                      </div>
                    )}
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
                  const months = isGenerated && (p.generated_months || 1) > 1
                    ? Array.from({ length: p.generated_months || 1 }, (_, i) => i + 1).reverse()
                    : [0]; // 0 = show as single program (non-generated or single month)

                  return months.map(month => {
                    const isMonthCard = month > 0;
                    const label = isMonthCard ? `Month ${month}` : p.name;
                    const workoutsPerMonth = 20;
                    const workoutLabel = isMonthCard
                      ? `${workoutsPerMonth} workouts`
                      : `${p.workout_count} workout${p.workout_count !== 1 ? 's' : ''}`;

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
                            <button type="button" className="program-list-btn" onClick={() => navigate(isMonthCard ? `/programs/${p.id}/edit?month=${month}` : `/programs/${p.id}/edit`)} title="Edit">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
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

// ============================================================
// V2 admin output panel — Phase 1 only. Renders the structured
// WriterOutput inline so the admin can inspect quality before
// formal UI rendering is built. Plain typography, no styling
// commitment — Phase 1 deliverable is "can you read the program."
// ============================================================

interface V2OutputPanelProps {
  output: unknown;
  programId: string | null;
  elapsedMs: number | null;
  safety: { safe: boolean; reasoning: string; errored: boolean } | null;
  payload: unknown;
}

interface V2Movement {
  movement: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weight_unit?: string;
  rpe?: number;
  time_seconds?: number;
  distance?: number;
  distance_unit?: string;
  scaling_note?: string;
}

interface V2Block {
  block_type: string;
  block_label?: string;
  block_scheme?: string;
  time_cap_seconds?: number;
  block_notes?: string;
  movements: V2Movement[];
}

interface V2Day {
  day_num: number;
  blocks: V2Block[];
}

interface V2Week {
  week_num: number;
  days: V2Day[];
}

interface V2Output {
  month_plan: {
    weekly_intent: string[];
    strength_progression: string;
    deload_placement: string;
    programming_priorities?: string;
  };
  weeks: V2Week[];
}

function formatMovementLine(m: V2Movement): string {
  const parts: string[] = [];
  if (m.sets != null && m.reps != null) parts.push(`${m.sets}×${m.reps}`);
  else if (m.sets != null) parts.push(`${m.sets} sets`);
  else if (m.reps != null) parts.push(`${m.reps} reps`);
  if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? ''}`);
  if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
  if (m.time_seconds != null) parts.push(`${m.time_seconds}s`);
  if (m.distance != null) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
  const scheme = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
  const scaling = m.scaling_note ? ` (${m.scaling_note})` : '';
  return `${m.movement}${scheme}${scaling}`;
}

function V2OutputPanel({ output, programId, elapsedMs, safety, payload }: V2OutputPanelProps) {
  const out = output as V2Output;
  const headerStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, color: 'var(--text)', marginTop: 12 };
  const subHeaderStyle: React.CSSProperties = { fontWeight: 600, fontSize: 12, color: 'var(--text-dim)', marginTop: 8 };
  const bodyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text)', marginTop: 4, whiteSpace: 'pre-wrap' };

  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        textAlign: 'left',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
        {elapsedMs != null && <>Generated in {(elapsedMs / 1000).toFixed(1)}s</>}
        {programId && <> · program_id: {programId.slice(0, 8)}…</>}
        {safety && (
          <>
            {' · '}safety: {safety.safe ? 'OK' : 'UNSAFE'}
            {safety.errored && ' (errored)'}
          </>
        )}
      </div>
      {safety && !safety.safe && (
        <div style={{ marginTop: 4, padding: 8, background: 'rgba(255, 0, 0, 0.06)', borderRadius: 4, fontSize: 11 }}>
          {safety.reasoning}
        </div>
      )}

      <div style={headerStyle}>Month plan</div>
      <div style={bodyStyle}>
        Weekly intent: {out.month_plan.weekly_intent.map((w, i) => `W${i + 1}: ${w}`).join(' · ')}
        {'\n\n'}Progression: {out.month_plan.strength_progression}
        {'\n\n'}Deload: {out.month_plan.deload_placement}
        {out.month_plan.programming_priorities && (
          <>
            {'\n\n'}Priorities: {out.month_plan.programming_priorities}
          </>
        )}
      </div>

      {payload != null && <WriterPayloadDetails payload={payload} />}

      {out.weeks.map((week) => (
        <div key={week.week_num}>
          <div style={headerStyle}>Week {week.week_num}</div>
          {week.days.map((day) => (
            <div key={day.day_num} style={{ marginLeft: 12, marginTop: 8 }}>
              <div style={subHeaderStyle}>Day {day.day_num}</div>
              {day.blocks.map((block, bi) => (
                <div key={bi} style={{ marginLeft: 12, marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                    {block.block_type}
                    {block.block_label && <> — {block.block_label}</>}
                    {block.block_scheme && <> — {block.block_scheme}</>}
                    {block.time_cap_seconds && <> — cap {Math.round(block.time_cap_seconds / 60)} min</>}
                  </div>
                  {block.block_notes && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{block.block_notes}</div>
                  )}
                  <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12 }}>
                    {block.movements.map((m, mi) => (
                      <li key={mi} style={{ marginBottom: 2 }}>{formatMovementLine(m)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
