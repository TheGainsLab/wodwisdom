import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

const LIFT_GROUPS = [
  {
    title: 'Squats',
    lifts: [
      { key: 'back_squat', label: 'Back Squat' },
      { key: 'front_squat', label: 'Front Squat' },
      { key: 'overhead_squat', label: 'Overhead Squat' },
    ],
  },
  {
    title: 'Hip Hinge',
    lifts: [{ key: 'deadlift', label: 'Deadlift' }],
  },
  {
    title: 'Olympic',
    lifts: [
      { key: 'clean', label: 'Clean (only)' },
      { key: 'power_clean', label: 'Power Clean' },
      { key: 'clean_and_jerk', label: 'Clean & Jerk' },
      { key: 'jerk', label: 'Jerk (only)' },
      { key: 'snatch', label: 'Snatch' },
      { key: 'power_snatch', label: 'Power Snatch' },
      { key: 'push_jerk', label: 'Push Jerk' },
    ],
  },
  {
    title: 'Pressing',
    lifts: [
      { key: 'press', label: 'Strict Press' },
      { key: 'push_press', label: 'Push Press' },
      { key: 'bench_press', label: 'Bench Press' },
    ],
  },
];

const SKILL_GROUPS = [
  {
    title: 'Muscle-Ups',
    skills: [
      { key: 'muscle_ups', label: 'Muscle-Ups (rings)' },
      { key: 'bar_muscle_ups', label: 'Bar Muscle-Ups' },
      { key: 'strict_ring_muscle_ups', label: 'Strict Ring Muscle-Ups' },
    ],
  },
  {
    title: 'Bar',
    skills: [
      { key: 'toes_to_bar', label: 'Toes-to-Bar' },
      { key: 'bar_muscle_ups', label: 'Bar Muscle-Ups' },
    ],
  },
  {
    title: 'Pull-Ups',
    skills: [
      { key: 'strict_pull_ups', label: 'Strict Pull-Ups' },
      { key: 'kipping_pull_ups', label: 'Kipping Pull-Ups' },
      { key: 'butterfly_pull_ups', label: 'Butterfly Pull-Ups' },
      { key: 'chest_to_bar_pull_ups', label: 'Chest to Bar Pull-Ups' },
    ],
  },
  {
    title: 'Rope Climbs',
    skills: [
      { key: 'rope_climbs', label: 'Rope Climbs' },
      { key: 'legless_rope_climbs', label: 'Legless Rope Climbs' },
    ],
  },
  {
    title: 'HSPU',
    skills: [
      { key: 'wall_facing_hspu', label: 'Wall-Facing HSPU' },
      { key: 'hspu', label: 'HSPU' },
      { key: 'strict_hspu', label: 'Strict HSPU' },
      { key: 'deficit_hspu', label: 'Deficit HSPU' },
    ],
  },
  {
    title: 'Rings',
    skills: [
      { key: 'ring_dips', label: 'Ring Dips' },
      { key: 'l_sit', label: 'L-Sit' },
    ],
  },
  {
    title: 'Other',
    skills: [
      { key: 'handstand_walk', label: 'Handstand Walk' },
      { key: 'double_unders', label: 'Double-Unders' },
      { key: 'pistols', label: 'Pistols' },
    ],
  },
];

const SKILL_LEVEL_GUIDELINE = 'Beginner = basic grasp · Intermediate = good unless tired · Advanced = reliable when fatigued';

const CONDITIONING_GROUPS = [
  {
    title: 'Running',
    benchmarks: [
      { key: '1_mile_run', label: '1 Mile Run', placeholder: 'e.g. 6:45', isTime: true },
      { key: '5k_run', label: '5k Run', placeholder: 'e.g. 22:30', isTime: true },
    ],
  },
  {
    title: 'Rowing',
    benchmarks: [
      { key: '1k_row', label: '1k Row', placeholder: 'e.g. 3:45', isTime: true },
      { key: '2k_row', label: '2k Row', placeholder: 'e.g. 7:30', isTime: true },
      { key: '5k_row', label: '5k Row', placeholder: 'e.g. 20:00', isTime: true },
    ],
  },
  {
    title: 'Bike',
    benchmarks: [
      { key: '1min_bike_cals', label: '1 Min Cals', placeholder: '0', isTime: false },
      { key: '10min_bike_cals', label: '10 Min Cals', placeholder: '0', isTime: false },
    ],
  },
];

const SKILL_LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;
type SkillLevel = typeof SKILL_LEVELS[number];

