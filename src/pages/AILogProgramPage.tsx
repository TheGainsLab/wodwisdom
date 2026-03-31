import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Dumbbell, Play, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import '../ailog.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const AILOG_GAP_ENDPOINT = SUPABASE_BASE + '/functions/v1/ailog-gap-analysis';
const AILOG_SUPPLEMENT_ENDPOINT = SUPABASE_BASE + '/functions/v1/ailog-generate-supplement';

interface GapFinding {
  category: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

interface SupplementSession {
  title: string;
  focus: string;
  estimated_minutes: number;
  workout_text: string;
}

interface WorkoutItem {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}

interface ProgramData {
  id: string;
  name: string;
  gym_name: string | null;
  is_ongoing: boolean;
  source: string;
  created_at: string;
  committed: boolean;
}

interface AnalysisData {
  modal_balance: Record<string, number>;
  time_domains: Record<string, number>;
  movement_frequency: { name: string; count: number; modality: string }[];
  not_programmed: Record<string, string[]>;
  notices: string[];
}

export default function AILogProgramPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  const [navOpen, setNavOpen] = useState(false);
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [workoutCount, setWorkoutCount] = useState(0);
  const [showWorkouts, setShowWorkouts] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [gaps, setGaps] = useState<GapFinding[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [supplements, setSupplements] = useState<SupplementSession[]>([]);
  const [generatingSupplements, setGeneratingSupplements] = useState(false);
  const [showAllMovements, setShowAllMovements] = useState(false);
  const [committing, setCommitting] = useState(false);

  const isDraft = program ? !program.committed : true;

  if (!entLoading && !isAdmin) {
    navigate('/programs');
    return null;
  }

  const commitProgram = async () => {
    if (!id || !program || committing) return;
    setCommitting(true);
    try {
      const { error } = await supabase
        .from('programs')
        .update({ committed: true })
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (error) throw error;
      setProgram({ ...program, committed: true });
      navigate('/programs');
    } catch (err) {
      console.error('Commit failed:', err);
      setCommitting(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [progRes, workoutsRes, analysisRes] = await Promise.all([
        supabase.from('programs').select('id, name, gym_name, is_ongoing, source, created_at, committed').eq('id', id).single(),
        supabase.from('program_workouts').select('id, week_num, day_num, workout_text, sort_order').eq('program_id', id).order('sort_order'),
        supabase.from('program_analyses').select('*').eq('program_id', id).maybeSingle(),
      ]);
      if (progRes.data) setProgram(progRes.data as ProgramData);
      if (workoutsRes.data) {
        setWorkouts(workoutsRes.data as WorkoutItem[]);
        setWorkoutCount(workoutsRes.data.length);
      }
      if (analysisRes.data) {
        setAnalysis(analysisRes.data as AnalysisData);
        if (analysisRes.data.gaps) setGaps(analysisRes.data.gaps as GapFinding[]);
        if (analysisRes.data.gap_summary) setSummary(analysisRes.data.gap_summary as string);
      }
      setLoading(false);
    })();
  }, [id]);

