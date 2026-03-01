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
  getSessionsByDayType,
  getPerformanceMetrics,
  type EngineWorkout,
  type EngineWorkoutSession,
  type EngineTimeTrial,
  type EnginePerformanceMetrics,
  calculateWorkDurationMinutes,
} from '../lib/engineService';
import EnginePaywall from '../components/engine/EnginePaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, ChevronDown, Play, Pause, Square, Check, RotateCcw, AlertTriangle } from 'lucide-react';

// ── Types & Constants ────────────────────────────────────────────────

type Stage = 'loading' | 'equipment' | 'preview' | 'ready' | 'active' | 'logging' | 'complete';

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

// ── Equipment taxonomy (matches mobile app) ──

interface Modality {
  value: string;
  label: string;
  category: string;
}

const CATEGORIES = ['Rowing', 'Cycling', 'Ski', 'Treadmill', 'Running'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  Rowing: 'Row',
  Cycling: 'Bike',
  Ski: 'Ski',
  Treadmill: 'Treadmill',
  Running: 'Run',
};

const MODALITIES: Modality[] = [
  { value: 'c2_row_erg', label: 'C2 Rowing Erg', category: 'Rowing' },
  { value: 'rogue_row_erg', label: 'Rogue Rowing Erg', category: 'Rowing' },
  { value: 'c2_bike_erg', label: 'C2 Bike Erg', category: 'Cycling' },
  { value: 'echo_bike', label: 'Echo Bike', category: 'Cycling' },
  { value: 'assault_bike', label: 'Assault Bike', category: 'Cycling' },
  { value: 'airdyne_bike', label: 'AirDyne Bike', category: 'Cycling' },
  { value: 'other_bike', label: 'Other Bike', category: 'Cycling' },
  { value: 'outdoor_bike_ride', label: 'Outdoor Ride', category: 'Cycling' },
  { value: 'c2_ski_erg', label: 'C2 Ski Erg', category: 'Ski' },
  { value: 'assault_runner', label: 'Assault Runner Treadmill', category: 'Treadmill' },
  { value: 'trueform_treadmill', label: 'TrueForm Treadmill', category: 'Treadmill' },
  { value: 'motorized_treadmill', label: 'Motorized Treadmill', category: 'Treadmill' },
  { value: 'outdoor_run', label: 'Outdoor Run', category: 'Running' },
  { value: 'road_run', label: 'Road Run', category: 'Running' },
  { value: 'track_run', label: 'Track Run', category: 'Running' },
  { value: 'trail_run', label: 'Trail Run', category: 'Running' },
  { value: 'trueform', label: 'True Form', category: 'Running' },
  { value: 'assault_runner_run', label: 'Assault Runner', category: 'Running' },
  { value: 'other_treadmill', label: 'Other Treadmill', category: 'Running' },
];

