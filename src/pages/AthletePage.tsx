import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { classifyAthlete } from '../utils/classify-athlete';
import { calculateTDEE } from '../utils/tdee';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { formatMarkdown } from '../lib/formatMarkdown';

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
    title: 'Bar Skills',
    skills: [
      { key: 'toes_to_bar', label: 'Toes-to-Bar' },
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

const EQUIPMENT_GROUPS = [
  {
    title: 'Cardio Machines',
    items: [
      { key: 'rower', label: 'Rower' },
      { key: 'assault_bike', label: 'Assault/Echo Bike' },
      { key: 'ski_erg', label: 'Ski Erg' },
      { key: 'treadmill', label: 'Treadmill' },
    ],
  },
  {
    title: 'Barbell & Weights',
    items: [
      { key: 'barbell', label: 'Barbell & Plates' },
      { key: 'dumbbells', label: 'Dumbbells' },
      { key: 'kettlebells', label: 'Kettlebells' },
    ],
  },
  {
    title: 'Gymnastics',
    items: [
      { key: 'pull_up_bar', label: 'Pull-Up Bar' },
      { key: 'rings', label: 'Rings' },
      { key: 'rope', label: 'Rope' },
      { key: 'ghd', label: 'GHD' },
      { key: 'parallettes', label: 'Parallettes' },
      { key: 'pegboard', label: 'Pegboard' },
    ],
  },
  {
    title: 'Other',
    items: [
      { key: 'box', label: 'Plyo Box' },
      { key: 'wall_ball', label: 'Wall Ball' },
      { key: 'sled', label: 'Sled/Prowler' },
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
  age?: number | null;
  height?: number | null;
  gender?: string;
}

interface Evaluation {
  id: string;
  profile_snapshot: ProfileSnapshot;
  analysis: string | null;
  created_at: string;
}

interface TrainingEvaluation {
  id: string;
  profile_snapshot: ProfileSnapshot;
  training_snapshot: string | null;
  analysis: string | null;
  created_at: string;
}

interface NutritionEvaluation {
  id: string;
  nutrition_snapshot: Record<string, unknown> | null;
  analysis: string | null;
  created_at: string;
}

/** Build human-readable diff lines between two profile snapshots */
function buildProfileDiffs(prev: ProfileSnapshot, current: ProfileSnapshot): string[] {
  const diffs: string[] = [];
  const u = current.units === 'kg' ? 'kg' : 'lbs';

  // Basics
  if (prev.bodyweight && current.bodyweight && prev.bodyweight !== current.bodyweight) {
    const diff = current.bodyweight - prev.bodyweight;
    diffs.push(`Bodyweight: ${prev.bodyweight} → ${current.bodyweight} ${u} (${diff > 0 ? '+' : ''}${diff})`);
  }
  if (prev.age != null && current.age != null && prev.age !== current.age) {
    diffs.push(`Age: ${prev.age} → ${current.age}`);
  }
  if (prev.height != null && current.height != null && prev.height !== current.height) {
    diffs.push(`Height: ${prev.height} → ${current.height}`);
  }
  if (prev.gender !== current.gender) {
    diffs.push(`Gender: ${prev.gender || '—'} → ${current.gender || '—'}`);
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

function CollapsibleSection({ title, defaultExpanded = false, children }: { title: string; defaultExpanded?: boolean; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="settings-card">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 0,
          margin: 0,
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <h2 className="settings-card-title" style={{ marginBottom: 0 }}>{title}</h2>
        <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}

export default function AthletePage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [age, setAge] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [bodyweight, setBodyweight] = useState<string>('');
  const [units, setUnits] = useState<'lbs' | 'kg'>('lbs');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [lifts, setLifts] = useState<Record<string, number>>({});
  const [equipment, setEquipment] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    for (const group of EQUIPMENT_GROUPS) {
      for (const item of group.items) {
        defaults[item.key] = true;
      }
    }
    return defaults;
  });
  const [skills, setSkills] = useState<Record<string, SkillLevel>>({});
  const [conditioning, setConditioning] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [isDirty, setIsDirty] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{ kind: 'profile'; text: string; evaluationId?: string | null } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<'profile' | null>(null);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [hasGeneratedProgram, setHasGeneratedProgram] = useState(false);
  const [tdeeOverride, setTdeeOverride] = useState<string>('');
  const [editingTdee, setEditingTdee] = useState(false);
  const [lastProfileAnalysis, setLastProfileAnalysis] = useState<string | null>(null);

  const navigate = useNavigate();
  const { hasFeature, isAdmin } = useEntitlements(session.user.id);

  // Evaluation history
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [trainingEvaluations, setTrainingEvaluations] = useState<TrainingEvaluation[]>([]);
  const [nutritionEvaluations, setNutritionEvaluations] = useState<NutritionEvaluation[]>([]);
  const [expandedEvalId, setExpandedEvalId] = useState<string | null>(null);

  const fetchEvaluations = async () => {
    const [profileRes, trainingRes, nutritionRes] = await Promise.all([
      supabase
        .from('profile_evaluations')
        .select('id, profile_snapshot, analysis, created_at, month_number, visible')
        .eq('user_id', session.user.id)
        .eq('visible', true)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('training_evaluations')
        .select('id, profile_snapshot, training_snapshot, analysis, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('nutrition_evaluations')
        .select('id, nutrition_snapshot, analysis, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (profileRes.data) {
      setEvaluations(profileRes.data);
      if (profileRes.data.length > 0) setLastProfileAnalysis(profileRes.data[0].created_at);
    }
    if (trainingRes.data) {
      setTrainingEvaluations(trainingRes.data);
    }
    if (nutritionRes.data) {
      setNutritionEvaluations(nutritionRes.data);
    }
  };

  useEffect(() => {
    Promise.all([
      supabase
        .from('athlete_profiles')
        .select('lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, tdee_override')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('profile_evaluations')
        .select('id, profile_snapshot, analysis, created_at, month_number, visible')
        .eq('user_id', session.user.id)
        .eq('visible', true)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('training_evaluations')
        .select('id, profile_snapshot, training_snapshot, analysis, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('programs')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('source', 'generated')
        .limit(1),
    ]).then(([profileRes, evalRes, trainingEvalRes, programsRes]) => {
      setHasGeneratedProgram(!!(programsRes.data && programsRes.data.length > 0));
      if (!profileRes.data) {
        setIsNewUser(true);
      }
      if (profileRes.data) {
        const d = profileRes.data;
        setLifts(d.lifts || {});
        if (d.equipment && Object.keys(d.equipment).length > 0) {
          setEquipment(prev => ({ ...prev, ...d.equipment }));
        }
        setSkills(d.skills || {});
        setConditioning(d.conditioning || {});
        setAge(d.age != null ? String(d.age) : '');
        setHeight(d.height != null ? String(d.height) : '');
        setBodyweight(d.bodyweight != null ? String(d.bodyweight) : '');
        setUnits((d.units as 'lbs' | 'kg') || 'lbs');
        setGender((d.gender as 'male' | 'female') || '');
        setTdeeOverride(d.tdee_override != null ? String(d.tdee_override) : '');
        setIsDirty(false);
      }
      if (evalRes.data) {
        setEvaluations(evalRes.data);
        if (evalRes.data.length > 0) setLastProfileAnalysis(evalRes.data[0].created_at);
      }
      if (trainingEvalRes.data) {
        setTrainingEvaluations(trainingEvalRes.data);
      }
      setLoading(false);
    });
  }, [session.user.id]);

  const markDirty = () => setIsDirty(true);

  const setLift = (key: string, value: string) => {
    const num = value === '' ? 0 : parseInt(value, 10);
    if (isNaN(num)) return;
    setLifts(prev => ({ ...prev, [key]: num }));
    markDirty();
  };

  const setSkill = (key: string, level: SkillLevel) => {
    setSkills(prev => ({ ...prev, [key]: level }));
    markDirty();
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
    markDirty();
  };

  const fetchProfileAnalysis = async () => {
    setAnalysisLoading('profile');
    setAnalysisResult(null);
    setError('');
    try {
      const { data, error } = await supabase.functions.invoke('profile-analysis', {
        body: {},
      });
      if (error) throw new Error(error.message || 'Analysis failed');
      if (data?.error) throw new Error(data.error || 'Analysis failed');
      setAnalysisResult({
        kind: 'profile',
        text: data?.analysis,
        evaluationId: data?.evaluation_id ?? null,
      });
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
      // Kick off background generation — returns immediately with job_id
      const { data, error } = await supabase.functions.invoke('generate-program', {
        body: analysisResult?.evaluationId ? { evaluation_id: analysisResult.evaluationId } : {},
      });
      if (error) throw new Error(error.message || 'Failed to generate program');
      if (data?.error) throw new Error(data.error || 'Failed to generate program');
      const jobId = data?.job_id;
      if (!jobId) throw new Error('No job ID returned');

      // Poll for completion with backoff: 3s, 4s, 5s, 6s, ... capped at 8s
      let delay = 3000;
      const maxDelay = 8000;
      const maxAttempts = 80; // ~400s worth of polling
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
        // Still pending/processing — back off slightly
        delay = Math.min(delay + 1000, maxDelay);
      }
      throw new Error('Program generation timed out');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate program');
    } finally {
      setGenerateLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setError('');

    // Only store non-zero lifts
    const cleanLifts: Record<string, number> = {};
    for (const [key, val] of Object.entries(lifts)) {
      if (val > 0) cleanLifts[key] = val;
    }

    const bw = bodyweight === '' ? null : parseFloat(bodyweight);
    const ageNum = age === '' ? null : parseInt(age, 10);
    const heightNum = height === '' ? null : parseFloat(height);
    const genderVal = gender === '' ? null : gender;

    const cleanConditioning: Record<string, string | number> = {};
    for (const [key, val] of Object.entries(conditioning)) {
      if (val !== '' && val != null) {
        const b = CONDITIONING_GROUPS.flatMap(g => g.benchmarks).find(bm => bm.key === key);
        cleanConditioning[key] = b?.isTime ? String(val) : (typeof val === 'number' ? val : parseInt(String(val), 10) || 0);
      }
    }

    const tdeeOverrideNum = tdeeOverride === '' ? null : parseFloat(tdeeOverride);

    const levels = classifyAthlete({
      bodyweight: bw && !isNaN(bw) ? bw : null,
      gender: genderVal,
      units,
      lifts: cleanLifts,
    });

    const { error: err } = await supabase
      .from('athlete_profiles')
      .upsert(
        {
          user_id: session.user.id,
          lifts: cleanLifts,
          equipment,
          skills,
          conditioning: cleanConditioning,
          bodyweight: bw && !isNaN(bw) ? bw : null,
          units,
          age: ageNum && !isNaN(ageNum) ? ageNum : null,
          height: heightNum && !isNaN(heightNum) ? heightNum : null,
          gender: genderVal,
          tdee_override: tdeeOverrideNum && !isNaN(tdeeOverrideNum) ? tdeeOverrideNum : null,
          ...levels,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (err) {
      setError(err.message);
    } else if (isNewUser) {
      setIsNewUser(false);
      navigate('/');
    } else {
      setIsDirty(false);
    }
    setSaving(false);
  };

  // Build current profile snapshot for diff comparison
  const currentSnapshot: ProfileSnapshot = {
    lifts,
    skills,
    conditioning,
    bodyweight: bodyweight ? parseFloat(bodyweight) : null,
    units,
    age: age ? parseInt(age, 10) : null,
    height: height ? parseFloat(height) : null,
    gender: gender || undefined,
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
            {isNewUser && (
              <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)' }}>
                <h2 className="settings-card-title" style={{ marginBottom: 8 }}>Welcome to GAINS</h2>
                <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  Complete your profile and click <span style={{ color: 'var(--accent)', fontWeight: 600 }}>AI Analysis</span> to get a comprehensive breakdown of your fitness and priorities for improvement. After that, take your profile over to <span style={{ color: 'var(--accent)', fontWeight: 600 }}>AI Coach</span> and ask the AI Coach anything you want about fitness. AI Coach uses your data and the methodology to tailor every response to you.
                </p>
              </div>
            )}
            {error && <div className="auth-error" style={{ display: 'block' }}>{error}</div>}

            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : (
              <>
                {/* Basics */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Basics</h2>

                  {/* Units toggle — prominent, first choice */}
                  <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                    <button
                      type="button"
                      style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: units === 'lbs' ? 'var(--accent)' : 'transparent', color: units === 'lbs' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                      onClick={() => { setUnits('lbs'); markDirty(); }}
                    >
                      Imperial (lbs / in)
                    </button>
                    <button
                      type="button"
                      style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: units === 'kg' ? 'var(--accent)' : 'transparent', color: units === 'kg' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                      onClick={() => { setUnits('kg'); markDirty(); }}
                    >
                      Metric (kg / cm)
                    </button>
                  </div>

                  <div className="lift-grid" style={{ marginBottom: 16 }}>
                    <div className="lift-item">
                      <span className="lift-label">Age</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="1"
                        max="120"
                        placeholder="—"
                        value={age}
                        onChange={e => { setAge(e.target.value); markDirty(); }}
                      />
                    </div>
                    <div className="lift-item">
                      <span className="lift-label">Height ({units === 'kg' ? 'cm' : 'in'})</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="0"
                        step={units === 'lbs' ? 1 : 0.1}
                        placeholder="—"
                        value={height}
                        onChange={e => { setHeight(e.target.value); markDirty(); }}
                      />
                    </div>
                    <div className="lift-item">
                      <span className="lift-label">Weight ({units === 'kg' ? 'kg' : 'lbs'})</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="0"
                        step={units === 'lbs' ? 5 : 2}
                        placeholder="0"
                        value={bodyweight}
                        onChange={e => { setBodyweight(e.target.value); markDirty(); }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Gender</span>
                    <button
                      type="button"
                      className={'skill-level-btn' + (gender === 'male' ? ' active' : '')}
                      onClick={() => { setGender('male'); markDirty(); }}
                    >
                      Male
                    </button>
                    <button
                      type="button"
                      className={'skill-level-btn' + (gender === 'female' ? ' active' : '')}
                      onClick={() => { setGender('female'); markDirty(); }}
                    >
                      Female
                    </button>
                  </div>

                  {/* TDEE estimate */}
                  {(() => {
                    const bw = bodyweight ? parseFloat(bodyweight) : null;
                    const ageNum = age ? parseInt(age, 10) : null;
                    const heightNum = height ? parseFloat(height) : null;
                    const calc = calculateTDEE({ bodyweight: bw, height: heightNum, age: ageNum, gender: gender || null, units });
                    const effectiveTdee = tdeeOverride ? parseInt(tdeeOverride, 10) : calc?.tdee;
                    const isOverridden = tdeeOverride !== '';

                    return (
                      <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editingTdee ? 10 : 0 }}>
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 2 }}>
                              Estimated TDEE{isOverridden ? ' (custom)' : ''}
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: effectiveTdee ? 'var(--text)' : 'var(--text-muted)' }}>
                              {effectiveTdee ? `${effectiveTdee.toLocaleString()} cal/day` : 'Enter profile data above'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="skill-level-btn"
                            style={{ fontSize: 12 }}
                            onClick={() => setEditingTdee(e => !e)}
                          >
                            {editingTdee ? 'Done' : 'Override'}
                          </button>
                        </div>
                        {editingTdee && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              className="lift-input"
                              type="number"
                              min="0"
                              step="50"
                              placeholder={calc?.tdee ? String(calc.tdee) : 'e.g. 2500'}
                              value={tdeeOverride}
                              onChange={e => { setTdeeOverride(e.target.value); markDirty(); }}
                              style={{ flex: 1 }}
                            />
                            {isOverridden && (
                              <button
                                type="button"
                                className="skill-level-btn"
                                style={{ fontSize: 11, color: 'var(--accent)' }}
                                onClick={() => setTdeeOverride('')}
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Equipment */}
                <CollapsibleSection title="Equipment">
                  <p className="athlete-card-subtitle">Uncheck any equipment you don't have or don't want programmed.</p>
                  {EQUIPMENT_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>{group.title}</h3>
                      <div className="skill-list">
                        {group.items.map(item => (
                          <label
                            key={item.key}
                            className="skill-row"
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                          >
                            <span className="skill-name">{item.label}</span>
                            <input
                              type="checkbox"
                              checked={equipment[item.key] ?? true}
                              onChange={e => { setEquipment(prev => ({ ...prev, [item.key]: e.target.checked })); markDirty(); }}
                              style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer' }}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </CollapsibleSection>

                {/* 1RM Lifts */}
                <CollapsibleSection title={`1RM Lifts (${units})`}>
                  <p className="athlete-card-subtitle">Enter your one-rep max weights in {units}</p>
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
                              step={units === 'kg' ? 2.5 : 5}
                              placeholder="0"
                              value={lifts[lift.key] || ''}
                              onChange={e => setLift(lift.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CollapsibleSection>

                {/* Skills Assessment */}
                <CollapsibleSection title="Skills Assessment">
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
                </CollapsibleSection>

                {/* Conditioning Benchmarks */}
                <CollapsibleSection title="Conditioning Benchmarks">
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
                </CollapsibleSection>

                <button
                  className="auth-btn"
                  onClick={async () => {
                    await saveProfile();
                    if (isDirty) return; // save failed
                    if (!hasGeneratedProgram) fetchProfileAnalysis();
                  }}
                  disabled={saving || !!analysisLoading}
                  style={!isDirty && !analysisLoading ? { background: '#2ec486', color: 'white' } : undefined}
                >
                  {saving ? 'Saving...' : analysisLoading === 'profile' ? 'Analyzing...' : !isDirty ? 'Saved ✓' : hasGeneratedProgram ? 'Save Profile' : 'Save & Analyze'}
                </button>

                {/* Generate Program — hidden once a program exists (auto-generated monthly) */}
                {(!hasGeneratedProgram || isAdmin) && (() => {
                  const canGenerate = isAdmin || hasFeature('programming');
                  const isFreeUser = !hasFeature('ai_chat') && !hasFeature('engine') && !hasFeature('programming') && !hasFeature('nutrition') && !isAdmin;
                  const upgradeRoute = isFreeUser ? '/checkout' : '/settings';
                  return (
                    <>
                      <button
                        type="button"
                        className="auth-btn"
                        style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                        onClick={canGenerate ? handleGenerateProgram : () => navigate(upgradeRoute)}
                        disabled={canGenerate && generateLoading}
                      >
                        {canGenerate ? (
                          generateLoading ? 'Generating...' : isAdmin && hasGeneratedProgram ? 'Generate Program (Admin)' : 'Generate Program'
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                            Generate Program
                          </span>
                        )}
                      </button>
                      {!canGenerate && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>Requires AI Programming or All Access subscription</span>
                      )}
                    </>
                  );
                })()}

                {/* AI Evaluation History */}
                {(evaluations.length > 0 || trainingEvaluations.length > 0 || nutritionEvaluations.length > 0) && (
                  <CollapsibleSection title="AI Evaluation History">
                  <p className="athlete-card-subtitle" style={{ marginBottom: 12 }}>Past AI evaluations. Click to expand.</p>

                  {evaluations.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>Profile Evaluations</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: trainingEvaluations.length > 0 ? 20 : 0 }}>
                        {evaluations.map((ev, idx) => {
                          const isExpanded = expandedEvalId === ev.id;
                          const prevEval = evaluations[idx + 1] || null;
                          const diffs = prevEval ? buildProfileDiffs(prevEval.profile_snapshot, ev.profile_snapshot) : [];
                          const monthLabel = (ev as any).month_number > 1 ? `Month ${(ev as any).month_number} — ` : '';

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
                                <span style={{ fontWeight: 600 }}>{monthLabel}{formatDate(ev.created_at)}</span>
                                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                              </button>
                              {isExpanded && (
                                <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
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
                                  {(() => {
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
                                  })()}
                                  {ev.analysis && (
                                    <div className="workout-review-section" style={{ marginTop: 0 }}>
                                      <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(ev.analysis) }} />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {trainingEvaluations.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>Training Evaluations</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: nutritionEvaluations.length > 0 ? 20 : 0 }}>
                        {trainingEvaluations.map((ev) => {
                          const isExpanded = expandedEvalId === ev.id;

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
                                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                              </button>
                              {isExpanded && (
                                <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
                                  {ev.analysis && (
                                    <div className="workout-review-section" style={{ marginTop: 0 }}>
                                      <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(ev.analysis) }} />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {nutritionEvaluations.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>Nutrition Evaluations</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {nutritionEvaluations.map((ev) => {
                          const isExpanded = expandedEvalId === ev.id;

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
                                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                              </button>
                              {isExpanded && (
                                <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
                                  {ev.analysis && (
                                    <div className="workout-review-section" style={{ marginTop: 0 }}>
                                      <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(ev.analysis) }} />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  </CollapsibleSection>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
