import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

const LIFTS = [
  { key: 'back_squat', label: 'Back Squat' },
  { key: 'front_squat', label: 'Front Squat' },
  { key: 'overhead_squat', label: 'Overhead Squat' },
  { key: 'deadlift', label: 'Deadlift' },
  { key: 'clean', label: 'Clean' },
  { key: 'clean_and_jerk', label: 'Clean & Jerk' },
  { key: 'snatch', label: 'Snatch' },
  { key: 'press', label: 'Press' },
  { key: 'push_press', label: 'Push Press' },
  { key: 'push_jerk', label: 'Push Jerk' },
  { key: 'bench_press', label: 'Bench Press' },
];

const SKILLS = [
  { key: 'muscle_ups', label: 'Muscle-Ups' },
  { key: 'bar_muscle_ups', label: 'Bar Muscle-Ups' },
  { key: 'hspu', label: 'HSPU' },
  { key: 'strict_hspu', label: 'Strict HSPU' },
  { key: 'handstand_walk', label: 'Handstand Walk' },
  { key: 'double_unders', label: 'Double-Unders' },
  { key: 'pistols', label: 'Pistols' },
  { key: 'rope_climbs', label: 'Rope Climbs' },
  { key: 'toes_to_bar', label: 'Toes-to-Bar' },
  { key: 'kipping_pull_ups', label: 'Kipping Pull-Ups' },
  { key: 'butterfly_pull_ups', label: 'Butterfly Pull-Ups' },
  { key: 'strict_pull_ups', label: 'Strict Pull-Ups' },
  { key: 'ring_dips', label: 'Ring Dips' },
  { key: 'l_sit', label: 'L-Sit' },
];

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    supabase
      .from('athlete_profiles')
      .select('lifts, skills')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLifts(data.lifts || {});
          setSkills(data.skills || {});
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

  const saveProfile = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    // Only store non-zero lifts
    const cleanLifts: Record<string, number> = {};
    for (const [key, val] of Object.entries(lifts)) {
      if (val > 0) cleanLifts[key] = val;
    }

    const { error: err } = await supabase
      .from('athlete_profiles')
      .upsert(
        {
          user_id: session.user.id,
          lifts: cleanLifts,
          skills,
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
                  <p className="athlete-card-subtitle">Enter your one-rep max weights in pounds</p>
                  <div className="lift-grid">
                    {LIFTS.map(lift => (
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

                {/* Skills Assessment */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Skills Assessment</h2>
                  <p className="athlete-card-subtitle">Rate your current ability for each skill</p>
                  <div className="skill-list">
                    {SKILLS.map(skill => (
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
