import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import {
  loadWorkoutForDay,
  loadTimeTrialBaselines,
  loadModalityPreference,
  saveModalityPreference,
  saveWorkoutSession,
  saveTimeTrial,
  updatePerformanceMetrics,
  advanceCurrentDay,
  loadUserProgress,
  getWorkoutSessionByDay,
  type EngineWorkout,
  type EngineTimeTrial,
} from '../lib/engineService';
import EnginePaywall from '../components/engine/EnginePaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, Play, Pause, Square, Check, RotateCcw } from 'lucide-react';

// ── Types & Constants ────────────────────────────────────────────────

type Stage = 'loading' | 'equipment' | 'preview' | 'active' | 'logging' | 'complete';

interface BlockParams {
  rounds?: number | number[];
  paceRange?: number[] | string;
  workDuration?: number | number[];
  restDuration?: number | number[] | string;
  workProgression?: string;
  total_intervals?: number;
  work_to_rest_ratio?: number;
  basePace?: number[];
  burstTiming?: string;
  burstDuration?: number;
  burstIntensity?: string;
  baseDuration?: number | number[];
  fluxDuration?: number | number[];
  fluxPaceRange?: number[];
  fluxIntensity?: number;
  workDurationOptions?: number[];
  restDurationOptions?: number[];
}

interface Segment {
  type: 'work' | 'rest' | 'block-rest';
  duration: number;
  blockIndex: number;
  roundIndex: number;
  label: string;
  intensity: string;
}

const MODALITIES = [
  { id: 'row', label: 'Rower' },
  { id: 'bike', label: 'Bike' },
  { id: 'ski', label: 'Ski Erg' },
  { id: 'run', label: 'Run' },
];

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatPace(pace: number[] | string | undefined): string {
  if (!pace) return '';
  if (pace === 'max_effort') return 'MAX';
  if (Array.isArray(pace)) {
    const [min, max] = pace;
    if (min === max) return `${Math.round(min * 100)}%`;
    return `${Math.round(min * 100)}–${Math.round(max * 100)}%`;
  }
  return String(pace);
}

function resolveNum(v: number | number[] | undefined, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v[0];
  return fallback;
}

function resolveRest(rest: number | number[] | string | undefined, workDur: number): number {
  if (rest === undefined || rest === null) return 0;
  if (typeof rest === 'number') return rest;
  if (Array.isArray(rest)) return rest[0];
  if (rest === 'equal_to_work') return workDur;
  if (rest === 'five_times_work') return workDur * 5;
  if (rest === 'half_work') return Math.round(workDur / 2);
  if (rest === 'double_work') return workDur * 2;
  if (rest === 'one_third_work') return Math.round(workDur / 3);
  return 0;
}

function parseBurstTiming(timing: string): number {
  const match = timing.match(/every_(\d+)_minutes/);
  return match ? parseInt(match[1]) * 60 : 300;
}

function dayTypeBadge(dayType: string): string {
  switch (dayType) {
    case 'endurance': case 'endurance_long': return 'engine-badge--endurance';
    case 'threshold': case 'threshold_stepped': case 'anaerobic': return 'engine-badge--strength';
    case 'polarized': case 'flux': return 'engine-badge--power';
    case 'time_trial': return 'engine-badge--hypertrophy';
    default: return 'engine-badge--default';
  }
}