  const runAnalysis = async () => {
    if (!id) return;
    setAnalyzing(true);
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const res = await fetch(AILOG_GAP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s?.access_token}`,
        },
        body: JSON.stringify({ program_id: id }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysis(data.analysis);
        setGaps(data.gaps || []);
        setSummary(data.summary || null);
      }
    } catch {
      // silently degrade
    }
    setAnalyzing(false);
  };

  const generateSupplements = async () => {
    if (gaps.length === 0) return;
    setGeneratingSupplements(true);
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      // Build a simple profile summary
      const { data: profile } = await supabase
        .from('athlete_profiles')
        .select('lifts, skills, conditioning, bodyweight, gender')
        .eq('user_id', session.user.id)
        .maybeSingle();

      const parts: string[] = [];
      if (profile?.gender) parts.push(`Gender: ${profile.gender}`);
      if (profile?.bodyweight) parts.push(`Bodyweight: ${profile.bodyweight}`);
      if (profile?.lifts) {
        const lifts = Object.entries(profile.lifts as Record<string, number>)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
          .join(', ');
        if (lifts) parts.push(`Lifts: ${lifts}`);
      }
      if (profile?.skills) {
        const skills = Object.entries(profile.skills as Record<string, string>)
          .filter(([, v]) => v && v !== 'none')
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
          .join(', ');
        if (skills) parts.push(`Skills: ${skills}`);
      }

      const res = await fetch(AILOG_SUPPLEMENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s?.access_token}`,
        },
        body: JSON.stringify({
          gaps,
          profile_summary: parts.join('\n'),
        }),
      });
      const data = await res.json();
      if (res.ok && data.sessions) {
        setSupplements(data.sessions);
      }
    } catch {
      // silently degrade
    }
    setGeneratingSupplements(false);
  };

  if (loading) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="loading-pulse" />
        </div>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="ailog-page"><p>Program not found.</p></div>
        </div>
      </div>
    );
  }

  const totalModal = (analysis?.modal_balance?.Weightlifting || 0) + (analysis?.modal_balance?.Gymnastics || 0) + (analysis?.modal_balance?.Monostructural || 0);
  const topMovements = analysis?.movement_frequency?.slice(0, showAllMovements ? 30 : 10) || [];
  const highGaps = gaps.filter((g) => g.severity === 'high');
  const medGaps = gaps.filter((g) => g.severity === 'medium');

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => navigate('/ailog')}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1 style={{ flex: 1 }}>{program.name}</h1>
        </header>

        <div className="ailog-page">
          {/* Program info card */}
          <div className="ailog-card" style={{ marginBottom: 16 }}>
            <div className="ailog-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {program.gym_name && <div className="ailog-program-gym">{program.gym_name}</div>}
                  <div className="ailog-program-meta">
                    {workoutCount} workout{workoutCount !== 1 ? 's' : ''} uploaded
                    {isDraft && <span style={{ marginLeft: 8, fontSize: 11, color: '#fbbf24', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Draft</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {isDraft && (
                    <>
                      <button
                        className="ailog-btn ailog-btn-secondary"
                        style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                        onClick={runAnalysis}
                        disabled={analyzing}
                      >
                        <RefreshCw size={14} className={analyzing ? 'spin' : ''} />
                        {analyzing ? 'Analyzing...' : analysis ? 'Re-analyze' : 'Run Analysis'}
                      </button>
                      <button
                        className="ailog-btn ailog-btn-primary"
                        style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                        onClick={commitProgram}
                        disabled={committing}
                      >
                        {committing ? 'Saving...' : 'Commit to My Programs'}
                      </button>
                    </>
                  )}
                  {!isDraft && (
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>Committed</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Workouts list */}
          {workouts.length > 0 && (
            <div className="ailog-card" style={{ marginBottom: 16 }}>
              <div className="ailog-section">
                <button
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', padding: 0, width: '100%' }}
                  onClick={() => setShowWorkouts(!showWorkouts)}
                >
                  <h3 className="ailog-header">Workouts ({workoutCount})</h3>
                  {showWorkouts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showWorkouts && workouts.map((w) => {
                  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                  const label = `Wk${w.week_num} ${dayNames[w.day_num] || `Day ${w.day_num}`}`;
                  const preview = w.workout_text.length > 80 ? w.workout_text.slice(0, 80) + '...' : w.workout_text;
                  return (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</div>
                      </div>
                      <button
                        className="ailog-btn ailog-btn-secondary"
                        style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, flexShrink: 0 }}
                        onClick={() => navigate('/workout/start', { state: { workout_text: w.workout_text, source_id: w.id, source_type: 'external' } })}
                      >
                        <Play size={12} /> Log
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Analysis tools — only available for drafts (pre-commit) */}
          {isDraft && <>
          {/* AI Summary */}
          {summary && (
            <div className="ailog-card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
              <div className="ailog-section">
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <TrendingUp size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', margin: 0 }}>{summary}</p>
                </div>
              </div>
            </div>
          )}

          {/* Gap findings */}
          {gaps.length > 0 && (
            <div className="ailog-card" style={{ marginBottom: 16 }}>
              <div className="ailog-section">
                <h3 className="ailog-header">Gap Analysis</h3>
                {highGaps.length > 0 && (
                  <>
                    <div className="ailog-label" style={{ color: '#f87171' }}>Priority Gaps</div>
                    {highGaps.map((g, i) => (
                      <div key={`h-${i}`} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                        <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{g.title}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>{g.detail}</div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {medGaps.length > 0 && (
                  <>
                    <div className="ailog-label" style={{ color: '#fbbf24', marginTop: highGaps.length > 0 ? 12 : 0 }}>Areas to Improve</div>
                    {medGaps.map((g, i) => (
                      <div key={`m-${i}`} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                        <AlertTriangle size={16} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{g.title}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>{g.detail}</div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Supplemental sessions */}
          {gaps.length > 0 && (
            <div className="ailog-card" style={{ marginBottom: 16 }}>
              <div className="ailog-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="ailog-header">Supplemental Sessions</h3>
                  <button
                    className="ailog-btn ailog-btn-primary"
                    style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                    onClick={generateSupplements}
                    disabled={generatingSupplements}
                  >
                    <Sparkles size={14} />
                    {generatingSupplements ? 'Generating...' : supplements.length > 0 ? 'Regenerate' : 'Generate Sessions'}
                  </button>
                </div>
                {supplements.length === 0 && !generatingSupplements && (
                  <p className="ailog-subheader">Generate AI-powered supplemental sessions to fill the gaps in your gym's programming.</p>
                )}
                {generatingSupplements && <div className="loading-pulse" style={{ height: 80 }} />}
                {supplements.map((s, i) => (
                  <div key={i} style={{ border: '1px solid var(--border-light)', borderRadius: 10, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Dumbbell size={16} style={{ color: 'var(--accent)' }} />
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{s.title}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span className="ailog-badge" style={{
                          background: s.focus === 'conditioning' ? 'rgba(34,197,94,.15)' : s.focus === 'skills' ? 'rgba(59,130,246,.15)' : s.focus === 'strength' ? 'rgba(239,68,68,.15)' : 'rgba(168,85,247,.15)',
                          color: s.focus === 'conditioning' ? '#4ade80' : s.focus === 'skills' ? '#60a5fa' : s.focus === 'strength' ? '#f87171' : '#c084fc',
                        }}>{s.focus}</span>
                        <span className="ailog-badge ailog-badge--complete">{s.estimated_minutes} min</span>
                      </div>
                    </div>
                    <pre style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap', margin: 0, background: 'var(--bg)', padding: 12, borderRadius: 8 }}>
                      {s.workout_text}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analysis visualizations */}
          {analysis && (
            <>
              {/* Modality balance */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Modality Balance</h3>
                  {totalModal > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(['Weightlifting', 'Gymnastics', 'Monostructural'] as const).map((mod) => {
                        const count = analysis.modal_balance[mod] || 0;
                        const pct = totalModal > 0 ? Math.round((count / totalModal) * 100) : 0;
                        const color = mod === 'Weightlifting' ? '#f87171' : mod === 'Gymnastics' ? '#60a5fa' : '#4ade80';
                        return (
                          <div key={mod}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                              <span style={{ color: 'var(--text-dim)' }}>{mod}</span>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text)' }}>{pct}%</span>
                            </div>
                            <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Time domains */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Time Domains</h3>
                  <div className="ailog-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                    {(['short', 'medium', 'long'] as const).map((td) => (
                      <div key={td} className="ailog-stat" style={{ textAlign: 'center' }}>
                        <div className="ailog-stat-value" style={{ fontSize: 22 }}>{analysis.time_domains[td] || 0}</div>
                        <div className="ailog-stat-label">{td === 'short' ? '<8 min' : td === 'medium' ? '8-15 min' : '15+ min'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Movement frequency */}
              {topMovements.length > 0 && (
                <div className="ailog-card" style={{ marginBottom: 16 }}>
                  <div className="ailog-section">
                    <h3 className="ailog-header">Movement Frequency</h3>
                    {topMovements.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                        <span style={{ fontSize: 14, textTransform: 'capitalize' }}>{m.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`ailog-badge ${m.modality === 'W' ? 'ailog-badge--ongoing' : ''}`} style={{
                            background: m.modality === 'W' ? 'rgba(239,68,68,.15)' : m.modality === 'G' ? 'rgba(59,130,246,.15)' : 'rgba(34,197,94,.15)',
                            color: m.modality === 'W' ? '#f87171' : m.modality === 'G' ? '#60a5fa' : '#4ade80',
                          }}>{m.modality}</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, minWidth: 24, textAlign: 'right' }}>{m.count}</span>
                        </div>
                      </div>
                    ))}
                    {(analysis.movement_frequency?.length || 0) > 10 && (
                      <button
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '8px 0', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setShowAllMovements(!showAllMovements)}
                      >
                        {showAllMovements ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {showAllMovements ? 'Show less' : `Show all ${analysis.movement_frequency.length}`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Not programmed */}
              {analysis.not_programmed && Object.values(analysis.not_programmed).some((arr) => arr.length > 0) && (
                <div className="ailog-card" style={{ marginBottom: 16 }}>
                  <div className="ailog-section">
                    <h3 className="ailog-header">Not Programmed</h3>
                    <p className="ailog-subheader">Common CrossFit movements missing from this program</p>
                    {Object.entries(analysis.not_programmed).map(([category, movements]) => (
                      movements.length > 0 && (
                        <div key={category}>
                          <div className="ailog-label">{category}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {movements.map((m) => (
                              <span key={m} style={{ fontSize: 12, padding: '3px 8px', background: 'var(--surface2)', borderRadius: 4, color: 'var(--text-dim)', textTransform: 'capitalize' }}>
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* No analysis yet prompt */}
          {!analysis && !analyzing && (
            <div className="ailog-card">
              <div className="ailog-empty">
                <TrendingUp size={36} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                <p className="ailog-subheader">Run analysis to see gap findings, modality balance, and personalized recommendations.</p>
                <button className="ailog-btn ailog-btn-primary" onClick={runAnalysis}>
                  Run Gap Analysis
                </button>
              </div>
            </div>
          )}
          </>}{/* end isDraft analysis tools */}
        </div>
      </div>
    </div>
  );
}
