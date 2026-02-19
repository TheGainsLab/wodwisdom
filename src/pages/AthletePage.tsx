import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, PROFILE_ANALYSIS_ENDPOINT } from '../lib/supabase';
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

const SKILL_LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;
type SkillLevel = typeof SKILL_LEVELS[number];

const LEVEL_LABELS: Record<SkillLevel, string> = {
  none: 'None',
  beginner: 'Beginner',
  intermediate: 'Inter',
  advanced: 'Advanced',
};

export default function AthletePage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [lifts, setLifts] = useState<Record<string, number>>({});
  const [skills, setSkills] = useState<Record<string, SkillLevel>>({});
  const [bodyweight, setBodyweight] = useState<string>('');
  const [units, setUnits] = useState<'lbs' | 'kg'>('lbs');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [analysisResult, setAnalysisResult] = useState<{ type: 'lifts' | 'skills' | 'full'; text: string } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<'lifts' | 'skills' | 'full' | null>(null);

  useEffect(() => {
    supabase
      .from('athlete_profiles')
      .select('lifts, skills, bodyweight, units')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLifts(data.lifts || {});
          setSkills(data.skills || {});
          setBodyweight(data.bodyweight != null ? String(data.bodyweight) : '');
          setUnits((data.units as 'lbs' | 'kg') || 'lbs');
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

  const fetchProfileAnalysis = async (type: 'lifts' | 'skills' | 'full') => {
    setAnalysisLoading(type);
    setAnalysisResult(null);
    setError('');
    try {
      const resp = await fetch(PROFILE_ANALYSIS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Analysis failed');
      setAnalysisResult({ type, text: data.analysis });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalysisLoading(null);
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

    const { error: err } = await supabase
      .from('athlete_profiles')
      .upsert(
        {
          user_id: session.user.id,
          lifts: cleanLifts,
          skills,
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

                {/* AI Profile Analysis */}
                <div className="settings-card" style={{ borderColor: 'rgba(255,58,58,.2)', background: 'var(--accent-glow)' }}>
                  <h2 className="settings-card-title">AI Profile Analysis</h2>
                  <p className="athlete-card-subtitle">Free analysis of your profile. Does not use your question limit.</p>
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
                      onClick={() => fetchProfileAnalysis('full')}
                      disabled={!!analysisLoading}
                    >
                      {analysisLoading === 'full' ? 'Analyzing...' : 'AI Full Profile'}
                    </button>
                  </div>
                  {analysisResult && (
                    <div className="workout-review-section" style={{ marginTop: 0 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>
                        {analysisResult.type === 'lifts' ? 'Lifting' : analysisResult.type === 'skills' ? 'Skills' : 'Full Profile'}
                      </h3>
                      <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap' }}>{analysisResult.text}</div>
                    </div>
                  )}
                </div>

                <button className="auth-btn" onClick={saveProfile} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Athlete Profile'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