const LEVEL_LABELS: Record<SkillLevel, string> = {
  none: 'None',
  beginner: 'Beginner',
  intermediate: 'Inter',
  advanced: 'Advanced',
};

interface ProfileSnapshot {
  lifts?: Record<string, number>;
  skills?: Record<string, string>;
  conditioning?: Record<string, string | number>;
  bodyweight?: number | null;
  units?: string;
}

interface Evaluation {
  id: string;
  type: string;
  profile_snapshot: ProfileSnapshot;
  lifting_analysis: string | null;
  skills_analysis: string | null;
  engine_analysis: string | null;
  created_at: string;
}

/** Build human-readable diff lines between two profile snapshots */
function buildProfileDiffs(prev: ProfileSnapshot, current: ProfileSnapshot): string[] {
  const diffs: string[] = [];
  const u = current.units === 'kg' ? 'kg' : 'lbs';

  // Bodyweight
  if (prev.bodyweight && current.bodyweight && prev.bodyweight !== current.bodyweight) {
    const diff = current.bodyweight - prev.bodyweight;
    diffs.push(`Bodyweight: ${prev.bodyweight} → ${current.bodyweight} ${u} (${diff > 0 ? '+' : ''}${diff})`);
  }

  // Lifts
  const allLiftKeys = new Set([...Object.keys(prev.lifts || {}), ...Object.keys(current.lifts || {})]);
  for (const key of allLiftKeys) {
    const prevVal = prev.lifts?.[key];
    const curVal = current.lifts?.[key];
    if (prevVal && curVal && prevVal !== curVal) {
      const diff = curVal - prevVal;
      const label = LIFT_GROUPS.flatMap(g => g.lifts).find(l => l.key === key)?.label || key.replace(/_/g, ' ');
      diffs.push(`${label}: ${prevVal} → ${curVal} ${u} (${diff > 0 ? '+' : ''}${diff})`);
    } else if (!prevVal && curVal && curVal > 0) {
      const label = LIFT_GROUPS.flatMap(g => g.lifts).find(l => l.key === key)?.label || key.replace(/_/g, ' ');
      diffs.push(`${label}: new — ${curVal} ${u}`);
    }
  }

  // Skills
  const levelOrder: Record<string, number> = { none: 0, beginner: 1, intermediate: 2, advanced: 3 };
  const allSkillKeys = new Set([...Object.keys(prev.skills || {}), ...Object.keys(current.skills || {})]);
  for (const key of allSkillKeys) {
    const prevVal = prev.skills?.[key];
    const curVal = current.skills?.[key];
    if (prevVal && curVal && prevVal !== curVal && curVal !== 'none') {
      const arrow = (levelOrder[curVal] || 0) > (levelOrder[prevVal] || 0) ? ' ↑' : ' ↓';
      const label = SKILL_GROUPS.flatMap(g => g.skills).find(s => s.key === key)?.label || key.replace(/_/g, ' ');
      diffs.push(`${label}: ${prevVal} → ${curVal}${arrow}`);
    }
  }

  // Conditioning
  const allCondKeys = new Set([...Object.keys(prev.conditioning || {}), ...Object.keys(current.conditioning || {})]);
  for (const key of allCondKeys) {
    const prevVal = prev.conditioning?.[key];
    const curVal = current.conditioning?.[key];
    if (prevVal != null && curVal != null && String(prevVal) !== String(curVal)) {
      const label = CONDITIONING_GROUPS.flatMap(g => g.benchmarks).find(b => b.key === key)?.label || key.replace(/_/g, ' ');
      diffs.push(`${label}: ${prevVal} → ${curVal}`);
    }
  }

  return diffs;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AthletePage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [lifts, setLifts] = useState<Record<string, number>>({});
  const [skills, setSkills] = useState<Record<string, SkillLevel>>({});
  const [conditioning, setConditioning] = useState<Record<string, string | number>>({});
  const [bodyweight, setBodyweight] = useState<string>('');
  const [units, setUnits] = useState<'lbs' | 'kg'>('lbs');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [analysisResult, setAnalysisResult] = useState<{ type: 'lifts' | 'skills' | 'engine' | 'full'; text: string; evaluationId?: string | null } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<'lifts' | 'skills' | 'engine' | 'full' | null>(null);
  const [generateLoading, setGenerateLoading] = useState(false);

  const navigate = useNavigate();

  // Evaluation history
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [expandedEvalId, setExpandedEvalId] = useState<string | null>(null);

  const fetchEvaluations = async () => {
    const { data } = await supabase
      .from('profile_evaluations')
      .select('id, type, profile_snapshot, lifting_analysis, skills_analysis, engine_analysis, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setEvaluations(data);
  };

  useEffect(() => {
    Promise.all([
      supabase
        .from('athlete_profiles')
        .select('lifts, skills, conditioning, bodyweight, units')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('profile_evaluations')
        .select('id, type, profile_snapshot, lifting_analysis, skills_analysis, engine_analysis, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]).then(([profileRes, evalRes]) => {
      if (profileRes.data) {
        setLifts(profileRes.data.lifts || {});
        setSkills(profileRes.data.skills || {});
        setConditioning(profileRes.data.conditioning || {});
        setBodyweight(profileRes.data.bodyweight != null ? String(profileRes.data.bodyweight) : '');
        setUnits((profileRes.data.units as 'lbs' | 'kg') || 'lbs');
      }
      if (evalRes.data) {
        setEvaluations(evalRes.data);
      }
      setLoading(false);
    });
  }, [session.user.id]);

  const setLift = (key: string, value: string) => {
    const num = value === '' ? 0 : parseInt(value, 10);
    if (isNaN(num)) return;
    setLifts(prev => ({ ...prev, [key]: num }));
  };

  const setSkill = (key: string, level: SkillLevel) => {
    setSkills(prev => ({ ...prev, [key]: level }));
  };

  const setConditioningVal = (key: string, value: string | number) => {
    if (value === '' || value === null || value === undefined) {
      setConditioning(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setConditioning(prev => ({ ...prev, [key]: value }));
    }
  };

  const fetchProfileAnalysis = async (type: 'lifts' | 'skills' | 'engine' | 'full') => {
    setAnalysisLoading(type);
    setAnalysisResult(null);
    setError('');
    try {
      const { data, error } = await supabase.functions.invoke('profile-analysis', {
        body: { type },
      });
      if (error) throw new Error(error.message || 'Analysis failed');
      if (data?.error) throw new Error(data.error || 'Analysis failed');
      setAnalysisResult({
        type,
        text: data?.analysis,
        evaluationId: data?.evaluation_id ?? null,
      });
      // Refresh evaluation history after new analysis is saved
      fetchEvaluations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalysisLoading(null);
    }
  };

  const handleGenerateProgram = async () => {
    setGenerateLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.functions.invoke('generate-program', {
        body: analysisResult?.evaluationId ? { evaluation_id: analysisResult.evaluationId } : {},
      });
      if (error) throw new Error(error.message || 'Failed to generate program');
      if (data?.error) throw new Error(data.error || 'Failed to generate program');
      const programId = data?.program_id;
      if (programId) {
        navigate(`/programs/${programId}`);
      } else {
        throw new Error('No program returned');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate program');
    } finally {
      setGenerateLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    // Only store non-zero lifts
    const cleanLifts: Record<string, number> = {};
    for (const [key, val] of Object.entries(lifts)) {
      if (val > 0) cleanLifts[key] = val;
    }

    const bw = bodyweight === '' ? null : parseFloat(bodyweight);

    const cleanConditioning: Record<string, string | number> = {};
    for (const [key, val] of Object.entries(conditioning)) {
      if (val !== '' && val != null) {
        const b = CONDITIONING_GROUPS.flatMap(g => g.benchmarks).find(bm => bm.key === key);
        cleanConditioning[key] = b?.isTime ? String(val) : (typeof val === 'number' ? val : parseInt(String(val), 10) || 0);
      }
    }

    const { error: err } = await supabase
      .from('athlete_profiles')
      .upsert(
        {
          user_id: session.user.id,
          lifts: cleanLifts,
          skills,
          conditioning: cleanConditioning,
          bodyweight: bw && !isNaN(bw) ? bw : null,
          units,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (err) setError(err.message);
    else setSuccess('Athlete profile saved');
    setSaving(false);
    setTimeout(() => setSuccess(''), 3000);
  };

  // Build current profile snapshot for diff comparison
  const currentSnapshot: ProfileSnapshot = { lifts, skills, conditioning, bodyweight: bodyweight ? parseFloat(bodyweight) : null, units };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Athlete Profile</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <div className="auth-error" style={{ display: 'block' }}>{error}</div>}
            {success && <div className="success-msg">{success}</div>}

            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : (
              <>
                {/* 1RM Lifts */}
                <div className="settings-card">
                  <h2 className="settings-card-title">1RM Lifts</h2>
                  <p className="athlete-card-subtitle">Enter your one-rep max weights</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                    <div className="lift-item" style={{ flex: '0 0 auto' }}>
                      <span className="lift-label">Bodyweight</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="0"
                        step={units === 'lbs' ? 5 : 2}
                        placeholder="0"
                        value={bodyweight}
                        onChange={e => setBodyweight(e.target.value)}
                        style={{ width: 90 }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Units</span>
                      <button
                        type="button"
                        className={'skill-level-btn' + (units === 'lbs' ? ' active' : '')}
                        onClick={() => setUnits('lbs')}
                      >
                        lbs
                      </button>
                      <button
                        type="button"
                        className={'skill-level-btn' + (units === 'kg' ? ' active' : '')}
                        onClick={() => setUnits('kg')}
                      >
                        kg
                      </button>
                    </div>
                  </div>
                  {LIFT_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>{group.title}</h3>
                      <div className="lift-grid">
                        {group.lifts.map(lift => (
                          <div className="lift-item" key={lift.key}>
                            <span className="lift-label">{lift.label}</span>
                            <input
                              className="lift-input"
                              type="number"
                              min="0"
                              step="5"
                              placeholder="0"
                              value={lifts[lift.key] || ''}
                              onChange={e => setLift(lift.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Skills Assessment */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Skills Assessment</h2>
                  <p className="athlete-card-subtitle">Rate your current ability for each skill. {SKILL_LEVEL_GUIDELINE}</p>
                  {SKILL_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 24 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 12 }}>{group.title}</h3>
                      <div className="skill-list">
                        {group.skills.map(skill => (
                          <div className="skill-row" key={skill.key}>
                            <span className="skill-name">{skill.label}</span>
                            <div className="skill-levels">
                              {SKILL_LEVELS.map(level => (
                                <button
                                  key={level}
                                  className={'skill-level-btn' + ((skills[skill.key] || 'none') === level ? ' active' : '')}
                                  onClick={() => setSkill(skill.key, level)}
                                  type="button"
                                >
                                  {LEVEL_LABELS[level]}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Conditioning Benchmarks */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Conditioning Benchmarks</h2>
                  <p className="athlete-card-subtitle">Running and rowing times (MM:SS), bike in calories.</p>
                  {CONDITIONING_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>{group.title}</h3>
                      <div className="lift-grid">
                        {group.benchmarks.map(bm => (
                          <div className="lift-item" key={bm.key}>
                            <span className="lift-label">{bm.label}</span>
                            <input
                              className="lift-input"
                              type={bm.isTime ? 'text' : 'number'}
                              min={bm.isTime ? undefined : 0}
                              placeholder={bm.placeholder}
                              value={conditioning[bm.key] ?? ''}
                              onChange={e => setConditioningVal(bm.key, bm.isTime ? e.target.value.trim() : (e.target.value === '' ? '' : parseInt(e.target.value, 10) || 0))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI Profile Analysis */}
                <div className="settings-card" style={{ borderColor: 'rgba(255,58,58,.2)', background: 'var(--accent-glow)' }}>
                  <h2 className="settings-card-title">AI Profile Analysis</h2>
                  <p className="athlete-card-subtitle">Save your profile first, then analyze. Results are saved for comparison over time.</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                    <button
                      type="button"
                      className="auth-btn"
                      style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                      onClick={() => fetchProfileAnalysis('lifts')}
                      disabled={!!analysisLoading}
                    >
                      {analysisLoading === 'lifts' ? 'Analyzing...' : 'AI Lifting Analysis'}
                    </button>
                    <button
                      type="button"
                      className="auth-btn"
                      style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                      onClick={() => fetchProfileAnalysis('skills')}
                      disabled={!!analysisLoading}
                    >
                      {analysisLoading === 'skills' ? 'Analyzing...' : 'AI Skills Analysis'}
                    </button>
                    <button
                      type="button"
                      className="auth-btn"
                      style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                      onClick={() => fetchProfileAnalysis('engine')}
                      disabled={!!analysisLoading}
                    >
                      {analysisLoading === 'engine' ? 'Analyzing...' : 'AI Engine Analysis'}
                    </button>
                    <button
                      type="button"
                      className="auth-btn"
                      style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                      onClick={() => fetchProfileAnalysis('full')}
                      disabled={!!analysisLoading}
                    >
                      {analysisLoading === 'full' ? 'Analyzing...' : 'AI Full Profile'}
                    </button>
                  </div>
                  {analysisResult && (
                    <div className="workout-review-section" style={{ marginTop: 0 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>
                        {analysisResult.type === 'lifts' ? 'Lifting' : analysisResult.type === 'skills' ? 'Skills' : analysisResult.type === 'engine' ? 'Engine' : 'Full Profile'}
                      </h3>
                      <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap' }}>{analysisResult.text}</div>
                      <button
                        type="button"
                        className="auth-btn"
                        onClick={handleGenerateProgram}
                        disabled={generateLoading}
                        style={{ marginTop: 14 }}
                      >
                        {generateLoading ? 'Generating...' : 'Generate program'}
                      </button>
                    </div>
                  )}
                </div>

                <button
                  className="auth-btn"
                  onClick={saveProfile}
                  disabled={saving}
                  style={success ? { background: '#2ec486', color: 'white' } : undefined}
                >
                  {saving ? 'Saving...' : success ? 'Saved ✓' : 'Save Athlete Profile'}
                </button>

                {/* Evaluation History */}
                {evaluations.length > 0 && (
                  <div className="settings-card">
                    <h2 className="settings-card-title">Evaluation History</h2>
                    <p className="athlete-card-subtitle">Past AI evaluations with profile snapshots. Click to expand.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {evaluations.map((ev, idx) => {
                        const isExpanded = expandedEvalId === ev.id;
                        const prevEval = evaluations[idx + 1] || null;
                        const diffs = prevEval ? buildProfileDiffs(prevEval.profile_snapshot, ev.profile_snapshot) : [];
                        const typeLabel = ev.type === 'full' ? 'Full' : ev.type === 'lifts' ? 'Lifting' : ev.type === 'skills' ? 'Skills' : ev.type === 'engine' ? 'Engine' : 'Full';
                        const analysisTypes: string[] = [];
                        if (ev.lifting_analysis) analysisTypes.push('Lifting');
                        if (ev.skills_analysis) analysisTypes.push('Skills');
                        if (ev.engine_analysis) analysisTypes.push('Engine');

                        return (
                          <div key={ev.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                            <button
                              type="button"
                              onClick={() => setExpandedEvalId(isExpanded ? null : ev.id)}
                              style={{
                                width: '100%',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '12px 16px',
                                background: 'var(--bg)',
                                border: 'none',
                                color: 'var(--text)',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                fontSize: 14,
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>{formatDate(ev.created_at)}</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--accent)' }}>{typeLabel}</span>
                                {ev.type === 'full' && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{analysisTypes.join(', ')}</span>}
                                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                              </span>
                            </button>
                            {isExpanded && (
                              <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
                                {/* Profile changes since previous eval */}
                                {diffs.length > 0 && (
                                  <div style={{ marginBottom: 16 }}>
                                    <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: '#2ec486', marginBottom: 8 }}>
                                      Changes since {formatDate(prevEval!.created_at)}
                                    </h4>
                                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                                      {diffs.map((d, i) => <div key={i}>{d}</div>)}
                                    </div>
                                  </div>
                                )}
                                {idx === evaluations.length - 1 && diffs.length === 0 && (
                                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, fontStyle: 'italic' }}>First evaluation — no prior data to compare.</div>
                                )}

                                {/* Compare snapshot to current profile */}
                                {idx > 0 || true ? (() => {
                                  const currentDiffs = buildProfileDiffs(ev.profile_snapshot, currentSnapshot);
                                  if (currentDiffs.length === 0) return null;
                                  return (
                                    <div style={{ marginBottom: 16 }}>
                                      <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 8 }}>
                                        Changes since then (vs current)
                                      </h4>
                                      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                                        {currentDiffs.map((d, i) => <div key={i}>{d}</div>)}
                                      </div>
                                    </div>
                                  );
                                })() : null}

                                {/* Analysis text */}
                                {ev.lifting_analysis && (
                                  <div className="workout-review-section" style={{ marginTop: 0, marginBottom: ev.skills_analysis || ev.engine_analysis ? 12 : 0 }}>
                                    <h3>Lifting</h3>
                                    <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap' }}>{ev.lifting_analysis}</div>
                                  </div>
                                )}
                                {ev.skills_analysis && (
                                  <div className="workout-review-section" style={{ marginTop: 0, marginBottom: ev.engine_analysis ? 12 : 0 }}>
                                    <h3>Skills</h3>
                                    <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap' }}>{ev.skills_analysis}</div>
                                  </div>
                                )}
                                {ev.engine_analysis && (
                                  <div className="workout-review-section" style={{ marginTop: 0 }}>
                                    <h3>Engine</h3>
                                    <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap' }}>{ev.engine_analysis}</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