function generateSegments(workout: EngineWorkout): Segment[] {
  const segments: Segment[] = [];
  const blockParams: (Record<string, unknown> | null)[] = [
    workout.block_1_params,
    workout.block_2_params,
    workout.block_3_params,
    workout.block_4_params,
  ];
  const blockCount = workout.block_count ?? 1;

  for (let b = 0; b < blockCount; b++) {
    const raw = blockParams[b];
    if (!raw) continue;
    const bp = raw as unknown as BlockParams;

    const rounds = resolveNum(bp.rounds, 1);
    const workDur = resolveNum(bp.workDuration, 0);
    const restDur = resolveRest(bp.restDuration, workDur);

    if (workDur === 0) continue;

    // ── Flux (alternating paces) ──
    if (bp.workProgression === 'alternating_paces' && bp.baseDuration && bp.fluxDuration) {
      const baseDur = resolveNum(bp.baseDuration, 300);
      const fluxDur = resolveNum(bp.fluxDuration, 60);
      let remaining = workDur;
      let round = 0;
      while (remaining > 0) {
        const bSeg = Math.min(baseDur, remaining);
        segments.push({ type: 'work', duration: bSeg, blockIndex: b, roundIndex: round, label: 'Base', intensity: formatPace(bp.basePace) });
        remaining -= bSeg;
        if (remaining <= 0) break;
        const fSeg = Math.min(fluxDur, remaining);
        segments.push({ type: 'work', duration: fSeg, blockIndex: b, roundIndex: round, label: 'Flux', intensity: formatPace(bp.fluxPaceRange ?? bp.paceRange) });
        remaining -= fSeg;
        round++;
      }

    // ── Polarized (continuous with bursts) ──
    } else if (bp.workProgression === 'continuous_with_bursts' && bp.burstTiming && bp.burstDuration) {
      const burstInterval = parseBurstTiming(bp.burstTiming);
      const burstDur = bp.burstDuration;
      let remaining = workDur;
      let round = 0;
      while (remaining > 0) {
        const baseSeg = Math.min(burstInterval, remaining);
        segments.push({ type: 'work', duration: baseSeg, blockIndex: b, roundIndex: round, label: 'Base', intensity: formatPace(bp.basePace) });
        remaining -= baseSeg;
        if (remaining <= 0) break;
        const bSeg = Math.min(burstDur, remaining);
        segments.push({ type: 'work', duration: bSeg, blockIndex: b, roundIndex: round, label: 'BURST', intensity: 'MAX' });
        remaining -= bSeg;
        round++;
      }

    // ── Standard intervals ──
    } else {
      for (let r = 0; r < rounds; r++) {
        const label = bp.paceRange === 'max_effort' ? 'Max Effort' : 'Work';
        segments.push({ type: 'work', duration: workDur, blockIndex: b, roundIndex: r, label, intensity: formatPace(bp.paceRange) });
        if (restDur > 0 && r < rounds - 1) {
          segments.push({ type: 'rest', duration: restDur, blockIndex: b, roundIndex: r, label: 'Rest', intensity: '' });
        }
      }
    }

    // Block rest between blocks
    if (b < blockCount - 1 && workout.set_rest_seconds) {
      segments.push({ type: 'block-rest', duration: workout.set_rest_seconds, blockIndex: b, roundIndex: 0, label: 'Block Rest', intensity: '' });
    }
  }

  return segments;
}

function totalSegmentDuration(segs: Segment[]): number {
  return segs.reduce((sum, s) => sum + s.duration, 0);
}

// ── Component ────────────────────────────────────────────────────────