const SCORE_UNITS = [
  { value: 'cal', label: 'Calories' },
  { value: 'watts', label: 'Watts' },
  { value: 'meters', label: 'Meters' },
  { value: 'kilometers', label: 'Kilometers' },
  { value: 'miles', label: 'Miles' },
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
  const [modality, setModality] = useState('');
  const [expandedCategory, setExpandedCategory] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [baseline, setBaseline] = useState<EngineTimeTrial | null>(null);
  const [performanceMetrics, setPerformanceMetrics] = useState<EnginePerformanceMetrics | null>(null);
  const [previousSession, setPreviousSession] = useState<boolean>(false);
  const [dayTypeHistory, setDayTypeHistory] = useState<EngineWorkoutSession[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [currentDay, setCurrentDay] = useState(1);
  const [programVersion, setProgramVersion] = useState('main_5day');
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
        setProgramVersion(progress?.engine_program_version ?? 'main_5day');
        setPreviousSession(!!prevSession);

        // Load workout history for this day type
        if (wk?.day_type) {
          getSessionsByDayType(wk.day_type)
            .then(sessions => setDayTypeHistory(sessions))
            .catch(() => setDayTypeHistory([]));
        }

        // Try to load saved modality + unit preference
        const pref = await loadModalityPreference('last_selected').catch(() => null);
        if (pref) {
          // secondary_unit stores the actual modality value
          if (pref.secondary_unit) setModality(pref.secondary_unit);
          if (pref.primary_unit) setSelectedUnit(pref.primary_unit);
        }

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

  // Load baseline + metrics when modality/unit change
  useEffect(() => {
    if (!modality || !selectedUnit) {
      setBaseline(null);
      return;
    }
    (async () => {
      try {
        const bl = await loadTimeTrialBaselines(modality, selectedUnit).then(arr => arr[0] ?? null);
        setBaseline(bl);
      } catch {
        setBaseline(null);
      }
      if (workout?.day_type) {
        try {
          const metrics = await getPerformanceMetrics(workout.day_type, modality);
          setPerformanceMetrics(metrics);
        } catch {
          setPerformanceMetrics(null);
        }
      }
    })();
  }, [modality, selectedUnit, workout?.day_type]);

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

  const handleSelectCategory = (category: string) => {
    if (expandedCategory === category) {
      setExpandedCategory('');
    } else {
      setExpandedCategory(category);
    }
  };

  const saveLastSelected = (mod: string, unit: string) => {
    // Save per-modality unit preference
    if (mod && unit) {
      saveModalityPreference({ modality: mod, primary_unit: unit, secondary_unit: null }).catch(() => {});
    }
    // Save last_selected: primary_unit = unit, secondary_unit = modality value
    saveModalityPreference({
      modality: 'last_selected',
      primary_unit: unit || null,
      secondary_unit: mod || null,
    }).catch(() => {});
  };

  const handleSelectModality = async (mod: string) => {
    setModality(mod);
    setExpandedCategory('');
    // Load saved unit preference for this modality
    const pref = await loadModalityPreference(mod).catch(() => null);
    if (pref?.primary_unit) {
      setSelectedUnit(pref.primary_unit);
      saveLastSelected(mod, pref.primary_unit);
    } else {
      saveLastSelected(mod, selectedUnit);
    }
  };

  const handleSelectUnit = (unit: string) => {
    setSelectedUnit(unit);
    saveLastSelected(modality, unit);
  };

  const handleContinueToPreview = () => {
    if (!modality || !selectedUnit) return;
    saveLastSelected(modality, selectedUnit);
    setStage('preview');
  };

  const hasMatchingBaseline = !!(baseline && baseline.units === selectedUnit);

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
    setIsPaused(true);
    setStage('ready');
  };

  const handleBeginCountdown = () => {
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
      const durationMin = calculateWorkDurationMinutes(workout) || Math.round(totalElapsed / 60);
      const rpm = durationMin > 0 ? output / durationMin : 0;
      const baselineRpm = baseline?.calculated_rpm ?? 0;

      // Weighted target pace across all work segments (matches mobile app)
      let targetPace: number | null = null;
      if (baselineRpm > 0) {
        const workSegs = segments.filter(s => s.type === 'work');
        if (workSegs.length > 0) {
          let totalTargetPace = 0;
          let totalTargetDuration = 0;

          for (const seg of workSegs) {
            // Find the block params for this segment's block
            const raw = [workout.block_1_params, workout.block_2_params, workout.block_3_params, workout.block_4_params][seg.blockIndex];
            const bp = raw as unknown as BlockParams | null;
            if (!bp) continue;

            const paceRange = seg.label === 'Flux'
              ? (bp.fluxPaceRange ?? bp.paceRange)
              : bp.paceRange;

            const isMaxEffort = paceRange === 'max_effort' || seg.label === 'BURST' || seg.label === 'Max Effort';

            if (!isMaxEffort && Array.isArray(paceRange) && paceRange.length >= 2) {
              let intensityMult = (paceRange[0] + paceRange[1]) / 2;
              // Apply rolling average ratio adjustment (matches mobile app)
              if (performanceMetrics?.rolling_avg_ratio) {
                intensityMult *= performanceMetrics.rolling_avg_ratio;
              }
              const segTarget = baselineRpm * intensityMult;
              totalTargetPace += segTarget * seg.duration;
              totalTargetDuration += seg.duration;
            }
          }

          if (totalTargetDuration > 0) {
            targetPace = totalTargetPace / totalTargetDuration;
          }
        } else if (workout.base_intensity_percent) {
          // Fallback for workouts with no segments
          targetPace = baselineRpm * (workout.base_intensity_percent / 100);
        }
      }

      const perfRatio = targetPace && targetPace > 0 && rpm > 0 ? rpm / targetPace : null;

      // Build rich workout_data (matches mobile app)
      const workSegs = segments.filter(s => s.type === 'work');
      const restSegs = segments.filter(s => s.type === 'rest' || s.type === 'block-rest');
      const totalWorkSeconds = workSegs.reduce((sum, s) => sum + s.duration, 0);
      const totalRestSeconds = restSegs.reduce((sum, s) => sum + s.duration, 0);
      const avgWorkRestRatio = totalRestSeconds > 0 ? totalWorkSeconds / totalRestSeconds : null;

      // Save session
      await saveWorkoutSession({
        date: new Date().toISOString().split('T')[0],
        program_day: dayNumber,
        program_day_number: dayNumber,
        day_type: workout.day_type,
        modality,
        units: selectedUnit,
        target_pace: targetPace,
        actual_pace: rpm,
        total_output: output,
        performance_ratio: perfRatio,
        calculated_rpm: rpm,
        average_heart_rate: parseInt(logAvgHR) || null,
        peak_heart_rate: parseInt(logPeakHR) || null,
        perceived_exertion: logRPE,
        workout_data: {
          intervals_completed: workSegs.length,
          total_intervals: workSegs.length,
          total_work_time: totalWorkSeconds,
          total_rest_time: totalRestSeconds,
          avg_work_rest_ratio: avgWorkRestRatio,
        },
        completed: true,
        program_version: programVersion,
      });

      // Save time trial baseline if this is a time trial
      if (workout.day_type === 'time_trial' && output > 0) {
        await saveTimeTrial({
          modality,
          total_output: output,
          calculated_rpm: rpm,
          units: selectedUnit,
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
    const selectedMod = MODALITIES.find(m => m.value === modality);
    const activeCategory = expandedCategory || (selectedMod?.category ?? '');

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
                  {workout && (
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                      {calculateWorkDurationMinutes(workout)} min work
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

              {/* Category buttons */}
              <div>
                <span className="engine-label">Select Modality</span>
                <div className="engine-category-row">
                  {CATEGORIES.map(cat => {
                    const isSelected = selectedMod?.category === cat;
                    const isExpanded = expandedCategory === cat;
                    return (
                      <button
                        key={cat}
                        className={'engine-category-btn' + (isSelected || isExpanded ? ' active' : '')}
                        onClick={() => handleSelectCategory(cat)}
                      >
                        {CATEGORY_LABELS[cat]}
                        {isSelected && <Check size={12} />}
                        {!isSelected && isExpanded && <ChevronDown size={12} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment sub-menu */}
              {activeCategory && (
                <div className="engine-equipment-submenu">
                  {MODALITIES
                    .filter(m => m.category === activeCategory)
                    .map(m => (
                      <button
                        key={m.value}
                        className={'engine-equipment-btn' + (modality === m.value ? ' active' : '')}
                        onClick={() => handleSelectModality(m.value)}
                      >
                        {m.label}
                      </button>
                    ))}
                </div>
              )}

              {/* Unit selection — visible when modality selected */}
              {modality && (
                <>
                  <hr className="engine-divider" />
                  <div>
                    <span className="engine-label">Select Units</span>
                    <div className="engine-unit-row">
                      {SCORE_UNITS.map(u => (
                        <button
                          key={u.value}
                          className={'engine-unit-btn' + (selectedUnit === u.value ? ' active' : '')}
                          onClick={() => handleSelectUnit(u.value)}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Baseline display */}
              {hasMatchingBaseline && baseline && (
                <div className="engine-stat" style={{ textAlign: 'center' }}>
                  <div className="engine-stat-label">Current Baseline ({selectedMod?.label})</div>
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>
                    {baseline.total_output} {baseline.units ?? 'cal'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {baseline.calculated_rpm ? `${baseline.calculated_rpm.toFixed(1)} ${baseline.units ?? 'cal'}/min` : ''}
                  </div>
                </div>
              )}

              {/* Baseline warning */}
              {modality && selectedUnit && !hasMatchingBaseline && !isTimeTrial && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.25)',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  <AlertTriangle size={16} color="#eab308" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    No time trial baseline for <strong>{selectedMod?.label}</strong> with <strong>{SCORE_UNITS.find(u => u.value === selectedUnit)?.label}</strong>.
                    Complete a time trial to see pace targets.
                  </div>
                </div>
              )}

              {modality && selectedUnit && isTimeTrial && !hasMatchingBaseline && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
                  This time trial will set your first baseline for {selectedMod?.label} in {SCORE_UNITS.find(u => u.value === selectedUnit)?.label}.
                </div>
              )}

              <button
                className="engine-btn engine-btn-primary"
                onClick={handleContinueToPreview}
                disabled={!modality || !selectedUnit}
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
                    {workout ? calculateWorkDurationMinutes(workout) : '—'}
                  </div>
                  <div className="engine-stat-label">Work Min</div>
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
                const rollingAdj = performanceMetrics?.rolling_avg_ratio ?? 1;
                const targetRpm = baselineRpm > 0 && Array.isArray(bp.paceRange)
                  ? `${(baselineRpm * bp.paceRange[0] * rollingAdj).toFixed(1)}–${(baselineRpm * bp.paceRange[1] * rollingAdj).toFixed(1)} ${selectedUnit}/min`
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

              {/* Workout History — past sessions of same day type */}
              {dayTypeHistory.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => setHistoryExpanded(!historyExpanded)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '8px 0',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: 'var(--text-dim)',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      width: '100%',
                    }}
                  >
                    <ChevronDown
                      size={14}
                      style={{
                        transform: historyExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}
                    />
                    Workout History ({dayTypeHistory.length})
                  </button>

                  {historyExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                      {dayTypeHistory.slice(0, 10).map(s => {
                        const modLabel = MODALITIES.find(m => m.value === s.modality)?.label ?? s.modality ?? '—';
                        return (
                          <div
                            key={s.id}
                            style={{
                              background: 'var(--bg)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              padding: '10px 14px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 13,
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                                {new Date(s.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                {modLabel}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right' }}>
                              {s.total_output != null && (
                                <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                                  {s.total_output} {s.units ?? ''}
                                </span>
                              )}
                              {s.perceived_exertion != null && (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                  RPE {s.perceived_exertion}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {dayTypeHistory.length > 10 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 4 }}>
                          +{dayTypeHistory.length - 10} more sessions
                        </div>
                      )}
                    </div>
                  )}
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

  // ── Render: Ready (waiting for user to start countdown) ──

  function renderReady() {
    return (
      <div className="engine-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <span
            className={'engine-badge ' + dayTypeBadge(workout?.day_type ?? '')}
            style={{ fontSize: 14, padding: '6px 16px' }}
          >
            {(workout?.day_type ?? '').replace(/_/g, ' ')}
          </span>
        </div>

        <div className="engine-timer" style={{ color: 'var(--text)' }}>
          {formatTime(timeLeft)}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {segments.length > 0 && segments[0].label} — Block 1
        </div>

        <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 320 }}>
          <button
            className="engine-btn engine-btn-secondary"
            onClick={() => setStage('preview')}
            style={{ flex: 1 }}
          >
            <ChevronLeft size={16} /> Back
          </button>
          <button
            className="engine-btn engine-btn-primary"
            onClick={handleBeginCountdown}
            style={{ flex: 2 }}
          >
            <Play size={18} /> Start
          </button>
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
              <span className="engine-label">Total Output ({SCORE_UNITS.find(u => u.value === selectedUnit)?.label ?? selectedUnit})</span>
              <input
                className="engine-input"
                type="number"
                inputMode="decimal"
                placeholder="e.g. 150"
                value={logOutput}
                onChange={e => setLogOutput(e.target.value)}
              />
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
                  Pace: {(parseFloat(logOutput) / Math.max(totalElapsed / 60, 1)).toFixed(1)} {selectedUnit}/min
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
                  <div className="engine-stat-label">{selectedUnit}</div>
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
        {hasAccess && stage === 'ready' && renderReady()}
        {hasAccess && stage === 'active' && renderActive()}
        {hasAccess && stage === 'logging' && renderLogging()}
        {hasAccess && stage === 'complete' && renderComplete()}
      </div>
    </div>
  );
}