export default function EngineTrainingDayPage({ session }: { session: Session }) {
  const { dayNumber: dayParam } = useParams<{ dayNumber: string }>();
  const dayNumber = parseInt(dayParam ?? '1', 10);
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  // ── Core state ──
  const [stage, setStage] = useState<Stage>('loading');
  const [workout, setWorkout] = useState<EngineWorkout | null>(null);
  const [modality, setModality] = useState('row');
  const [baseline, setBaseline] = useState<EngineTimeTrial | null>(null);
  const [previousSession, setPreviousSession] = useState<boolean>(false);
  const [currentDay, setCurrentDay] = useState(1);
  const { hasFeature } = useEntitlements(session.user.id);
  const hasAccess = hasFeature('engine');

  // ── Timer state ──
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segIndex, setSegIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const segIndexRef = useRef(0);
  const segmentsRef = useRef<Segment[]>([]);

  // ── Logging state ──
  const [logOutput, setLogOutput] = useState('');
  const [logAvgHR, setLogAvgHR] = useState('');
  const [logPeakHR, setLogPeakHR] = useState('');
  const [logRPE, setLogRPE] = useState(5);
  const [logUnits, setLogUnits] = useState('cal');
  const [saving, setSaving] = useState(false);

  // ── Load data ──
  useEffect(() => {
    (async () => {
      try {
        const [wk, progress, prevSession] = await Promise.all([
          loadWorkoutForDay(dayNumber),
          loadUserProgress(),
          getWorkoutSessionByDay(dayNumber),
        ]);
        setWorkout(wk);
        setCurrentDay(progress?.engine_current_day ?? 1);
        setPreviousSession(!!prevSession);

        // Try to load saved modality preference
        const pref = await loadModalityPreference('row').catch(() => null);
        if (pref) setModality(pref.modality);

        if (wk) {
          setStage('equipment');
        } else {
          setStage('loading'); // will show not-found
        }
      } catch {
        setStage('loading');
      }
    })();
  }, [dayNumber]);

  // Sync refs
  useEffect(() => { segIndexRef.current = segIndex; }, [segIndex]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  // ── Timer effect ──
  useEffect(() => {
    if (stage !== 'active' || isPaused) return;
    const id = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          const nextIdx = segIndexRef.current + 1;
          if (nextIdx >= segmentsRef.current.length) {
            setStage('logging');
            return 0;
          }
          segIndexRef.current = nextIdx;
          setSegIndex(nextIdx);
          return segmentsRef.current[nextIdx].duration;
        }
        return prev - 1;
      });
      setTotalElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [stage, isPaused]);

  // ── Handlers ──

  const handleSelectModality = async (mod: string) => {
    setModality(mod);
    try {
      const [bl] = await Promise.all([
        loadTimeTrialBaselines(mod).then(arr => arr[0] ?? null),
        saveModalityPreference({ modality: mod, primary_unit: 'cal', secondary_unit: null }),
      ]);
      setBaseline(bl);
    } catch {
      setBaseline(null);
    }
  };

  const handleStartWorkout = () => {
    if (!workout) return;
    const segs = generateSegments(workout);
    if (segs.length === 0) {
      // Edge case: go straight to logging
      setStage('logging');
      return;
    }
    setSegments(segs);
    segmentsRef.current = segs;
    setSegIndex(0);
    segIndexRef.current = 0;
    setTimeLeft(segs[0].duration);
    setTotalElapsed(0);
    setIsPaused(false);
    setStage('active');
  };

  const handleEndWorkout = () => {
    setIsPaused(true);
    setStage('logging');
  };

  const handleSave = async () => {
    if (!workout) return;
    setSaving(true);
    try {
      const output = parseFloat(logOutput) || 0;
      const durationMin = (workout.total_duration_minutes ?? 0) || Math.round(totalElapsed / 60);
      const rpm = durationMin > 0 ? output / durationMin : 0;
      const baselineRpm = baseline?.calculated_rpm ?? 0;
      const targetPace = baselineRpm > 0 && workout.base_intensity_percent
        ? baselineRpm * (workout.base_intensity_percent / 100)
        : null;
      const perfRatio = targetPace && targetPace > 0 ? rpm / targetPace : null;

      // Save session
      await saveWorkoutSession({
        date: new Date().toISOString().split('T')[0],
        program_day: dayNumber,
        program_day_number: dayNumber,
        day_type: workout.day_type,
        modality,
        units: logUnits,
        target_pace: targetPace,
        actual_pace: rpm,
        total_output: output,
        performance_ratio: perfRatio,
        calculated_rpm: rpm,
        average_heart_rate: parseInt(logAvgHR) || null,
        peak_heart_rate: parseInt(logPeakHR) || null,
        perceived_exertion: logRPE,
        workout_data: null,
        completed: true,
        program_version: '5-day',
      });

      // Save time trial baseline if this is a time trial
      if (workout.day_type === 'time_trial' && output > 0) {
        await saveTimeTrial({
          modality,
          total_output: output,
          calculated_rpm: rpm,
          units: logUnits,
        });
      }

      // Update performance metrics
      if (perfRatio != null && rpm > 0) {
        await updatePerformanceMetrics(workout.day_type, modality, perfRatio, rpm).catch(() => {});
      }

      // Advance day if this is the current day
      if (dayNumber >= currentDay) {
        await advanceCurrentDay(dayNumber + 1).catch(() => {});
      }

      setStage('complete');
    } catch {
      // still mark complete so user isn't stuck
      setStage('complete');
    }
    setSaving(false);
  };

  // ── Derived ──
  const seg = segments[segIndex] ?? null;
  const segProgress = seg ? 1 - (timeLeft / seg.duration) : 0;
  const totalDur = totalSegmentDuration(segments);
  const overallProgress = totalDur > 0 ? totalElapsed / totalDur : 0;
  const isTimeTrial = workout?.day_type === 'time_trial';

  // ── Block preview data ──
  function getBlocks(): { index: number; bp: BlockParams; }[] {
    if (!workout) return [];
    const raw = [workout.block_1_params, workout.block_2_params, workout.block_3_params, workout.block_4_params];
    const result: { index: number; bp: BlockParams }[] = [];
    for (let i = 0; i < (workout.block_count ?? 1); i++) {
      if (raw[i]) result.push({ index: i, bp: raw[i] as unknown as BlockParams });
    }
    return result;
  }

  // ── Render: Equipment Selection ──

  function renderEquipment() {
    return (
      <div className="engine-page">
        <div className="engine-section">
          <button
            className="engine-btn engine-btn-secondary engine-btn-sm"
            onClick={() => navigate('/engine')}
          >
            <ChevronLeft size={16} /> Dashboard
          </button>

          <div className="engine-card">
            <div className="engine-section">
              <div>
                <h2 className="engine-header">Day {dayNumber}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span className={'engine-badge ' + dayTypeBadge(workout?.day_type ?? '')}>
                    {(workout?.day_type ?? '').replace(/_/g, ' ')}
                  </span>
                  {workout?.total_duration_minutes && (
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                      {workout.total_duration_minutes} min
                    </span>
                  )}
                  {previousSession && (
                    <span className="engine-badge engine-badge--endurance">
                      <Check size={10} /> Done
                    </span>
                  )}
                </div>
              </div>

              <hr className="engine-divider" />

              <div>
                <span className="engine-label">Select Equipment</span>
                <div className="engine-grid">
                  {MODALITIES.map(m => (
                    <button
                      key={m.id}
                      className="engine-card"
                      onClick={() => handleSelectModality(m.id)}
                      style={{
                        cursor: 'pointer',
                        textAlign: 'center',
                        padding: '16px 12px',
                        transition: 'all .2s',
                        borderColor: modality === m.id ? 'var(--accent)' : undefined,
                        boxShadow: modality === m.id ? '0 0 20px var(--accent-glow)' : undefined,
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 600, color: modality === m.id ? 'var(--text)' : 'var(--text-dim)' }}>
                        {m.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {baseline && (
                <div className="engine-stat" style={{ textAlign: 'center' }}>
                  <div className="engine-stat-label">Current Baseline</div>
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>
                    {baseline.total_output} {baseline.units ?? 'cal'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {baseline.calculated_rpm ? `${baseline.calculated_rpm.toFixed(1)} ${baseline.units ?? 'cal'}/min` : ''}
                  </div>
                </div>
              )}

              {!baseline && modality && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No baseline recorded for {MODALITIES.find(m => m.id === modality)?.label}.
                  {isTimeTrial ? ' This time trial will set your first baseline.' : ' Complete a time trial to set pace targets.'}
                </div>
              )}

              <button
                className="engine-btn engine-btn-primary"
                onClick={() => setStage('preview')}
                style={{ width: '100%' }}
              >
                <Play size={18} /> Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Preview ──

  function renderPreview() {
    const blocks = getBlocks();
    const baselineRpm = baseline?.calculated_rpm ?? 0;

    return (
      <div className="engine-page">
        <div className="engine-section">
          <button
            className="engine-btn engine-btn-secondary engine-btn-sm"
            onClick={() => setStage('equipment')}
          >
            <ChevronLeft size={16} /> Back
          </button>

          <div className="engine-card">
            <div className="engine-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 className="engine-header">
                  {isTimeTrial ? 'Time Trial' : `Day ${dayNumber}`}
                </h2>
                <span className={'engine-badge ' + dayTypeBadge(workout?.day_type ?? '')}>
                  {(workout?.day_type ?? '').replace(/_/g, ' ')}
                </span>
              </div>

              {isTimeTrial && (
                <p className="engine-subheader">
                  All-out effort for {formatDuration(resolveNum(blocks[0]?.bp.workDuration, 600))}.
                  Your result sets pace targets for future workouts.
                </p>
              )}

              <hr className="engine-divider" />

              {/* Stats row */}
              <div className="engine-grid">
                <div className="engine-stat">
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>
                    {workout?.total_duration_minutes ?? '—'}
                  </div>
                  <div className="engine-stat-label">Minutes</div>
                </div>
                <div className="engine-stat">
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>
                    {workout?.block_count ?? 1}
                  </div>
                  <div className="engine-stat-label">Blocks</div>
                </div>
              </div>

              {/* Block breakdown */}
              {blocks.map(({ index, bp }) => {
                const rounds = resolveNum(bp.rounds, 1);
                const workDur = resolveNum(bp.workDuration, 0);
                const restDur = resolveRest(bp.restDuration, workDur);
                const pace = formatPace(bp.paceRange);
                const targetRpm = baselineRpm > 0 && Array.isArray(bp.paceRange)
                  ? `${(baselineRpm * bp.paceRange[0]).toFixed(1)}–${(baselineRpm * bp.paceRange[1]).toFixed(1)} ${baseline?.units ?? 'cal'}/min`
                  : null;

                return (
                  <div key={index} style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '14px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)' }}>
                        Block {index + 1}
                      </span>
                      {pace && (
                        <span className={'engine-badge ' + (pace === 'MAX' ? 'engine-badge--strength' : 'engine-badge--default')}>
                          {pace}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-dim)' }}>
                      <span>{rounds} round{rounds !== 1 ? 's' : ''}</span>
                      <span>Work: {formatDuration(workDur)}</span>
                      {restDur > 0 && <span>Rest: {formatDuration(restDur)}</span>}
                    </div>

                    {bp.workProgression === 'continuous_with_bursts' && bp.burstTiming && (
                      <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>
                        Bursts {bp.burstTiming.replace(/_/g, ' ')} ({bp.burstDuration}s max effort)
                      </div>
                    )}

                    {bp.workProgression === 'alternating_paces' && (
                      <div style={{ fontSize: 12, color: '#c084fc', marginTop: 6 }}>
                        Alternating base ({formatDuration(resolveNum(bp.baseDuration))}) / flux ({formatDuration(resolveNum(bp.fluxDuration))})
                      </div>
                    )}

                    {targetRpm && (
                      <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>
                        Target: {targetRpm}
                      </div>
                    )}
                  </div>
                );
              })}

              {workout?.set_rest_seconds && blocks.length > 1 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {workout.set_rest_seconds}s rest between blocks
                </div>
              )}

              <button
                className="engine-btn engine-btn-primary"
                onClick={handleStartWorkout}
                style={{ width: '100%' }}
              >
                <Play size={18} /> Start Workout
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Active Workout ──

  function renderActive() {
    const isBurst = seg?.label === 'BURST';
    const isFlux = seg?.label === 'Flux';
    const isRest = seg?.type === 'rest' || seg?.type === 'block-rest';

    const bgColor = isBurst
      ? 'rgba(239,68,68,.1)'
      : isFlux
        ? 'rgba(168,85,247,.1)'
        : isRest
          ? 'var(--surface)'
          : 'var(--bg)';

    const timerColor = isBurst
      ? '#f87171'
      : isFlux
        ? '#c084fc'
        : isRest
          ? 'var(--text-muted)'
          : 'var(--text)';

    // Count work segments for round display
    const workSegsInBlock = segments.filter(
      s => s.blockIndex === (seg?.blockIndex ?? 0) && s.type === 'work' && s.label !== 'BURST',
    );
    const currentRoundInBlock = seg
      ? segments.slice(0, segIndex + 1).filter(
          s => s.blockIndex === seg.blockIndex && s.type === 'work' && s.label !== 'BURST',
        ).length
      : 0;

    return (
      <div className="engine-page" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Segment label */}
        <div style={{ textAlign: 'center' }}>
          <span
            className={'engine-badge ' + (
              isBurst ? 'engine-badge--strength' :
              isFlux ? 'engine-badge--hypertrophy' :
              isRest ? 'engine-badge--default' :
              'engine-badge--endurance'
            )}
            style={{ fontSize: 14, padding: '6px 16px' }}
          >
            {seg?.label ?? 'Ready'}
          </span>
        </div>

        {/* Timer */}
        <div
          className="engine-card"
          style={{ textAlign: 'center', background: bgColor, transition: 'background .3s' }}
        >
          <div className="engine-timer" style={{ color: timerColor }}>
            {formatTime(timeLeft)}
          </div>

          {seg?.intensity && (
            <div style={{ fontSize: 16, fontWeight: 600, color: timerColor, marginTop: 8 }}>
              {seg.intensity}
            </div>
          )}

          {/* Segment progress */}
          <div className="engine-progress-bar" style={{ marginTop: 16, height: 4 }}>
            <div
              className="engine-progress-fill"
              style={{
                width: `${segProgress * 100}%`,
                background: isBurst ? '#f87171' : isFlux ? '#c084fc' : undefined,
              }}
            />
          </div>
        </div>

        {/* Info row */}
        <div className="engine-grid">
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value" style={{ fontSize: 20 }}>
              {seg ? `${seg.blockIndex + 1}/${workout?.block_count ?? 1}` : '—'}
            </div>
            <div className="engine-stat-label">Block</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value" style={{ fontSize: 20 }}>
              {workSegsInBlock.length > 1 ? `${currentRoundInBlock}/${workSegsInBlock.length}` : '—'}
            </div>
            <div className="engine-stat-label">Round</div>
          </div>
        </div>

        {/* Overall progress */}
        <div className="engine-progress">
          <div className="engine-progress-header">
            <span className="engine-progress-label">Total</span>
            <span className="engine-progress-count">{formatTime(totalElapsed)} elapsed</span>
          </div>
          <div className="engine-progress-bar">
            <div className="engine-progress-fill" style={{ width: `${Math.min(overallProgress * 100, 100)}%` }} />
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            className="engine-btn engine-btn-secondary"
            onClick={() => setIsPaused(!isPaused)}
            style={{ flex: 1, maxWidth: 200 }}
          >
            {isPaused ? <><Play size={18} /> Resume</> : <><Pause size={18} /> Pause</>}
          </button>
          <button
            className="engine-btn engine-btn-secondary"
            onClick={handleEndWorkout}
            style={{ flex: 1, maxWidth: 200, borderColor: 'rgba(239,68,68,.3)', color: '#f87171' }}
          >
            <Square size={18} /> End
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Logging ──

  function renderLogging() {
    return (
      <div className="engine-page">
        <div className="engine-card">
          <div className="engine-section">
            <h2 className="engine-header">
              {isTimeTrial ? 'Record Baseline' : 'Log Results'}
            </h2>
            <p className="engine-subheader">
              {isTimeTrial
                ? 'Enter your total output. This sets your pace targets for future workouts.'
                : `Day ${dayNumber} — ${(workout?.day_type ?? '').replace(/_/g, ' ')}`
              }
            </p>

            <hr className="engine-divider" />

            {/* Output */}
            <div>
              <span className="engine-label">Total Output</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="engine-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 150"
                  value={logOutput}
                  onChange={e => setLogOutput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select
                  className="engine-select"
                  value={logUnits}
                  onChange={e => setLogUnits(e.target.value)}
                  style={{ width: 100, flex: 'none' }}
                >
                  <option value="cal">cal</option>
                  <option value="meters">m</option>
                  <option value="miles">mi</option>
                </select>
              </div>
            </div>

            {/* Heart rate */}
            {!isTimeTrial && (
              <div className="engine-grid">
                <div>
                  <span className="engine-label">Avg Heart Rate</span>
                  <input
                    className="engine-input"
                    type="number"
                    inputMode="numeric"
                    placeholder="bpm"
                    value={logAvgHR}
                    onChange={e => setLogAvgHR(e.target.value)}
                  />
                </div>
                <div>
                  <span className="engine-label">Peak Heart Rate</span>
                  <input
                    className="engine-input"
                    type="number"
                    inputMode="numeric"
                    placeholder="bpm"
                    value={logPeakHR}
                    onChange={e => setLogPeakHR(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* RPE */}
            <div>
              <span className="engine-label">RPE (1–10)</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    className="engine-card"
                    onClick={() => setLogRPE(n)}
                    style={{
                      flex: 1,
                      padding: '10px 0',
                      textAlign: 'center',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 700,
                      transition: 'all .15s',
                      borderColor: logRPE === n ? 'var(--accent)' : undefined,
                      background: logRPE === n ? 'var(--accent-glow)' : undefined,
                      color: logRPE === n ? 'var(--accent)' : 'var(--text-dim)',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration summary */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-dim)' }}>
              <span>Duration: {formatTime(totalElapsed)}</span>
              {logOutput && (
                <span>
                  Pace: {(parseFloat(logOutput) / Math.max(totalElapsed / 60, 1)).toFixed(1)} {logUnits}/min
                </span>
              )}
            </div>

            <button
              className="engine-btn engine-btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ width: '100%' }}
            >
              {saving ? 'Saving...' : <><Check size={18} /> {isTimeTrial ? 'Save Baseline' : 'Save Session'}</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Complete ──

  function renderComplete() {
    return (
      <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="engine-card" style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
          <div className="engine-section" style={{ alignItems: 'center' }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'rgba(34,197,94,.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4ade80',
            }}>
              <Check size={28} />
            </div>

            <h2 className="engine-header">
              {isTimeTrial ? 'Baseline Saved' : 'Workout Complete'}
            </h2>
            <p className="engine-subheader">
              Day {dayNumber} — {(workout?.day_type ?? '').replace(/_/g, ' ')}
            </p>

            {/* Summary stats */}
            <div className="engine-grid" style={{ width: '100%' }}>
              {logOutput && (
                <div className="engine-stat" style={{ textAlign: 'center' }}>
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>
                    {logOutput}
                  </div>
                  <div className="engine-stat-label">{logUnits}</div>
                </div>
              )}
              <div className="engine-stat" style={{ textAlign: 'center' }}>
                <div className="engine-stat-value" style={{ fontSize: 22 }}>
                  {formatTime(totalElapsed)}
                </div>
                <div className="engine-stat-label">Duration</div>
              </div>
            </div>

            <hr className="engine-divider" style={{ width: '100%' }} />

            <button
              className="engine-btn engine-btn-primary"
              onClick={() => navigate('/engine')}
              style={{ width: '100%' }}
            >
              Back to Dashboard
            </button>
            {dayNumber < (workout ? 720 : 1) && (
              <button
                className="engine-btn engine-btn-secondary"
                onClick={() => navigate(`/engine/training/${dayNumber + 1}`)}
                style={{ width: '100%' }}
              >
                Next Day <RotateCcw size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main Render ──

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Day {dayNumber}</h1>
          {workout && (
            <span className={'engine-badge ' + dayTypeBadge(workout.day_type)}>
              {workout.day_type.replace(/_/g, ' ')}
            </span>
          )}
        </header>

        {!hasAccess && stage !== 'loading' && <EnginePaywall />}
        {hasAccess && stage === 'loading' && !workout && (
          <div className="engine-page">
            <div className="engine-empty">
              <div className="engine-empty-title">Workout not found</div>
              <div className="engine-empty-desc">Day {dayNumber} doesn't exist in this program.</div>
              <button className="engine-btn engine-btn-secondary" onClick={() => navigate('/engine')}>
                <ChevronLeft size={16} /> Dashboard
              </button>
            </div>
          </div>
        )}
        {hasAccess && stage === 'loading' && workout === null && !dayParam && (
          <div className="page-loading"><div className="loading-pulse" /></div>
        )}
        {hasAccess && stage === 'equipment' && renderEquipment()}
        {hasAccess && stage === 'preview' && renderPreview()}
        {hasAccess && stage === 'active' && renderActive()}
        {hasAccess && stage === 'logging' && renderLogging()}
        {hasAccess && stage === 'complete' && renderComplete()}
      </div>
    </div>
  );
}
