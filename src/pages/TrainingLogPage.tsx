import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Calendar, Plus, X, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import MetconsTab from '../components/MetconsTab';
import WorkoutCalendar from '../components/WorkoutCalendar';
import { useEntitlements } from '../hooks/useEntitlements';
import { loadUserProgress, getWorkoutsForProgram } from '../lib/engineService';
import { scheduleProgramDay, scheduleEngineDay, unschedule } from '../lib/trainingSchedule';
import { localDateString } from '../lib/localDate';

interface WorkoutLog {
  id: string;
  workout_date: string;
  workout_text: string;
  workout_type: string;
  created_at: string;
}

interface ScheduledEntry {
  id: string;
  scheduled_date: string;
  program_id: string;
  program_workout_id: string;
  week_num: number;
  day_num: number;
  program_name: string;
}

// A completed Engine session, surfaced on the calendar as a completed day.
interface EngineSession {
  id: string;
  date: string;
  program_day_number: number | null;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  actual_pace: number | null;
  total_output: number | null;
  performance_ratio: number | null;
  average_heart_rate: number | null;
  peak_heart_rate: number | null;
  perceived_exertion: number | null;
}

// A scheduled (future) Engine day on the calendar. engine_workout_id points at
// the catalog row; we surface it by character (day_type), never day number.
interface EngineSchedEntry {
  id: string;
  scheduled_date: string;
  engine_workout_id: string;
  day_type: string | null;
  day_number: number | null;
}

// PostgREST to-one embed for training_schedule → engine_workouts.
interface EngineSchedJoinRow {
  id: string;
  scheduled_date: string;
  engine_workout_id: string;
  engine_workouts: { day_type: string | null; day_number: number | null } | null;
}

// Calendar-first add: a schedulable program day (once-and-done → completed +
// already-scheduled days excluded from the pool).
interface ProgramPoolDay {
  id: string;
  program_id: string;
  program_name: string;
  week_num: number;
  day_num: number;
  /** One-line preview of the day's content — strength lift · metcon. Empty when
   *  the day has neither (rare). Lets the picker show what's being scheduled. */
  summary?: string;
}

// Calendar-first add: a schedulable Engine day (repeatable pool → completed days
// stay, tagged with doneCount).
interface EnginePoolDay {
  id: string;
  day_number: number;
  month: number;
  day_type: string;
  doneCount: number;
}

// A time-trial result. Time-trial sessions keep their metrics here, keyed by
// date + modality, rather than on the engine_workout_sessions row.
interface EngineTimeTrial {
  id: string;
  date: string;
  modality: string;
  total_output: number | null;
  calculated_rpm: number | null;
  units: string | null;
}

/** "rocket_races_a" → "Rocket Races A"; null/empty → "Engine". */
function formatEngineDayType(dayType: string | null): string {
  if (!dayType) return 'Engine';
  return dayType
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// PostgREST to-one embed shape for the training_schedule → program_workouts → programs join.
interface SchedJoinRow {
  id: string;
  scheduled_date: string;
  program_workout_id: string;
  program_workouts: {
    program_id: string;
    week_num: number;
    day_num: number;
    programs: { name: string } | null;
  } | null;
}

// Compact read-only preview shapes (a subset of program_blocks_v2/movements_v2).
interface PreviewMovementRow {
  block_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  rep_scheme: number[] | null;
  calories: number | null;
  weight: number | null;
  weight_unit: string | null;
  time_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  sort_order: number;
}
interface PreviewBlockRow {
  id: string;
  block_type: string;
  block_label: string | null;
  block_scheme: string | null;
  time_cap_seconds: number | null;
  sort_order: number;
}
interface PreviewBlock extends PreviewBlockRow { movements: PreviewMovementRow[]; }
interface PreviewData { blocks: PreviewBlock[]; prose: string | null; }

interface WorkoutLogBlock {
  id: string;
  log_id: string;
  block_type: string;
  block_label: string | null;
  block_text: string;
  score: string | null;
  rx: boolean;
  sort_order: number;
  percentile: number | null;
  performance_tier: string | null;
  median_benchmark: string | null;
  excellent_benchmark: string | null;
  capped: boolean | null;
  capped_reps: number | null;
  // Power (P5/P5b) — computed per logged metcon/cardio block.
  joules: number | null;
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  body_mass_kg: number | null;
  work_seconds: number | null;
  cardio_modality: string | null;
  time_domain: string | null;
}

interface WorkoutLogEntry {
  id: string;
  log_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: string;
  rpe: number | null;
  scaling_note: string | null;
  block_id: string | null;
  block_label: string | null;
  set_number: number | null;
  reps_completed: number | null;
  hold_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  quality: string | null;
  variation: string | null;
  faults_observed: string[] | null;
  sort_order: number;
}

const TYPE_LABELS: Record<string, string> = {
  for_time: 'For Time',
  amrap: 'AMRAP',
  emom: 'EMOM',
  strength: 'Strength',
  other: 'Other',
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  'warm-up': 'Warm-up & Mobility',
  mobility: 'Mobility',
  skills: 'Skills',
  strength: 'Strength',
  metcon: 'Metcon',
  cardio: 'Cardio',
  'cool-down': 'Cool-down',
  accessory: 'Accessory',
};

function formatMovementName(canonical: string): string {
  return canonical.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Strength lift groups for the cards-by-lift Strength tab.
 *  Order = display order. `profileKey` maps to `athlete_profiles.lifts` (null
 *  for groups with no single 1RM concept, e.g. Other). */
interface LiftGroupConfig {
  key: string;
  displayName: string;
  profileKey: string | null;
}

const LIFT_GROUPS: LiftGroupConfig[] = [
  { key: 'back_squat',     displayName: 'Back Squat',      profileKey: 'back_squat' },
  { key: 'deadlift',       displayName: 'Deadlift',        profileKey: 'deadlift' },
  { key: 'bench_press',    displayName: 'Bench Press',     profileKey: 'bench_press' },
  { key: 'press',          displayName: 'Press',           profileKey: 'press' },
  { key: 'front_squat',    displayName: 'Front Squat',     profileKey: 'front_squat' },
  { key: 'overhead_squat', displayName: 'Overhead Squat',  profileKey: 'overhead_squat' },
  { key: 'push_press',     displayName: 'Push Press',      profileKey: 'push_press' },
  { key: 'snatch',         displayName: 'Snatch',          profileKey: 'snatch' },
  { key: 'clean_and_jerk', displayName: 'Clean & Jerk',    profileKey: 'clean_and_jerk' },
  { key: 'other',          displayName: 'Other Strength',  profileKey: null },
];

/** Bucket a logged movement name into one of LIFT_GROUPS. Order of checks
 *  matters — more specific patterns first (overhead squat before back squat
 *  before generic; bench press before push press before plain press). */
function classifyLift(movement: string): string {
  const m = movement.toLowerCase().replace(/_/g, ' ').trim();
  if (m.includes('snatch')) return 'snatch';
  if (m.includes('clean') || m.includes('jerk')) return 'clean_and_jerk';
  if (m.includes('overhead squat')) return 'overhead_squat';
  if (m.includes('back squat')) return 'back_squat';
  if (m.includes('front squat')) return 'front_squat';
  if (m.includes('deadlift')) return 'deadlift';
  if (m.includes('bench press') || m === 'bench') return 'bench_press';
  if (m.includes('push press')) return 'push_press';
  if (m === 'press' || m === 'strict press' || m === 'shoulder press' || m === 'overhead press') return 'press';
  return 'other';
}

const STRENGTH_CYCLE_DAYS = 90;
const LB_PER_KG = 2.20462;
const toLbs = (weight: number, unit: string): number =>
  unit === 'kg' ? weight * LB_PER_KG : weight;

/** Skill families for the Skills tab cards.
 *  - `metric` drives the in-card chart and the collapsed "best" stat:
 *    'reps' = max reps_completed in a set; 'seconds' = longest hold;
 *    'none' = no chart (Other Skills bucket — mixed-axis movements).
 *  - `variants` lists canonical profile.skills keys belonging to this family
 *    plus a short display label for each. Used in the expanded card's
 *    self-rating section (none/beginner/intermediate/advanced). */
interface SkillFamilyConfig {
  key: string;
  displayName: string;
  metric: 'reps' | 'seconds' | 'none';
  variants: Array<{ profileKey: string; label: string }>;
}

const SKILL_FAMILIES: SkillFamilyConfig[] = [
  { key: 'strict_pull_up', displayName: 'Strict Pull-Up', metric: 'reps',
    variants: [{ profileKey: 'strict_pull_ups', label: 'Strict' }] },
  { key: 'pull_up', displayName: 'Pull-Up', metric: 'reps',
    variants: [
      { profileKey: 'kipping_pull_ups', label: 'Kipping' },
      { profileKey: 'butterfly_pull_ups', label: 'Butterfly' },
      { profileKey: 'chest_to_bar_pull_ups', label: 'Chest-to-Bar' },
    ] },
  { key: 'muscle_up', displayName: 'Muscle-Up', metric: 'reps',
    variants: [
      { profileKey: 'bar_muscle_ups', label: 'Bar' },
      { profileKey: 'muscle_ups', label: 'Ring (kipping)' },
      { profileKey: 'strict_ring_muscle_ups', label: 'Ring (strict)' },
    ] },
  { key: 'hspu', displayName: 'HSPU', metric: 'reps',
    variants: [
      { profileKey: 'wall_facing_hspu', label: 'Wall-facing' },
      { profileKey: 'hspu', label: 'Kipping' },
      { profileKey: 'strict_hspu', label: 'Strict' },
      { profileKey: 'deficit_hspu', label: 'Deficit' },
    ] },
  { key: 'handstand', displayName: 'Handstand Hold/Walk', metric: 'seconds',
    variants: [{ profileKey: 'handstand_walk', label: 'Handstand walk' }] },
  { key: 'toes_to_bar', displayName: 'Toes-to-Bar', metric: 'reps',
    variants: [{ profileKey: 'toes_to_bar', label: 'Toes-to-Bar' }] },
  { key: 'double_under', displayName: 'Double Under', metric: 'reps',
    variants: [{ profileKey: 'double_unders', label: 'Double Unders' }] },
  { key: 'rope_climb', displayName: 'Rope Climb', metric: 'reps',
    variants: [
      { profileKey: 'rope_climbs', label: 'Rope Climb' },
      { profileKey: 'legless_rope_climbs', label: 'Legless' },
    ] },
  { key: 'ring_dip', displayName: 'Ring Dip', metric: 'reps',
    variants: [{ profileKey: 'ring_dips', label: 'Ring Dips' }] },
  { key: 'l_sit', displayName: 'L-Sit', metric: 'seconds',
    variants: [{ profileKey: 'l_sit', label: 'L-Sit' }] },
  { key: 'pistol', displayName: 'Pistol Squat', metric: 'reps',
    variants: [{ profileKey: 'pistols', label: 'Pistol Squats' }] },
  { key: 'box_jump', displayName: 'Box Jump', metric: 'reps', variants: [] },
  { key: 'other_skills', displayName: 'Other Skills', metric: 'none', variants: [] },
];

/** Bucket a logged movement name into a SKILL_FAMILIES key. Order matters —
 *  specific before generic: muscle-up before pull-up so "strict ring muscle
 *  up" doesn't fall into Strict Pull-Up; hspu before handstand so
 *  "wall-facing hspu" doesn't fall into Handstand Walk. */
function classifySkill(movement: string): string {
  const m = movement.toLowerCase().replace(/_/g, ' ').trim();
  if (m.includes('muscle up') || m.includes('muscle-up')) return 'muscle_up';
  if (m.includes('hspu') || m.includes('handstand push')) return 'hspu';
  if (m.includes('handstand') || m.includes('hand stand') || m.includes('wall walk')) return 'handstand';
  if (m.includes('strict pull')) return 'strict_pull_up';
  if (m.includes('pull up') || m.includes('pull-up') || m.includes('c2b') ||
      m.includes('chest to bar') || m.includes('chest-to-bar')) return 'pull_up';
  if (m.includes('toes to bar') || m.includes('toes-to-bar') || m.includes('t2b') ||
      m.includes('knees to elbow') || m.includes('k2e') || m.includes('hanging leg raise')) return 'toes_to_bar';
  if (m.includes('double under') || m.includes('triple under') || m.includes('dub ')) return 'double_under';
  if (m.includes('rope climb')) return 'rope_climb';
  if (m.includes('l sit') || m.includes('l-sit') || m.includes('lsit')) return 'l_sit';
  if (m.includes('ring dip')) return 'ring_dip';
  if (m.includes('pistol')) return 'pistol';
  if (m.includes('box jump') || m.includes('step up') || m.includes('step-up')) return 'box_jump';
  return 'other_skills';
}

const SKILLS_CYCLE_DAYS = 90;

function getMetconTypeLabel(text: string): string {
  const t = text.toUpperCase();
  if (/AMRAP|AS MANY ROUNDS/.test(t)) return 'AMRAP';
  if (/EMOM|E\d+MOM/.test(t)) return 'EMOM';
  return 'For Time';
}

/** Total work — kJ above 1000 J, raw J below. */
function formatJoules(j: number): string {
  return j >= 1000 ? `${Math.round(j / 1000)} kJ` : `${Math.round(j)} J`;
}

/** Seconds → "M:SS". */
function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

// ── Level-3 day preview (read-only) ───────────────────────────────────
// Lazy-loads a scheduled program day's blocks + movements and renders a
// compact, non-editable summary inside the day sheet. Cached per workout so
// reopening is free. v1 programs (no v2 blocks) fall back to prose.
const previewCache = new Map<string, PreviewData>();

function prettyBlockType(t: string): string {
  return t.split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

function formatPreviewMovement(m: PreviewMovementRow): string {
  const parts: string[] = [];
  const arr = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  if (m.calories != null && m.calories > 0) parts.push(`${m.calories} cal`);
  else if (arr && arr.length > 1) parts.push(`${arr.join('-')} reps`);
  else if (m.sets != null && m.reps != null) parts.push(`${m.sets}×${m.reps}`);
  else if (m.sets != null) parts.push(`${m.sets} sets`);
  else if (m.reps != null) parts.push(`${m.reps} reps`);
  if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? 'lb'}`);
  if (m.time_seconds != null) parts.push(`${m.time_seconds}s`);
  if (m.distance != null) parts.push(`${m.distance}${m.distance_unit ?? 'm'}`);
  return parts.length ? `${m.movement} — ${parts.join(' · ')}` : m.movement;
}

function SchedulePreview({ workoutId }: { workoutId: string }) {
  const [data, setData] = useState<PreviewData | null>(previewCache.get(workoutId) ?? null);
  const [loading, setLoading] = useState(!previewCache.has(workoutId));

  useEffect(() => {
    if (previewCache.has(workoutId)) return;
    let active = true;
    (async () => {
      const { data: blocks } = await supabase
        .from('program_blocks_v2')
        .select('id, block_type, block_label, block_scheme, time_cap_seconds, sort_order')
        .eq('program_workout_id', workoutId)
        .order('sort_order');
      const blockRows = (blocks as PreviewBlockRow[] | null) ?? [];
      let result: PreviewData;
      if (blockRows.length) {
        const { data: movs } = await supabase
          .from('program_movements_v2')
          .select('block_id, movement, sets, reps, rep_scheme, calories, weight, weight_unit, time_seconds, distance, distance_unit, sort_order')
          .in('block_id', blockRows.map(b => b.id))
          .order('sort_order');
        const byBlock = new Map<string, PreviewMovementRow[]>();
        for (const m of (movs as PreviewMovementRow[] | null) ?? []) {
          const a = byBlock.get(m.block_id) ?? [];
          a.push(m);
          byBlock.set(m.block_id, a);
        }
        result = { blocks: blockRows.map(b => ({ ...b, movements: byBlock.get(b.id) ?? [] })), prose: null };
      } else {
        const { data: wk } = await supabase.from('program_workouts').select('workout_text').eq('id', workoutId).maybeSingle();
        result = { blocks: [], prose: (wk as { workout_text: string | null } | null)?.workout_text ?? null };
      }
      previewCache.set(workoutId, result);
      if (active) { setData(result); setLoading(false); }
    })();
    return () => { active = false; };
  }, [workoutId]);

  if (loading) return <div className="schedule-preview schedule-preview--muted">Loading…</div>;
  if (!data) return null;
  if (data.blocks.length === 0) {
    return data.prose
      ? <div className="schedule-preview"><div className="schedule-preview-prose">{data.prose}</div></div>
      : <div className="schedule-preview schedule-preview--muted">No details for this day.</div>;
  }
  return (
    <div className="schedule-preview">
      {data.blocks.map(b => (
        <div key={b.id} className="schedule-preview-block">
          <div className="schedule-preview-block-head">
            {b.block_label || prettyBlockType(b.block_type)}
            {b.block_scheme ? <span className="schedule-preview-scheme"> · {b.block_scheme}</span> : null}
            {b.time_cap_seconds ? <span className="schedule-preview-scheme"> · cap {Math.round(b.time_cap_seconds / 60)} min</span> : null}
          </div>
          {b.movements.map((m, i) => (
            <div key={i} className="schedule-preview-mv">{formatPreviewMovement(m)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function TrainingLogPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  // Calendar (Overview) is open to programming OR engine; the analytics tabs are
  // AI-program-specific and stay gated to programming below.
  const hasProgramming = isAdmin || hasFeature('programming');
  const hasAccess = hasProgramming || hasFeature('engine');

  useEffect(() => {
    if (!entLoading && !hasAccess) {
      navigate('/programs', { replace: true });
    }
  }, [entLoading, hasAccess, navigate]);

  const [navOpen, setNavOpen] = useState(false);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledEntry[]>([]);
  const [engineSessions, setEngineSessions] = useState<EngineSession[]>([]);
  const [engineScheduled, setEngineScheduled] = useState<EngineSchedEntry[]>([]);
  const [engineTimeTrials, setEngineTimeTrials] = useState<EngineTimeTrial[]>([]);
  // ── Calendar-first add (tap a today-forward date → schedule a day) ──
  const [addOpen, setAddOpen] = useState(false);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolLoaded, setPoolLoaded] = useState(false);
  const [programPool, setProgramPool] = useState<ProgramPoolDay[]>([]);
  const [enginePool, setEnginePool] = useState<EnginePoolDay[]>([]);
  const [selProgramId, setSelProgramId] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Which scheduled program entries have their Level-3 block preview expanded.
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());
  const togglePreview = (id: string) => setPreviewOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [blocksByLog, setBlocksByLog] = useState<Record<string, WorkoutLogBlock[]>>({});
  const [entriesByLog, setEntriesByLog] = useState<Record<string, WorkoutLogEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [blockFilter, setBlockFilter] = useState<string>('all');
  // Section is its own hub destination now (My Calendar vs Analytics) — driven
  // by ?view=, not an in-page switch. Default calendar. The analytics sub-tab
  // applies within the Analytics section.
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<'calendar' | 'analytics'>(
    searchParams.get('view') === 'analytics' ? 'analytics' : 'calendar',
  );
  const [tab, setTab] = useState<'strength' | 'skills' | 'accessory' | 'cardio' | 'metcons' | 'history'>('strength');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Engine-only users only have the Calendar section; never leave them stranded
  // on the hidden Analytics section. Wait for entitlements to load first —
  // otherwise hasProgramming is briefly false on mount and clobbers ?view=analytics.
  useEffect(() => {
    if (!entLoading && !hasProgramming && view !== 'calendar') setView('calendar');
  }, [entLoading, hasProgramming, view]);
  const [strengthSearch, setStrengthSearch] = useState('');
  const [expandedLiftGroups, setExpandedLiftGroups] = useState<Set<string>>(new Set());
  const [oneRMs, setOneRMs] = useState<Record<string, number>>({});
  const [skillRatings, setSkillRatings] = useState<Record<string, string>>({});
  const [profileUnits, setProfileUnits] = useState<string>('lb');
  const [bodyweightKg, setBodyweightKg] = useState<number | null>(null);
  const [competitionAthleteId, setCompetitionAthleteId] = useState<string | null>(null);
  const [skillsSearch, setSkillsSearch] = useState('');
  const [expandedSkillFamilies, setExpandedSkillFamilies] = useState<Set<string>>(new Set());
  const [accessorySearch, setAccessorySearch] = useState('');
  const [accessorySort, setAccessorySort] = useState<'weight' | 'date'>('date');

  const [allEntries, setAllEntries] = useState<(WorkoutLogEntry & { workout_date: string })[]>([]);
  const [blockTypeMap, setBlockTypeMap] = useState<Map<string, string>>(new Map());

  // ── Edit state ──
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (entry: WorkoutLogEntry) => {
    setEditingEntryId(entry.id);
    setEditFields({
      weight: entry.weight != null ? String(entry.weight) : '',
      reps: entry.reps != null ? String(entry.reps) : '',
      rpe: entry.rpe != null ? String(entry.rpe) : '',
      sets: entry.sets != null ? String(entry.sets) : '',
      reps_completed: entry.reps_completed != null ? String(entry.reps_completed) : '',
      hold_seconds: entry.hold_seconds != null ? String(entry.hold_seconds) : '',
      quality: entry.quality || '',
    });
  };

  const cancelEdit = () => {
    setEditingEntryId(null);
    setEditFields({});
  };

  const saveEdit = async (entryId: string) => {
    setEditSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      if (editFields.weight !== undefined) fields.weight = editFields.weight ? Number(editFields.weight) : null;
      if (editFields.reps !== undefined) fields.reps = editFields.reps ? Number(editFields.reps) : null;
      if (editFields.rpe !== undefined) fields.rpe = editFields.rpe ? Number(editFields.rpe) : null;
      if (editFields.sets !== undefined) fields.sets = editFields.sets ? Number(editFields.sets) : null;
      if (editFields.reps_completed !== undefined) fields.reps_completed = editFields.reps_completed ? Number(editFields.reps_completed) : null;
      if (editFields.hold_seconds !== undefined) fields.hold_seconds = editFields.hold_seconds ? Number(editFields.hold_seconds) : null;
      if (editFields.quality !== undefined) fields.quality = editFields.quality || null;

      const { data, error } = await supabase.functions.invoke('update-workout-entry', {
        body: { entry_id: entryId, fields },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const updated = data.entry;
      // Update local state so top set badges recalculate
      setAllEntries(prev => prev.map(e => e.id === entryId ? { ...e, ...updated } : e));
      setEntriesByLog(prev => {
        const next = { ...prev };
        for (const logId of Object.keys(next)) {
          next[logId] = next[logId].map(e => e.id === entryId ? { ...e, ...updated } : e);
        }
        return next;
      });
      setEditingEntryId(null);
    } catch {
      // silently fail for now — entry stays in edit mode
    } finally {
      setEditSaving(false);
    }
  };

  const deleteEntry = async (entryId: string) => {
    if (!window.confirm('Delete this entry?')) return;
    setEditSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-workout-entry', {
        body: { entry_id: entryId, delete: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAllEntries(prev => prev.filter(e => e.id !== entryId));
      setEntriesByLog(prev => {
        const next = { ...prev };
        for (const logId of Object.keys(next)) {
          next[logId] = next[logId].filter(e => e.id !== entryId);
        }
        return next;
      });
      setEditingEntryId(null);
    } catch {
      // silently fail
    } finally {
      setEditSaving(false);
    }
  };

  // Forward-looking scheduled days (both sources) for the calendar overlay.
  // Re-run after a calendar-first add/remove so the grid + day-detail update.
  const fetchSchedules = useCallback(async () => {
    const [{ data: sched }, { data: engSched }] = await Promise.all([
      supabase
        .from('training_schedule')
        .select('id, scheduled_date, program_workout_id, program_workouts!inner(program_id, week_num, day_num, programs!inner(name))')
        .eq('user_id', session.user.id)
        .not('program_workout_id', 'is', null),
      supabase
        .from('training_schedule')
        .select('id, scheduled_date, engine_workout_id, engine_workouts!inner(day_type, day_number)')
        .eq('user_id', session.user.id)
        .not('engine_workout_id', 'is', null),
    ]);
    const schedRows: ScheduledEntry[] = ((sched as unknown as SchedJoinRow[]) || [])
      .map((s) => {
        const pw = s.program_workouts;
        if (!pw) return null;
        return {
          id: s.id,
          scheduled_date: s.scheduled_date,
          program_id: pw.program_id,
          program_workout_id: s.program_workout_id,
          week_num: pw.week_num,
          day_num: pw.day_num,
          program_name: pw.programs?.name ?? 'Program',
        };
      })
      .filter((r): r is ScheduledEntry => r !== null);
    setScheduled(schedRows);
    const engSchedRows: EngineSchedEntry[] = ((engSched as unknown as EngineSchedJoinRow[]) || []).map((s) => ({
      id: s.id,
      scheduled_date: s.scheduled_date,
      engine_workout_id: s.engine_workout_id,
      day_type: s.engine_workouts?.day_type ?? null,
      day_number: s.engine_workouts?.day_number ?? null,
    }));
    setEngineScheduled(engSchedRows);
    return { schedRows, engSchedRows };
  }, [session.user.id]);

  // Lazy-load the schedulable pools the first time the Add panel opens.
  //  - Program: once-and-done → drop completed + already-scheduled days.
  //  - Engine: repeatable → keep all unlocked days, tag completed with a count.
  const loadPools = useCallback(async () => {
    setPoolLoading(true);
    try {
      if (hasProgramming) {
        const { data: progs } = await supabase
          .from('programs')
          .select('id, name')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false });
        const programList = ((progs as { id: string; name: string }[]) || []);
        if (programList.length) {
          const { data: wks } = await supabase
            .from('program_workouts')
            .select('id, program_id, week_num, day_num')
            .in('program_id', programList.map((p) => p.id))
            .order('sort_order');
          const wkRows = ((wks as { id: string; program_id: string; week_num: number; day_num: number }[]) || []);
          const ids = wkRows.map((w) => w.id);
          // Completed (once-and-done) + already-scheduled program days drop out.
          const completed = new Set<string>();
          const scheduledWorkoutIds = new Set<string>();
          for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const [{ data: ls }, { data: sc }] = await Promise.all([
              supabase.from('workout_logs').select('source_id, status').eq('user_id', session.user.id).in('source_id', batch),
              supabase.from('training_schedule').select('program_workout_id').eq('user_id', session.user.id).in('program_workout_id', batch),
            ]);
            for (const l of ((ls as { source_id: string | null; status: string }[]) || [])) {
              if (l.source_id && l.status === 'completed') completed.add(l.source_id);
            }
            for (const s of ((sc as { program_workout_id: string | null }[]) || [])) {
              if (s.program_workout_id) scheduledWorkoutIds.add(s.program_workout_id);
            }
          }
          const nameById = new Map(programList.map((p) => [p.id, p.name]));
          const pool: ProgramPoolDay[] = wkRows
            .filter((w) => !completed.has(w.id) && !scheduledWorkoutIds.has(w.id))
            .map((w) => ({ id: w.id, program_id: w.program_id, program_name: nameById.get(w.program_id) ?? 'Program', week_num: w.week_num, day_num: w.day_num }));

          // Preview line per schedulable day: strength lift · metcon. Pull blocks
          // (+ first movement) for just the pool days and fold into a summary so
          // the picker shows what's being added, not only "Wk 1 Day 1".
          const poolIds = pool.map((d) => d.id);
          if (poolIds.length) {
            type BlockRow = {
              program_workout_id: string;
              block_type: string;
              block_label: string | null;
              block_scheme: string | null;
              sort_order: number;
              program_movements_v2: { movement: string; sort_order: number }[] | null;
            };
            const blockRows: BlockRow[] = [];
            for (let i = 0; i < poolIds.length; i += 100) {
              const { data: bl } = await supabase
                .from('program_blocks_v2')
                .select('program_workout_id, block_type, block_label, block_scheme, sort_order, program_movements_v2(movement, sort_order)')
                .in('program_workout_id', poolIds.slice(i, i + 100));
              blockRows.push(...((bl as BlockRow[]) || []));
            }
            const byWorkout = new Map<string, BlockRow[]>();
            for (const b of blockRows) {
              const arr = byWorkout.get(b.program_workout_id) ?? [];
              arr.push(b);
              byWorkout.set(b.program_workout_id, arr);
            }
            const firstOfType = (blocks: BlockRow[], t: string) =>
              blocks.filter((b) => b.block_type === t).sort((a, b) => a.sort_order - b.sort_order)[0];
            for (const d of pool) {
              const blocks = byWorkout.get(d.id) ?? [];
              const strength = firstOfType(blocks, 'strength');
              const metcon = firstOfType(blocks, 'metcon');
              const parts: string[] = [];
              const lift = strength?.program_movements_v2
                ?.slice()
                .sort((a, b) => a.sort_order - b.sort_order)[0]?.movement
                ?? strength?.block_label ?? undefined;
              if (lift) parts.push(lift);
              const mLabel = metcon?.block_label || metcon?.block_scheme || undefined;
              if (mLabel) parts.push(mLabel);
              d.summary = parts.join(' · ');
            }
          }
          setProgramPool(pool);
          setSelProgramId((prev) => prev ?? programList[0].id);
        }
      }
      if (hasFeature('engine') || isAdmin) {
        const p = await loadUserProgress();
        if (p?.engine_program_version) {
          const wk = await getWorkoutsForProgram(p.engine_program_version);
          const unlocked = p.engine_months_unlocked ?? 1;
          const doneCount = new Map<number, number>();
          for (const s of engineSessions) {
            if (s.program_day_number != null) doneCount.set(s.program_day_number, (doneCount.get(s.program_day_number) || 0) + 1);
          }
          const pool: EnginePoolDay[] = wk
            .filter((w) => (w.month ?? 1) <= unlocked)
            .map((w) => ({ id: w.id, day_number: w.day_number, month: w.month ?? 1, day_type: w.day_type, doneCount: doneCount.get(w.day_number) || 0 }));
          setEnginePool(pool);
        }
      }
    } finally {
      setPoolLoading(false);
      setPoolLoaded(true);
    }
  }, [hasProgramming, hasFeature, isAdmin, session.user.id, engineSessions]);

  const openAddPanel = useCallback(() => {
    setScheduleError(null);
    setAddOpen(true);
    if (!poolLoaded && !poolLoading) loadPools();
  }, [poolLoaded, poolLoading, loadPools]);

  const handleScheduleProgram = useCallback(async (workoutId: string, date: string) => {
    setScheduleError(null);
    const res = await scheduleProgramDay(session.user.id, workoutId, date);
    if (res.error) { setScheduleError(res.error); return; }
    setProgramPool((prev) => prev.filter((d) => d.id !== workoutId)); // once-and-done
    await fetchSchedules();
    setAddOpen(false);
  }, [session.user.id, fetchSchedules]);

  const handleScheduleEngine = useCallback(async (engineWorkoutId: string, date: string) => {
    setScheduleError(null);
    const res = await scheduleEngineDay(session.user.id, engineWorkoutId, date);
    if (res.error) { setScheduleError(res.error); return; }
    await fetchSchedules(); // repeats allowed → leave it in the pool
    setAddOpen(false);
  }, [session.user.id, fetchSchedules]);

  const handleUnschedule = useCallback(async (rowId: string) => {
    setScheduleError(null);
    const res = await unschedule(rowId);
    if (res.error) { setScheduleError(res.error); return; }
    await fetchSchedules();
    setPoolLoaded(false); // a freed program day should return to the pool next open
  }, [fetchSchedules]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('workout_logs')
        .select('id, workout_date, workout_text, workout_type, created_at')
        .eq('user_id', session.user.id)
        .order('workout_date', { ascending: false })
        .limit(200);
      const logRows = (data as WorkoutLog[]) || [];
      setLogs(logRows);

      await fetchSchedules();

      // Completed Engine sessions → completed days on the same calendar.
      const { data: engRows } = await supabase
        .from('engine_workout_sessions')
        .select('id, date, program_day_number, day_type, modality, units, actual_pace, total_output, performance_ratio, average_heart_rate, peak_heart_rate, perceived_exertion')
        .eq('user_id', session.user.id)
        .eq('completed', true)
        .order('date', { ascending: false })
        .limit(400);
      setEngineSessions((engRows as EngineSession[]) || []);

      // Time-trial results live in their own table; merged onto the matching
      // (date, modality) session card since time-trial sessions store no
      // top-level metrics.
      const { data: ttRows } = await supabase
        .from('engine_time_trials')
        .select('id, date, modality, total_output, calculated_rpm, units')
        .eq('user_id', session.user.id)
        .limit(400);
      setEngineTimeTrials((ttRows as EngineTimeTrial[]) || []);

      if (logRows.length > 0) {
        const logIds = logRows.map(l => l.id);
        const [{ data: blocks }, { data: entries }] = await Promise.all([
          supabase
            .from('workout_log_blocks')
            .select('id, log_id, block_type, block_label, block_text, score, rx, sort_order, percentile, performance_tier, median_benchmark, excellent_benchmark, capped, capped_reps, joules, avg_power_watts, avg_w_per_kg, body_mass_kg, work_seconds, cardio_modality, time_domain')
            .in('log_id', logIds),
          supabase
            .from('workout_log_entries')
            .select('id, log_id, movement, sets, reps, weight, weight_unit, rpe, scaling_note, block_id, block_label, set_number, reps_completed, hold_seconds, distance, distance_unit, quality, variation, faults_observed, sort_order')
            .in('log_id', logIds),
        ]);

        const grouped: Record<string, WorkoutLogBlock[]> = {};
        for (const b of (blocks as WorkoutLogBlock[]) || []) {
          if (!grouped[b.log_id]) grouped[b.log_id] = [];
          grouped[b.log_id].push(b);
        }
        for (const logId of Object.keys(grouped)) {
          grouped[logId].sort((a, b) => a.sort_order - b.sort_order);
        }
        setBlocksByLog(grouped);

        const btMap = new Map<string, string>();
        for (const b of (blocks as WorkoutLogBlock[]) || []) {
          btMap.set(b.id, b.block_type);
        }
        setBlockTypeMap(btMap);

        const groupedEntries: Record<string, WorkoutLogEntry[]> = {};
        const dateMap = new Map(logRows.map(l => [l.id, l.workout_date]));
        const flatEntries: (WorkoutLogEntry & { workout_date: string })[] = [];
        for (const e of (entries as WorkoutLogEntry[]) || []) {
          if (!groupedEntries[e.log_id]) groupedEntries[e.log_id] = [];
          groupedEntries[e.log_id].push(e);
          flatEntries.push({ ...e, workout_date: dateMap.get(e.log_id) || '' });
        }
        for (const logId of Object.keys(groupedEntries)) {
          groupedEntries[logId].sort((a, b) => a.sort_order - b.sort_order);
        }
        setEntriesByLog(groupedEntries);
        setAllEntries(flatEntries);
      }

      setLoading(false);
    })();
  }, [session.user.id, fetchSchedules]);

  // ── Athlete profile: 1RMs + unit preference for the Strength cards ──
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('athlete_profiles')
        .select('lifts, skills, units, bodyweight, competition_athlete_id')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!data) return;
      const row = data as {
        lifts: Record<string, unknown> | null;
        skills: Record<string, unknown> | null;
        units: string | null;
        bodyweight: number | string | null;
        competition_athlete_id: string | null;
      };
      const numeric: Record<string, number> = {};
      if (row.lifts) {
        for (const [k, v] of Object.entries(row.lifts)) {
          const n = typeof v === 'number' ? v : parseFloat(String(v));
          if (Number.isFinite(n) && n > 0) numeric[k] = n;
        }
      }
      setOneRMs(numeric);
      const ratings: Record<string, string> = {};
      if (row.skills) {
        for (const [k, v] of Object.entries(row.skills)) {
          if (typeof v === 'string' && v.length > 0) ratings[k] = v;
        }
      }
      setSkillRatings(ratings);
      const unit = row.units === 'kg' ? 'kg' : 'lb';
      setProfileUnits(unit);
      // Bodyweight: convert lbs → kg if profile is in lbs. Profile values are
      // numeric or numeric-string; null/zero treated as "no bodyweight on file."
      const bwRaw = typeof row.bodyweight === 'number' ? row.bodyweight : parseFloat(String(row.bodyweight ?? ''));
      if (Number.isFinite(bwRaw) && bwRaw > 0) {
        setBodyweightKg(unit === 'kg' ? bwRaw : bwRaw * 0.453592);
      }
      setCompetitionAthleteId(row.competition_athlete_id ?? null);
    })();
  }, [session.user.id]);

  // ── Derived data for overview tab ──

  const logsByDate = useMemo(() => {
    const map: Record<string, WorkoutLog[]> = {};
    for (const log of logs) {
      if (!map[log.workout_date]) map[log.workout_date] = [];
      map[log.workout_date].push(log);
    }
    return map;
  }, [logs]);

  const scheduledByDate = useMemo(() => {
    const map: Record<string, ScheduledEntry[]> = {};
    for (const s of scheduled) {
      if (!map[s.scheduled_date]) map[s.scheduled_date] = [];
      map[s.scheduled_date].push(s);
    }
    return map;
  }, [scheduled]);

  const engineByDate = useMemo(() => {
    const map: Record<string, EngineSession[]> = {};
    for (const e of engineSessions) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [engineSessions]);

  const engineScheduledByDate = useMemo(() => {
    const map: Record<string, EngineSchedEntry[]> = {};
    for (const s of engineScheduled) {
      if (!map[s.scheduled_date]) map[s.scheduled_date] = [];
      map[s.scheduled_date].push(s);
    }
    return map;
  }, [engineScheduled]);

  // "YYYY-MM-DD__modality" → time trial, to backfill metrics on time-trial cards.
  const timeTrialByKey = useMemo(() => {
    const map: Record<string, EngineTimeTrial> = {};
    for (const t of engineTimeTrials) map[`${t.date}__${t.modality}`] = t;
    return map;
  }, [engineTimeTrials]);

  // Month-grid inputs: completed-day counts + per-date status (scheduled /
  // completed / both) for distinct, non-heatmap styling. Completed merges
  // manual/AI logs + Engine sessions; the grid stays source-agnostic.
  const workoutCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const log of logs) map[log.workout_date] = (map[log.workout_date] || 0) + 1;
    for (const e of engineSessions) map[e.date] = (map[e.date] || 0) + 1;
    return map;
  }, [logs, engineSessions]);
  const dayStatus = useMemo(() => {
    const map: Record<string, 'scheduled' | 'completed' | 'both'> = {};
    for (const d of Object.keys(logsByDate)) map[d] = 'completed';
    for (const d of Object.keys(engineByDate)) map[d] = 'completed';
    for (const d of Object.keys(scheduledByDate)) map[d] = map[d] === 'completed' ? 'both' : 'scheduled';
    for (const d of Object.keys(engineScheduledByDate)) map[d] = map[d] === 'completed' || map[d] === 'both' ? 'both' : 'scheduled';
    return map;
  }, [logsByDate, engineByDate, scheduledByDate, engineScheduledByDate]);

  // Today (local) — calendar-first add is offered for today-forward dates only.
  const todayStr = localDateString();
  // Collapse the Add panel + any open previews whenever the selected date changes.
  useEffect(() => { setAddOpen(false); setScheduleError(null); setPreviewOpen(new Set()); }, [selectedDate]);
  // While the day sheet is open: lock background scroll + Escape closes it.
  useEffect(() => {
    if (view !== 'calendar' || !selectedDate) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedDate(null); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); };
  }, [view, selectedDate]);

  // ── Strength data: bucket entries into LIFT_GROUPS over the cycle window ──
  // PR-at-the-time is computed within each group (snatch PR across all snatch
  // variants; clean&jerk PR across all clean/jerk variants). lbs is the
  // comparison currency so mixed-unit logs rank correctly; display preserves
  // each row's original unit.
  const strengthByGroup = useMemo(() => {
    type Row = WorkoutLogEntry & { workout_date: string; isPR?: boolean };
    interface LiftGroupData {
      config: LiftGroupConfig;
      entries: Row[];
      trainingDays: number;
      totalSets: number;
      cycleBest: { weight: number; unit: string; lbs: number } | null;
      totalTonnageLbs: number;
      // One bar per training day for the within-card chart: top set that day.
      perSessionTopSet: Array<{ date: string; weight: number; unit: string; lbs: number }>;
    }

    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - STRENGTH_CYCLE_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const map = new Map<string, LiftGroupData>();
    for (const cfg of LIFT_GROUPS) {
      map.set(cfg.key, {
        config: cfg,
        entries: [],
        trainingDays: 0,
        totalSets: 0,
        cycleBest: null,
        totalTonnageLbs: 0,
        perSessionTopSet: [],
      });
    }

    for (const e of allEntries) {
      if (!e.block_id || blockTypeMap.get(e.block_id) !== 'strength') continue;
      if (e.workout_date < cutoffStr) continue;
      const key = classifyLift(e.movement);
      map.get(key)!.entries.push(e);
    }

    for (const data of map.values()) {
      const days = new Set<string>();
      let totalSets = 0;
      let bestLbs = 0;
      let best: { weight: number; unit: string; lbs: number } | null = null;
      let tonnage = 0;
      const perDay = new Map<string, { weight: number; unit: string; lbs: number }>();

      const chrono = [...data.entries].sort((a, b) =>
        a.workout_date !== b.workout_date
          ? a.workout_date.localeCompare(b.workout_date)
          : (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );

      let runMax = 0;
      const prIds = new Set<string>();
      for (const e of chrono) {
        days.add(e.workout_date);
        if (e.weight == null || e.weight <= 0) continue;
        totalSets++;
        const lbs = toLbs(e.weight, e.weight_unit);
        if (lbs > bestLbs) { bestLbs = lbs; best = { weight: e.weight, unit: e.weight_unit, lbs }; }
        if (lbs > runMax) { runMax = lbs; prIds.add(e.id); }
        if (e.reps != null && e.reps > 0) tonnage += lbs * e.reps;
        const existing = perDay.get(e.workout_date);
        if (!existing || lbs > existing.lbs) {
          perDay.set(e.workout_date, { weight: e.weight, unit: e.weight_unit, lbs });
        }
      }

      data.entries = data.entries.map(e => ({ ...e, isPR: prIds.has(e.id) }));
      data.trainingDays = days.size;
      data.totalSets = totalSets;
      data.cycleBest = best;
      data.totalTonnageLbs = tonnage;
      data.perSessionTopSet = [...perDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    return map;
  }, [allEntries, blockTypeMap]);

  // Metcon blocks flattened with their workout_date — fed into the new
  // MetconsTab for stats, charts, heatmap, and history list.
  const metconBlocks = useMemo(() => {
    const out: Array<{
      id: string; log_id: string; block_label: string | null; block_text: string;
      score: string | null; rx: boolean;
      avg_power_watts: number | null; avg_w_per_kg: number | null;
      work_seconds: number | null; time_domain: string | null;
      capped: boolean | null; percentile: number | null;
      workout_date: string;
    }> = [];
    for (const log of logs) {
      for (const b of blocksByLog[log.id] || []) {
        if (b.block_type !== 'metcon') continue;
        out.push({
          id: b.id, log_id: b.log_id, block_label: b.block_label, block_text: b.block_text,
          score: b.score, rx: b.rx,
          avg_power_watts: b.avg_power_watts, avg_w_per_kg: b.avg_w_per_kg,
          work_seconds: b.work_seconds, time_domain: b.time_domain,
          capped: b.capped, percentile: b.percentile,
          workout_date: log.workout_date,
        });
      }
    }
    return out;
  }, [logs, blocksByLog]);

  // Cross-lift summary charts (top of Strength tab). Sorted by value desc so
  // the biggest contributors land at the top.
  const strengthOverview = useMemo(() => {
    const volume: Array<{ key: string; displayName: string; tonnageLbs: number }> = [];
    const topSet: Array<{ key: string; displayName: string; weight: number; unit: string; lbs: number }> = [];
    for (const cfg of LIFT_GROUPS) {
      const data = strengthByGroup.get(cfg.key)!;
      if (data.totalTonnageLbs > 0) {
        volume.push({ key: cfg.key, displayName: cfg.displayName, tonnageLbs: data.totalTonnageLbs });
      }
      if (data.cycleBest) {
        topSet.push({
          key: cfg.key,
          displayName: cfg.displayName,
          weight: data.cycleBest.weight,
          unit: data.cycleBest.unit,
          lbs: data.cycleBest.lbs,
        });
      }
    }
    volume.sort((a, b) => b.tonnageLbs - a.tonnageLbs);
    topSet.sort((a, b) => b.lbs - a.lbs);
    return { volume, topSet };
  }, [strengthByGroup]);

  // ── Accessory data: group entries by movement (mirrors strength, but
  // tolerant of weightless entries like band/bodyweight work). PR badge
  // applies only to weighted PRs; bestLbs = 0 ⇒ no TOP SET badge. ──
  const accessoryByMovement = useMemo(() => {
    type Row = WorkoutLogEntry & { workout_date: string; isPR?: boolean };
    const map = new Map<string, { entries: Row[]; best: number; bestUnit: string; bestLbs: number }>();
    for (const e of allEntries) {
      if (!e.block_id || blockTypeMap.get(e.block_id) !== 'accessory') continue;
      const lbs = e.weight != null && e.weight > 0
        ? (e.weight_unit === 'kg' ? e.weight * 2.20462 : e.weight)
        : 0;
      const existing = map.get(e.movement);
      if (existing) {
        existing.entries.push(e);
        if (lbs > existing.bestLbs) {
          existing.bestLbs = lbs;
          existing.best = e.weight ?? 0;
          existing.bestUnit = e.weight_unit ?? '';
        }
      } else {
        map.set(e.movement, {
          entries: [e],
          best: e.weight ?? 0,
          bestUnit: e.weight_unit ?? '',
          bestLbs: lbs,
        });
      }
    }
    for (const data of map.values()) {
      const chrono = [...data.entries].sort((a, b) =>
        a.workout_date !== b.workout_date
          ? a.workout_date.localeCompare(b.workout_date)
          : (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
      let runMax = 0;
      const prIds = new Set<string>();
      for (const e of chrono) {
        if (e.weight == null || e.weight <= 0) continue;
        const lbs = e.weight_unit === 'kg' ? e.weight * 2.20462 : e.weight;
        if (lbs > runMax) { runMax = lbs; prIds.add(e.id); }
      }
      data.entries = data.entries.map(e => ({ ...e, isPR: prIds.has(e.id) }));
    }
    return map;
  }, [allEntries, blockTypeMap]);

  // ── Cardio data: group blocks by modality (row/run/bike/...). Each cardio
  // block is one session; aggregated power metrics live on the block, not
  // the entries, so the unit of analysis here is the block. ──
  const cardioByModality = useMemo(() => {
    type CardioRow = WorkoutLogBlock & { workout_date: string };
    const map = new Map<string, { blocks: CardioRow[]; bestWatts: number }>();
    for (const log of logs) {
      for (const b of blocksByLog[log.id] || []) {
        if (b.block_type !== 'cardio') continue;
        const modality = b.cardio_modality || 'unknown';
        const watts = b.avg_power_watts != null ? Number(b.avg_power_watts) : 0;
        const row: CardioRow = { ...b, workout_date: log.workout_date };
        const existing = map.get(modality);
        if (existing) {
          existing.blocks.push(row);
          if (watts > existing.bestWatts) existing.bestWatts = watts;
        } else {
          map.set(modality, { blocks: [row], bestWatts: watts });
        }
      }
    }
    return map;
  }, [logs, blocksByLog]);

  // ── Sessions insights ──
  // Last-7-days descriptive rollup: workout count + per-block-type breakdown.
  // Reports only what was logged; never flags absence (the AI Programmer
  // owns "what to train" — the log doesn't second-guess it).
  const last7dStats = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const recentLogs = logs.filter(l => l.workout_date >= cutoffStr);
    const blockTypeCounts: Record<string, number> = {};
    for (const log of recentLogs) {
      for (const b of blocksByLog[log.id] || []) {
        if (b.block_type === 'warm-up' || b.block_type === 'mobility' || b.block_type === 'cool-down') continue;
        blockTypeCounts[b.block_type] = (blockTypeCounts[b.block_type] || 0) + 1;
      }
    }
    return { workoutCount: recentLogs.length, blockTypeCounts };
  }, [logs, blocksByLog]);

  // Heaviest strength set in the last 7 days. Compared in lbs for ordering;
  // displayed in the user's original unit.
  const topSet7d = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let best: { movement: string; weight: number; unit: string; date: string; lbs: number } | null = null;
    for (const e of allEntries) {
      if (!e.block_id || blockTypeMap.get(e.block_id) !== 'strength') continue;
      if (e.weight == null || e.weight <= 0) continue;
      if (e.workout_date < cutoffStr) continue;
      const lbs = e.weight_unit === 'kg' ? e.weight * 2.20462 : e.weight;
      if (!best || lbs > best.lbs) {
        best = { movement: e.movement, weight: e.weight, unit: e.weight_unit, date: e.workout_date, lbs };
      }
    }
    return best;
  }, [allEntries, blockTypeMap]);

  // 30-day power baselines for per-block "vs usual" comparison.
  // Bucketed by block_type + (time_domain for metcons / cardio_modality for
  // cardio) so comparisons stay within comparable efforts.
  const powerBaselines = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const buckets: Record<string, number[]> = {};
    for (const log of logs) {
      if (log.workout_date < cutoffStr) continue;
      for (const b of blocksByLog[log.id] || []) {
        if (b.avg_power_watts == null) continue;
        const w = Number(b.avg_power_watts);
        if (!Number.isFinite(w) || w <= 0) continue;
        const key = b.block_type === 'metcon'
          ? `metcon:${b.time_domain ?? 'unknown'}`
          : b.block_type === 'cardio'
          ? `cardio:${b.cardio_modality ?? 'unknown'}`
          : null;
        if (!key) continue;
        (buckets[key] ||= []).push(w);
      }
    }
    const out: Record<string, { avg: number; count: number }> = {};
    for (const [k, vs] of Object.entries(buckets)) {
      out[k] = { avg: vs.reduce((s, n) => s + n, 0) / vs.length, count: vs.length };
    }
    return out;
  }, [logs, blocksByLog]);

  // ── Skills data: bucket entries into SKILL_FAMILIES over the cycle window.
  // Per-family "best" depends on metric: reps families track max reps_completed
  // in a single set; seconds families track longest hold. ──
  const skillsByFamily = useMemo(() => {
    type Row = WorkoutLogEntry & { workout_date: string };
    interface SkillFamilyData {
      config: SkillFamilyConfig;
      entries: Row[];
      trainingDays: number;
      totalSets: number;
      bestReps: number;
      bestHoldSeconds: number;
      perSessionBest: Array<{ date: string; value: number }>;
    }

    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - SKILLS_CYCLE_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const map = new Map<string, SkillFamilyData>();
    for (const cfg of SKILL_FAMILIES) {
      map.set(cfg.key, {
        config: cfg, entries: [], trainingDays: 0, totalSets: 0,
        bestReps: 0, bestHoldSeconds: 0, perSessionBest: [],
      });
    }

    for (const e of allEntries) {
      if (!e.block_id || blockTypeMap.get(e.block_id) !== 'skills') continue;
      if (e.workout_date < cutoffStr) continue;
      const key = classifySkill(e.movement);
      map.get(key)!.entries.push(e);
    }

    for (const data of map.values()) {
      const days = new Set<string>();
      let bestReps = 0;
      let bestHold = 0;
      const perDay = new Map<string, number>();
      for (const e of data.entries) {
        days.add(e.workout_date);
        const reps = e.reps_completed ?? 0;
        const hold = e.hold_seconds ?? 0;
        if (reps > bestReps) bestReps = reps;
        if (hold > bestHold) bestHold = hold;
        const sessionVal = data.config.metric === 'seconds' ? hold : reps;
        if (sessionVal > 0) {
          const prev = perDay.get(e.workout_date) ?? 0;
          if (sessionVal > prev) perDay.set(e.workout_date, sessionVal);
        }
      }
      data.trainingDays = days.size;
      data.totalSets = data.entries.length;
      data.bestReps = bestReps;
      data.bestHoldSeconds = bestHold;
      data.perSessionBest = [...perDay.entries()]
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    return map;
  }, [allEntries, blockTypeMap]);

  // Volume per family (total sets in cycle) for the overview chart at top.
  // No top-set-equivalent chart — reps vs seconds across families aren't
  // comparable on a single axis.
  const skillsOverview = useMemo(() => {
    const volume: Array<{ key: string; displayName: string; sets: number }> = [];
    for (const cfg of SKILL_FAMILIES) {
      const data = skillsByFamily.get(cfg.key)!;
      if (data.totalSets > 0) {
        volume.push({ key: cfg.key, displayName: cfg.displayName, sets: data.totalSets });
      }
    }
    volume.sort((a, b) => b.sets - a.sets);
    return { volume };
  }, [skillsByFamily]);

  // ── Helpers ──

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getBlockLabel = (block: WorkoutLogBlock) => {
    if (block.block_type === 'metcon') return getMetconTypeLabel(block.block_text);
    return BLOCK_TYPE_LABELS[block.block_type] || block.block_type;
  };

  if (entLoading || !hasAccess) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="page-loading"><div className="loading-pulse" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{view === 'analytics' ? 'Analytics' : 'My Calendar'}</h1>
        </header>

        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 0' }}>
            {/* Calendar and Analytics are now separate hub destinations (reached
                from the /programs cards via ?view=), so there's no in-page switch.
                Analytics sub-tabs still live within the Analytics section. */}
            {hasProgramming && view === 'analytics' && (
              <div className="tl-tabs">
                {([['strength', 'Strength'], ['skills', 'Skills'], ['accessory', 'Accessory'], ['cardio', 'Cardio'], ['metcons', 'Metcons'], ['history', 'History']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    className={`tl-tab${tab === id ? ' active' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : view !== 'calendar' && logs.length === 0 && scheduled.length === 0 && engineSessions.length === 0 ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>No workouts logged yet.</p>
                <button className="auth-btn" onClick={() => navigate('/workout/start')} style={{ maxWidth: 200 }}>
                  Log your first workout
                </button>
              </div>
            ) : view === 'calendar' ? (
              /* ── Calendar section ── */
              <div>
                <WorkoutCalendar
                  workoutCounts={workoutCounts}
                  dayStatus={dayStatus}
                  allowFuture
                  selectedDate={selectedDate}
                  onDayClick={(key) => setSelectedDate(selectedDate === key ? null : key)}
                />
                <div className="wc-legend">
                  <span className="wc-legend-item"><span className="wc-legend-swatch wc-legend-swatch--completed" />Completed</span>
                  <span className="wc-legend-item"><span className="wc-legend-swatch wc-legend-swatch--scheduled" />Scheduled</span>
                  <span className="wc-legend-item"><span className="wc-legend-swatch wc-legend-swatch--today" />Today</span>
                </div>

                {/* Empty-calendar hint — when there's nothing logged or scheduled
                    yet, guide the user to schedule (tap a date) or log a workout
                    so they're not staring at a blank grid. */}
                {logs.length === 0 && scheduled.length === 0 && engineSessions.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginTop: 16 }}>
                    Tap any date from today onward to schedule a session — or{' '}
                    <button
                      type="button"
                      onClick={() => navigate('/workout/start')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', padding: 0, textDecoration: 'underline' }}
                    >
                      log a workout
                    </button>.
                  </p>
                )}

                {/* Day sheet — slides up over the calendar for any populated
                    date, plus today-forward empty dates so they can be scheduled.
                    Backdrop tap / Escape / ✕ dismiss it; clicks inside don't. */}
                {selectedDate && (logsByDate[selectedDate] || scheduledByDate[selectedDate] || engineByDate[selectedDate] || engineScheduledByDate[selectedDate] || selectedDate >= todayStr) && (
                  <div className="day-sheet-backdrop" onClick={() => setSelectedDate(null)}>
                  <div className="day-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                    <div className="day-sheet-handle" />
                    <div className="wc-day-detail">
                    <div className="wc-day-detail-header">
                      <span className="wc-day-detail-date">
                        {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </span>
                      <button className="wc-day-detail-close" onClick={() => setSelectedDate(null)} aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                    {(scheduledByDate[selectedDate] || []).map(s => (
                      <div key={s.id}>
                        <div className="wc-day-scheduled">
                          <div className="wc-day-scheduled-label">
                            <Calendar size={13} />
                            Scheduled · {s.program_name} · Wk {s.week_num} Day {s.day_num}
                          </div>
                          <button type="button" className="wc-day-ghost-btn wc-day-ghost-btn--icon" onClick={() => handleUnschedule(s.id)} aria-label="Remove from calendar"><X size={13} /></button>
                        </div>
                        <div className="wc-day-sched-actions">
                          <button type="button" className={`wc-day-ghost-btn${previewOpen.has(s.id) ? ' wc-day-ghost-btn--active' : ''}`} onClick={() => togglePreview(s.id)} aria-expanded={previewOpen.has(s.id)}>
                            <ChevronDown size={13} style={{ transform: previewOpen.has(s.id) ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} /> Preview
                          </button>
                          <button type="button" className="wc-day-scheduled-open" onClick={() => navigate(`/programs/${s.program_id}?day=${s.program_workout_id}`)}>Start</button>
                        </div>
                        {previewOpen.has(s.id) && <SchedulePreview workoutId={s.program_workout_id} />}
                      </div>
                    ))}
                    {(engineScheduledByDate[selectedDate] || []).map(s => (
                      <div key={s.id} className="wc-day-scheduled">
                        <div className="wc-day-scheduled-label">
                          <Calendar size={13} />
                          Scheduled · Engine · {formatEngineDayType(s.day_type)}{s.day_number != null ? ` Day ${s.day_number}` : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {s.day_number != null && (
                            <button type="button" className="wc-day-scheduled-open" onClick={() => navigate(`/engine/training/${s.day_number}`)}>Open</button>
                          )}
                          <button type="button" className="wc-day-scheduled-open" onClick={() => handleUnschedule(s.id)} aria-label="Remove from calendar"><X size={13} /></button>
                        </div>
                      </div>
                    ))}
                    {(engineByDate[selectedDate] || []).map(e => {
                      // Time-trial sessions store metrics in engine_time_trials; backfill from there.
                      const tt = e.modality ? timeTrialByKey[`${e.date}__${e.modality}`] : undefined;
                      const output = e.total_output ?? tt?.total_output ?? null;
                      const pace = e.actual_pace ?? tt?.calculated_rpm ?? null;
                      const units = e.units ?? tt?.units ?? null;
                      const u = units ? ` ${units}` : '';
                      const stats: { label: string; value: string }[] = [];
                      if (units === 'watts') {
                        // Rate unit: the value IS the pace (watts) — one stat, no "/min", no duplicate.
                        const w = output ?? pace;
                        if (w != null) stats.push({ label: 'Avg Power', value: `${Math.round(w).toLocaleString()}${u}` });
                      } else {
                        if (output != null) stats.push({ label: 'Output', value: `${Math.round(output).toLocaleString()}${u}` });
                        if (pace != null) stats.push({ label: 'Pace', value: `${Math.round(pace).toLocaleString()}${u}/min` });
                      }
                      if (e.average_heart_rate != null) stats.push({ label: 'Avg HR', value: `${e.average_heart_rate} bpm` });
                      if (e.peak_heart_rate != null) stats.push({ label: 'Peak HR', value: `${e.peak_heart_rate} bpm` });
                      if (e.perceived_exertion != null) stats.push({ label: 'RPE', value: String(e.perceived_exertion) });
                      return (
                        <div key={e.id} className="wc-day-detail-block">
                          <div className="wc-day-detail-block-header">
                            <span className="wc-day-detail-type">
                              Engine · {formatEngineDayType(e.day_type)}
                              {e.modality ? ` — ${formatEngineDayType(e.modality)}` : ''}
                              {e.program_day_number != null ? ` · Day ${e.program_day_number}` : ''}
                            </span>
                            {e.performance_ratio != null && e.performance_ratio > 0 && (
                              <span className="wc-day-detail-score">{(e.performance_ratio * 100).toFixed(0)}%</span>
                            )}
                          </div>
                          {stats.length > 0 ? (
                            <div className="wc-engine-stats">
                              {stats.map(s => (
                                <div key={s.label} className="wc-engine-stat">
                                  <span className="wc-engine-stat-label">{s.label}</span>
                                  <span className="wc-engine-stat-value">{s.value}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="wc-day-detail-text">Completed — no metrics recorded.</div>
                          )}
                          {e.program_day_number != null && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                              <button
                                type="button"
                                className="wc-day-scheduled-open"
                                onClick={() => navigate(`/engine/training/${e.program_day_number}`)}
                              >
                                Open
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(logsByDate[selectedDate] || []).map(log => {
                      const logBlocks = blocksByLog[log.id] || [];
                      const logEntries = entriesByLog[log.id] || [];
                      return (
                        <div key={log.id} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                            <button
                              onClick={() => navigate('/workout/start', { state: { edit_log_id: log.id } })}
                              style={{
                                background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                color: 'var(--text-dim)', cursor: 'pointer', padding: '4px 10px',
                                fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                                fontFamily: "'Outfit', sans-serif",
                              }}
                            >
                              Edit
                            </button>
                          </div>
                          {logBlocks.length > 0 ? (
                        logBlocks.map((block, i) => {
                          const blockEntries = logEntries.filter(e => e.block_id === block.id);
                          return (
                          <div key={`${log.id}-${i}`} className="wc-day-detail-block">
                            <div className="wc-day-detail-block-header">
                              <span className="wc-day-detail-type">{getBlockLabel(block)}</span>
                              {block.score && <span className="wc-day-detail-score">{block.score}</span>}
                              {block.rx && <span style={{ fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>Rx</span>}
                              {block.capped ? (
                                <span style={{
                                  fontSize: 11, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                                  background: 'rgba(234,179,8,0.15)', color: '#eab308',
                                }}>
                                  {block.capped_reps != null ? `Capped @ ${block.capped_reps} reps` : 'Capped'}
                                </span>
                              ) : block.percentile != null && (
                                <span style={{
                                  fontSize: 11, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                                  background: block.percentile >= 75 ? 'rgba(34,197,94,0.15)' : block.percentile >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                                  color: block.percentile >= 75 ? '#22c55e' : block.percentile >= 40 ? '#eab308' : '#ef4444',
                                }}>{block.percentile}th %ile</span>
                              )}
                            </div>
                            <div className="wc-day-detail-text">{block.block_text}</div>
                            {blockEntries.length > 0 && (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {block.block_type === 'strength' && blockEntries.some(e => e.set_number != null) ? (
                                  (() => {
                                    const byMovement = new Map<string, WorkoutLogEntry[]>();
                                    for (const e of blockEntries) {
                                      const list = byMovement.get(e.movement) || [];
                                      list.push(e);
                                      byMovement.set(e.movement, list);
                                    }
                                    return [...byMovement.entries()].map(([movement, rows]) => (
                                      <div key={movement}>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{formatMovementName(movement)}</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                                          {rows.map((r, ri) => (
                                            <span key={ri} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono' }}>
                                              S{r.set_number}: {r.reps ?? '?'}@{r.weight ?? '?'}{r.weight_unit}{r.rpe != null ? ` RPE ${r.rpe}` : ''}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ));
                                  })()
                                ) : (
                                  blockEntries.map((entry, ei) => (
                                    <div key={ei} style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(entry.movement)}</span>
                                      {entry.sets != null && entry.reps != null && <span> {entry.sets}x{entry.reps}</span>}
                                      {entry.reps != null && entry.sets == null && <span> x{entry.reps}</span>}
                                      {entry.reps_completed != null && <span> x{entry.reps_completed} reps</span>}
                                      {entry.hold_seconds != null && <span> {entry.hold_seconds}s hold</span>}
                                      {entry.weight != null && <span> @{entry.weight}{entry.weight_unit}</span>}
                                      {entry.distance != null && <span> {entry.distance}{entry.distance_unit || 'm'}</span>}
                                      {entry.rpe != null && <span> RPE {entry.rpe}</span>}
                                      {entry.scaling_note && <span style={{ fontStyle: 'italic' }}> ({entry.scaling_note})</span>}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })
                      ) : (
                        <div className="wc-day-detail-block">
                          <div className="wc-day-detail-block-header">
                            <span className="wc-day-detail-type">{TYPE_LABELS[log.workout_type] || log.workout_type}</span>
                          </div>
                          <div className="wc-day-detail-text">{log.workout_text}</div>
                        </div>
                      )}
                        </div>
                      );
                    })}

                    {/* Calendar-first add — today-forward only. Program days
                        are once-and-done; Engine days are a repeatable pool. */}
                    {selectedDate >= todayStr && (() => {
                      const programTaken = !!scheduledByDate[selectedDate];
                      const engineTaken = !!engineScheduledByDate[selectedDate];
                      const canEngine = isAdmin || hasFeature('engine');
                      const programDays = programPool.filter(d => d.program_id === selProgramId);
                      const programNames = Array.from(new Map(programPool.map(d => [d.program_id, d.program_name])).entries());
                      return (
                        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                          {!addOpen ? (
                            <button
                              type="button"
                              className="wc-day-scheduled-open"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              onClick={openAddPanel}
                            >
                              <Plus size={14} /> Add training
                            </button>
                          ) : (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Add training</span>
                                <button type="button" className="wc-day-detail-close" onClick={() => setAddOpen(false)} aria-label="Cancel"><X size={14} /></button>
                              </div>
                              {scheduleError && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{scheduleError}</div>}
                              {poolLoading ? (
                                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading…</div>
                              ) : (
                                <>
                                  {hasProgramming && !programTaken && (
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Program</div>
                                      {programNames.length > 1 && (
                                        <select
                                          value={selProgramId ?? ''}
                                          onChange={e => setSelProgramId(e.target.value)}
                                          className="tl-search"
                                          style={{ marginBottom: 6 }}
                                        >
                                          {programNames.map(([pid, pname]) => <option key={pid} value={pid}>{pname}</option>)}
                                        </select>
                                      )}
                                      {programDays.length === 0 ? (
                                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No schedulable days left.</div>
                                      ) : (
                                        <div className="day-schedule-quickpick" style={{ position: 'static', maxHeight: '50vh', overflowY: 'auto' }}>
                                          {programDays.map(d => (
                                            <button key={d.id} type="button" className="day-schedule-qp-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={() => handleScheduleProgram(d.id, selectedDate)}>
                                              <span style={{ fontWeight: 600 }}>Wk {d.week_num} Day {d.day_num}</span>
                                              {d.summary && <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'normal', textAlign: 'left' }}>{d.summary}</span>}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {canEngine && !engineTaken && (
                                    <div style={{ marginBottom: 4 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Engine</div>
                                      {enginePool.length === 0 ? (
                                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No unlocked Engine days.</div>
                                      ) : (
                                        <div className="day-schedule-quickpick" style={{ position: 'static', maxHeight: '50vh', overflowY: 'auto' }}>
                                          {enginePool.map(d => (
                                            <button key={d.id} type="button" className="day-schedule-qp-item" onClick={() => handleScheduleEngine(d.id, selectedDate)}>
                                              <span>{formatEngineDayType(d.day_type)} Day {d.day_number}</span>
                                              {d.doneCount > 0 && <span className="day-schedule-qp-taken">done {d.doneCount}×</span>}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {(!hasProgramming || programTaken) && (!canEngine || engineTaken) && (
                                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>This date is fully scheduled.</div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    </div>
                  </div>
                  </div>
                )}

              </div>
            ) : tab === 'strength' ? (
              /* ── Strength Tab ── */
              <div>
                <input
                  className="tl-search"
                  type="text"
                  placeholder="Search lifts..."
                  value={strengthSearch}
                  onChange={e => setStrengthSearch(e.target.value)}
                />

                {/* Overview: tonnage + top-set bars across all lift groups (90 days). */}
                {(() => {
                  const { volume, topSet } = strengthOverview;
                  if (volume.length === 0 && topSet.length === 0) return null;
                  const maxVol = volume.reduce((m, v) => Math.max(m, v.tonnageLbs), 0);
                  const maxTop = topSet.reduce((m, v) => Math.max(m, v.lbs), 0);
                  const section: React.CSSProperties = { marginBottom: 12, padding: 12, background: 'var(--surface2)', borderRadius: 8 };
                  const title: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 };
                  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 };
                  const name: React.CSSProperties = { width: 110, color: 'var(--text)', flexShrink: 0 };
                  const track: React.CSSProperties = { flex: 1, height: 8, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' };
                  const value: React.CSSProperties = { width: 90, textAlign: 'right', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono', flexShrink: 0 };
                  return (
                    <div style={{ marginTop: 12, marginBottom: 16 }}>
                      {volume.length > 0 && (
                        <div style={section}>
                          <div style={title}>Volume — 90 days (tonnage)</div>
                          {volume.map(v => (
                            <div key={v.key} style={row}>
                              <span style={name}>{v.displayName}</span>
                              <div style={track}>
                                <div style={{ height: '100%', width: `${(v.tonnageLbs / maxVol) * 100}%`, background: 'var(--accent)' }} />
                              </div>
                              <span style={value}>{Math.round(v.tonnageLbs).toLocaleString()} lb</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {topSet.length > 0 && (
                        <div style={section}>
                          <div style={title}>Top Set — 90 days</div>
                          {topSet.map(t => (
                            <div key={t.key} style={row}>
                              <span style={name}>{t.displayName}</span>
                              <div style={track}>
                                <div style={{ height: '100%', width: `${(t.lbs / maxTop) * 100}%`, background: 'var(--accent)' }} />
                              </div>
                              <span style={value}>{t.weight}{t.unit}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Per-lift-group collapsible cards. */}
                {(() => {
                  const q = strengthSearch.toLowerCase();
                  const visible = LIFT_GROUPS.filter(cfg => {
                    const data = strengthByGroup.get(cfg.key)!;
                    if (data.entries.length === 0) return false;
                    if (!q) return true;
                    return cfg.displayName.toLowerCase().includes(q);
                  });
                  if (visible.length === 0) {
                    return (
                      <div className="tl-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11" /><path d="M6.5 17.5h11" /><path d="M12 2v20" /><path d="M2 12h4" /><path d="M18 12h4" /><circle cx="4.5" cy="6.5" r="2.5" /><circle cx="4.5" cy="17.5" r="2.5" /><circle cx="19.5" cy="6.5" r="2.5" /><circle cx="19.5" cy="17.5" r="2.5" /></svg>
                        <div className="tl-empty-title">{q ? 'No matching lifts' : 'No Strength Data'}</div>
                        <div className="tl-empty-desc">{q ? 'Try a different search term.' : 'Log a workout with strength blocks to see your lifts here.'}</div>
                      </div>
                    );
                  }
                  return visible.map(cfg => {
                    const data = strengthByGroup.get(cfg.key)!;
                    const expanded = expandedLiftGroups.has(cfg.key);
                    const oneRM = cfg.profileKey ? oneRMs[cfg.profileKey] : null;
                    const oneRMLabel =
                      cfg.key === 'snatch' ? 'Snatch 1RM'
                      : cfg.key === 'clean_and_jerk' ? 'Clean & Jerk 1RM'
                      : '1RM';
                    const sessionsDesc = [...data.entries].sort((a, b) =>
                      b.workout_date !== a.workout_date
                        ? b.workout_date.localeCompare(a.workout_date)
                        : (b.sort_order ?? 0) - (a.sort_order ?? 0)
                    );
                    return (
                      <div key={cfg.key} className="tl-movement-card" style={{ padding: 0 }}>
                        <button
                          onClick={() => setExpandedLiftGroups(prev => {
                            const next = new Set(prev);
                            if (next.has(cfg.key)) next.delete(cfg.key); else next.add(cfg.key);
                            return next;
                          })}
                          style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: 12, textAlign: 'left', fontFamily: 'inherit' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>{cfg.displayName}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>({data.trainingDays})</span>
                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                            {data.totalSets} set{data.totalSets !== 1 ? 's' : ''}
                            {oneRM != null && <> · {oneRMLabel} {oneRM}{profileUnits}</>}
                            {data.cycleBest && <> · Cycle best {data.cycleBest.weight}{data.cycleBest.unit}</>}
                          </div>
                        </button>
                        {expanded && (
                          <div style={{ padding: '0 12px 12px' }}>
                            {/* Per-session top-set chart. Skipped for Other Strength (mixed-axis movements). */}
                            {cfg.key !== 'other' && data.perSessionTopSet.length > 0 && (() => {
                              const maxLbs = data.perSessionTopSet.reduce((m, s) => Math.max(m, s.lbs), 0);
                              const first = data.perSessionTopSet[0];
                              const last = data.perSessionTopSet[data.perSessionTopSet.length - 1];
                              const fmtAxis = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                              return (
                                <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6 }}>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                                    Top set per session
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
                                    {data.perSessionTopSet.map((s, i) => (
                                      <div
                                        key={i}
                                        title={`${s.date}: ${s.weight}${s.unit}`}
                                        style={{
                                          flex: 1, minWidth: 4,
                                          height: `${maxLbs > 0 ? Math.max((s.lbs / maxLbs) * 100, 4) : 4}%`,
                                          background: 'var(--accent)', borderRadius: 2,
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                                    <span>{fmtAxis(first.date)}</span>
                                    <span>{fmtAxis(last.date)}</span>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Session list (newest first). */}
                            <div style={{ marginTop: 8 }}>
                              {sessionsDesc.map((e, i) => (
                                editingEntryId === e.id ? (
                                  <div key={i} className="tl-set-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                                    <input type="number" value={editFields.weight} onChange={ev => setEditFields(f => ({ ...f, weight: ev.target.value }))} placeholder="Weight" style={{ width: 70, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <input type="number" value={editFields.reps} onChange={ev => setEditFields(f => ({ ...f, reps: ev.target.value }))} placeholder="Reps" style={{ width: 50, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <input type="number" value={editFields.rpe} onChange={ev => setEditFields(f => ({ ...f, rpe: ev.target.value }))} placeholder="RPE" style={{ width: 45, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <button onClick={() => saveEdit(e.id)} disabled={editSaving} style={{ padding: '2px 8px', fontSize: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{editSaving ? '...' : 'Save'}</button>
                                    <button onClick={cancelEdit} style={{ padding: '2px 8px', fontSize: 11, background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={() => deleteEntry(e.id)} disabled={editSaving} style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', color: 'var(--danger, #e74c3c)', border: 'none', cursor: 'pointer' }}>Delete</button>
                                  </div>
                                ) : (
                                  <div key={i} className="tl-set-row">
                                    <span className="tl-set-date">{new Date(e.workout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatMovementName(e.movement)}</span>
                                    <span className="tl-set-value">
                                      {e.weight != null ? `${e.weight}${e.weight_unit}` : '—'}
                                      {e.reps != null && ` x${e.reps}`}
                                    </span>
                                    {e.set_number != null && <span className="tl-set-detail">Set {e.set_number}</span>}
                                    {e.rpe != null && <span className="tl-set-detail">RPE {e.rpe}</span>}
                                    {e.isPR && (
                                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, background: 'var(--accent)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>PR</span>
                                    )}
                                    <button onClick={(ev) => { ev.stopPropagation(); startEdit(e); }} style={{ padding: '1px 6px', fontSize: 11, background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', opacity: 0.6 }} title="Edit">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                    </button>
                                  </div>
                                )
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : tab === 'metcons' ? (
              /* ── Metcons Tab ── */
              <MetconsTab
                userId={session.user.id}
                bodyweightKg={bodyweightKg}
                competitionAthleteId={competitionAthleteId}
                metconBlocks={metconBlocks}
              />
            ) : tab === 'skills' ? (
              /* ── Skills Tab ── */
              <div>
                <input
                  className="tl-search"
                  type="text"
                  placeholder="Search skill families..."
                  value={skillsSearch}
                  onChange={e => setSkillsSearch(e.target.value)}
                />

                {/* Overview: volume per family. One chart only — reps and seconds
                    families don't share a top-set axis. */}
                {(() => {
                  const { volume } = skillsOverview;
                  if (volume.length === 0) return null;
                  const maxVol = volume.reduce((m, v) => Math.max(m, v.sets), 0);
                  const section: React.CSSProperties = { marginBottom: 12, padding: 12, background: 'var(--surface2)', borderRadius: 8 };
                  const title: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 };
                  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 };
                  const name: React.CSSProperties = { width: 140, color: 'var(--text)', flexShrink: 0 };
                  const track: React.CSSProperties = { flex: 1, height: 8, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' };
                  const value: React.CSSProperties = { width: 60, textAlign: 'right', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono', flexShrink: 0 };
                  return (
                    <div style={{ marginTop: 12, marginBottom: 16 }}>
                      <div style={section}>
                        <div style={title}>Volume — 90 days (sets)</div>
                        {volume.map(v => (
                          <div key={v.key} style={row}>
                            <span style={name}>{v.displayName}</span>
                            <div style={track}>
                              <div style={{ height: '100%', width: `${(v.sets / maxVol) * 100}%`, background: 'var(--accent)' }} />
                            </div>
                            <span style={value}>{v.sets}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Per-family collapsible cards. */}
                {(() => {
                  const q = skillsSearch.toLowerCase();
                  const visible = SKILL_FAMILIES.filter(cfg => {
                    const data = skillsByFamily.get(cfg.key)!;
                    if (data.entries.length === 0) return false;
                    if (!q) return true;
                    return cfg.displayName.toLowerCase().includes(q);
                  });
                  if (visible.length === 0) {
                    return (
                      <div className="tl-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                        <div className="tl-empty-title">{q ? 'No matching skill families' : 'No Skills Data'}</div>
                        <div className="tl-empty-desc">{q ? 'Try a different search term.' : 'Log a workout with skills blocks to track your progress here.'}</div>
                      </div>
                    );
                  }
                  return visible.map(cfg => {
                    const data = skillsByFamily.get(cfg.key)!;
                    const expanded = expandedSkillFamilies.has(cfg.key);
                    const bestLabel =
                      cfg.metric === 'reps' && data.bestReps > 0 ? `Best ${data.bestReps} reps`
                      : cfg.metric === 'seconds' && data.bestHoldSeconds > 0 ? `Longest ${data.bestHoldSeconds}s`
                      : null;
                    const sessionsDesc = [...data.entries].sort((a, b) =>
                      b.workout_date !== a.workout_date
                        ? b.workout_date.localeCompare(a.workout_date)
                        : (b.sort_order ?? 0) - (a.sort_order ?? 0)
                    );
                    return (
                      <div key={cfg.key} className="tl-movement-card" style={{ padding: 0 }}>
                        <button
                          onClick={() => setExpandedSkillFamilies(prev => {
                            const next = new Set(prev);
                            if (next.has(cfg.key)) next.delete(cfg.key); else next.add(cfg.key);
                            return next;
                          })}
                          style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: 12, textAlign: 'left', fontFamily: 'inherit' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>{cfg.displayName}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>({data.trainingDays})</span>
                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                            {data.totalSets} set{data.totalSets !== 1 ? 's' : ''}
                            {bestLabel && <> · {bestLabel}</>}
                          </div>
                        </button>
                        {expanded && (
                          <div style={{ padding: '0 12px 12px' }}>
                            {/* Self-rating section (skips families with no profile variants). */}
                            {cfg.variants.length > 0 && (() => {
                              const rated = cfg.variants
                                .map(v => ({ ...v, level: skillRatings[v.profileKey] }))
                                .filter(v => v.level && v.level.length > 0);
                              if (rated.length === 0) return null;
                              return (
                                <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6, marginBottom: 8 }}>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                                    Self-rating
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {rated.map(v => (
                                      <div key={v.profileKey} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                        <span style={{ color: 'var(--text-dim)' }}>{v.label}</span>
                                        <span style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{v.level}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Per-session best chart (reps or seconds depending on family). */}
                            {cfg.metric !== 'none' && data.perSessionBest.length > 0 && (() => {
                              const maxVal = data.perSessionBest.reduce((m, s) => Math.max(m, s.value), 0);
                              const unit = cfg.metric === 'seconds' ? 's' : ' reps';
                              const fmtAxis = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                              const first = data.perSessionBest[0];
                              const last = data.perSessionBest[data.perSessionBest.length - 1];
                              return (
                                <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6 }}>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                                    {cfg.metric === 'seconds' ? 'Longest hold per session' : 'Best set per session'}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
                                    {data.perSessionBest.map((s, i) => (
                                      <div
                                        key={i}
                                        title={`${s.date}: ${s.value}${unit}`}
                                        style={{
                                          flex: 1, minWidth: 4,
                                          height: `${maxVal > 0 ? Math.max((s.value / maxVal) * 100, 4) : 4}%`,
                                          background: 'var(--accent)', borderRadius: 2,
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                                    <span>{fmtAxis(first.date)}</span>
                                    <span>{fmtAxis(last.date)}</span>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Session list (newest first). */}
                            <div style={{ marginTop: 8 }}>
                              {sessionsDesc.map((e, i) => (
                                editingEntryId === e.id ? (
                                  <div key={i} className="tl-set-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                                    <input type="number" value={editFields.sets} onChange={ev => setEditFields(f => ({ ...f, sets: ev.target.value }))} placeholder="Sets" style={{ width: 50, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <input type="number" value={editFields.reps_completed} onChange={ev => setEditFields(f => ({ ...f, reps_completed: ev.target.value }))} placeholder="Reps" style={{ width: 50, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <input type="number" value={editFields.hold_seconds} onChange={ev => setEditFields(f => ({ ...f, hold_seconds: ev.target.value }))} placeholder="Hold(s)" style={{ width: 55, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <input type="number" value={editFields.rpe} onChange={ev => setEditFields(f => ({ ...f, rpe: ev.target.value }))} placeholder="RPE" style={{ width: 45, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                    <select value={editFields.quality} onChange={ev => setEditFields(f => ({ ...f, quality: ev.target.value }))} style={{ padding: '3px 4px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>
                                      <option value="">—</option>
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                      <option value="D">D</option>
                                    </select>
                                    <button onClick={() => saveEdit(e.id)} disabled={editSaving} style={{ padding: '2px 8px', fontSize: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{editSaving ? '...' : 'Save'}</button>
                                    <button onClick={cancelEdit} style={{ padding: '2px 8px', fontSize: 11, background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={() => deleteEntry(e.id)} disabled={editSaving} style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', color: 'var(--danger, #e74c3c)', border: 'none', cursor: 'pointer' }}>Delete</button>
                                  </div>
                                ) : (
                                  <div key={i} className="tl-set-row">
                                    <span className="tl-set-date">{new Date(e.workout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatMovementName(e.movement)}</span>
                                    <span className="tl-set-value">
                                      {e.sets != null || e.reps_completed != null || e.hold_seconds != null ? (
                                        <>
                                          {e.sets != null && `${e.sets}s`}
                                          {e.reps_completed != null && ` x${e.reps_completed}`}
                                          {e.hold_seconds != null && ` ${e.hold_seconds}s`}
                                        </>
                                      ) : (
                                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Practiced</span>
                                      )}
                                    </span>
                                    {e.rpe != null && <span className="tl-set-detail">RPE {e.rpe}</span>}
                                    {e.quality && <span className="tl-set-detail">{e.quality}</span>}
                                    {e.variation && <span className="tl-set-detail" style={{ fontStyle: 'italic' }}>{e.variation}</span>}
                                    {e.scaling_note && <span className="tl-set-detail" style={{ fontStyle: 'italic' }}>{e.scaling_note}</span>}
                                    {e.faults_observed && e.faults_observed.length > 0 && (
                                      <span className="tl-set-detail" style={{ color: 'var(--danger, #e74c3c)', fontSize: 11 }}>{e.faults_observed.join(', ')}</span>
                                    )}
                                    <button onClick={(ev) => { ev.stopPropagation(); startEdit(e); }} style={{ padding: '1px 6px', fontSize: 11, background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', opacity: 0.6 }} title="Edit">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                    </button>
                                  </div>
                                )
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : tab === 'accessory' ? (
              /* ── Accessory Tab ── */
              <div>
                <input
                  className="tl-search"
                  type="text"
                  placeholder="Search movements..."
                  value={accessorySearch}
                  onChange={e => setAccessorySearch(e.target.value)}
                />
                <div className="tl-sort-bar">
                  <span>Sort:</span>
                  <button className={`tl-sort-btn${accessorySort === 'date' ? ' active' : ''}`} onClick={() => setAccessorySort('date')}>By Date</button>
                  <button className={`tl-sort-btn${accessorySort === 'weight' ? ' active' : ''}`} onClick={() => setAccessorySort('weight')}>By Weight</button>
                </div>
                {(() => {
                  const q = accessorySearch.toLowerCase();
                  let movements = [...accessoryByMovement.entries()]
                    .filter(([m]) => !q || formatMovementName(m).toLowerCase().includes(q));
                  if (accessorySort === 'weight') {
                    movements.sort((a, b) => b[1].bestLbs - a[1].bestLbs);
                  } else {
                    movements.sort((a, b) => {
                      const latestA = a[1].entries.reduce((d, e) => e.workout_date > d ? e.workout_date : d, '');
                      const latestB = b[1].entries.reduce((d, e) => e.workout_date > d ? e.workout_date : d, '');
                      return latestB.localeCompare(latestA);
                    });
                  }
                  if (movements.length === 0) {
                    return (
                      <div className="tl-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M7 12h10" /></svg>
                        <div className="tl-empty-title">{q ? 'No matching movements' : 'No Accessory Data'}</div>
                        <div className="tl-empty-desc">{q ? 'Try a different search term.' : 'Log a workout with accessory blocks to see them here.'}</div>
                      </div>
                    );
                  }
                  return movements.map(([movement, data]) => {
                    const sorted = [...data.entries].sort((a, b) =>
                      accessorySort === 'weight'
                        ? (b.weight ?? 0) - (a.weight ?? 0)
                        : b.workout_date.localeCompare(a.workout_date)
                    );
                    const recent = sorted.slice(0, 8);
                    return (
                      <div key={movement} className="tl-movement-card">
                        <div className="tl-movement-header">
                          <span className="tl-movement-name">{formatMovementName(movement)}</span>
                          {data.bestLbs > 0 && (
                            <span className="tl-pr-badge">TOP SET: {data.best}{data.bestUnit}</span>
                          )}
                        </div>
                        <div className="tl-session-count">{data.entries.length} set{data.entries.length !== 1 ? 's' : ''} logged</div>
                        <div style={{ marginTop: 8 }}>
                          {recent.map((e, i) => (
                            editingEntryId === e.id ? (
                              <div key={i} className="tl-set-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                                <input type="number" value={editFields.weight} onChange={ev => setEditFields(f => ({ ...f, weight: ev.target.value }))} placeholder="Weight" style={{ width: 70, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                <input type="number" value={editFields.reps} onChange={ev => setEditFields(f => ({ ...f, reps: ev.target.value }))} placeholder="Reps" style={{ width: 50, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                <input type="number" value={editFields.rpe} onChange={ev => setEditFields(f => ({ ...f, rpe: ev.target.value }))} placeholder="RPE" style={{ width: 45, padding: '3px 6px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                <button onClick={() => saveEdit(e.id)} disabled={editSaving} style={{ padding: '2px 8px', fontSize: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                                  {editSaving ? '...' : 'Save'}
                                </button>
                                <button onClick={cancelEdit} style={{ padding: '2px 8px', fontSize: 11, background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                                <button onClick={() => deleteEntry(e.id)} disabled={editSaving} style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', color: 'var(--danger, #e74c3c)', border: 'none', cursor: 'pointer' }}>Delete</button>
                              </div>
                            ) : (
                            <div key={i} className="tl-set-row">
                              <span className="tl-set-date">{new Date(e.workout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span className="tl-set-value">
                                {e.sets != null && `${e.sets} sets`}
                                {e.weight != null && e.weight > 0 && ` ${e.weight}${e.weight_unit}`}
                                {(e.reps_completed ?? e.reps) != null && ` x${e.reps_completed ?? e.reps}`}
                                {e.hold_seconds != null && ` ${e.hold_seconds}s`}
                              </span>
                              {e.rpe != null && <span className="tl-set-detail">RPE {e.rpe}</span>}
                              {e.isPR && (
                                <span style={{
                                  fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                                  background: 'var(--accent)', color: '#fff',
                                  padding: '1px 5px', borderRadius: 3,
                                }}>PR</span>
                              )}
                              <button onClick={(ev) => { ev.stopPropagation(); startEdit(e); }} style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: 11, background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', opacity: 0.6 }} title="Edit">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                            </div>
                            )
                          ))}
                          {sorted.length > 8 && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 6 }}>
                              +{sorted.length - 8} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : tab === 'cardio' ? (
              /* ── Cardio Tab ── */
              <div>
                {(() => {
                  if (cardioByModality.size === 0) {
                    return (
                      <div className="tl-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        <div className="tl-empty-title">No Cardio Data</div>
                        <div className="tl-empty-desc">Log a workout with cardio blocks to see your sessions here.</div>
                      </div>
                    );
                  }
                  const sorted = [...cardioByModality.entries()].sort((a, b) => b[1].bestWatts - a[1].bestWatts);
                  return sorted.map(([modality, data]) => {
                    const blocks = [...data.blocks].sort((a, b) => b.workout_date.localeCompare(a.workout_date));
                    const recent = blocks.slice(0, 8);
                    return (
                      <div key={modality} className="tl-movement-card">
                        <div className="tl-movement-header">
                          <span className="tl-movement-name">{formatMovementName(modality)}</span>
                          {data.bestWatts > 0 && (
                            <span className="tl-pr-badge">BEST: {Math.round(data.bestWatts)} W</span>
                          )}
                        </div>
                        <div className="tl-session-count">{data.blocks.length} session{data.blocks.length !== 1 ? 's' : ''}</div>
                        <div style={{ marginTop: 8 }}>
                          {recent.map((b, i) => {
                            const w = b.avg_power_watts != null ? Number(b.avg_power_watts) : null;
                            const wkg = b.avg_w_per_kg != null ? Number(b.avg_w_per_kg) : null;
                            const j = b.joules != null ? Number(b.joules) : null;
                            const dur = b.work_seconds != null ? Number(b.work_seconds) : null;
                            return (
                              <div key={i} className="tl-set-row">
                                <span className="tl-set-date">{new Date(b.workout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <span className="tl-set-value">
                                  {w != null && Number.isFinite(w) ? `${Math.round(w)} W` : '—'}
                                  {wkg != null && Number.isFinite(wkg) ? ` · ${wkg.toFixed(2)} W/kg` : ''}
                                </span>
                                {dur != null && Number.isFinite(dur) && (
                                  <span className="tl-set-detail">{formatDuration(dur)}</span>
                                )}
                                {b.time_domain && (
                                  <span className="tl-set-detail">{b.time_domain}</span>
                                )}
                                {j != null && Number.isFinite(j) && (
                                  <span className="tl-set-detail" style={{ color: 'var(--text-muted)' }}>{formatJoules(j)}</span>
                                )}
                              </div>
                            );
                          })}
                          {blocks.length > 8 && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 6 }}>
                              +{blocks.length - 8} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              /* ── History Tab ── */
              <>
                {/* Last-7d rollup — descriptive only; never flags gaps. */}
                {last7dStats.workoutCount > 0 && (() => {
                  const segments = Object.entries(last7dStats.blockTypeCounts).sort((a, b) => b[1] - a[1]);
                  return (
                    <div style={{
                      marginBottom: 16,
                      padding: '12px 14px',
                      background: 'var(--surface2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                        Last 7 days
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                          {last7dStats.workoutCount} workout{last7dStats.workoutCount === 1 ? '' : 's'}
                        </span>
                        {segments.length > 0 && (
                          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                            · {segments.map(([t, n]) => `${n} ${BLOCK_TYPE_LABELS[t] ?? t}`).join(' · ')}
                          </span>
                        )}
                      </div>
                      {topSet7d && (
                        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                          Top set: <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(topSet7d.movement)}</span>{' '}
                          <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent)' }}>{topSet7d.weight}{topSet7d.unit}</span>{' '}
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            · {new Date(topSet7d.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="source-toggle" style={{ marginBottom: 16 }}>
                  {(['all', 'metcon'] as const).map(f => (
                    <button
                      key={f}
                      className={'source-btn' + (blockFilter === f ? ' active' : '')}
                      onClick={() => { setBlockFilter(f); setExpandedId(null); }}
                    >
                      {f === 'all' ? 'All' : BLOCK_TYPE_LABELS[f] || f}
                    </button>
                  ))}
                </div>
                {(() => {
                  const filtered = blockFilter === 'all'
                    ? logs
                    : logs.filter(log => (blocksByLog[log.id] || []).some(b => b.block_type === blockFilter));
                  return filtered.length === 0 ? (
                    <div className="workout-review-section" style={{ textAlign: 'center', padding: 40 }}>
                      <p style={{ color: 'var(--text-dim)' }}>No {BLOCK_TYPE_LABELS[blockFilter]?.toLowerCase() || ''} workouts found.</p>
                    </div>
                  ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {filtered.map(log => {
                      const allBlocks = blocksByLog[log.id] || [];
                      const logBlocks = blockFilter === 'all'
                        ? allBlocks
                        : allBlocks.filter(b => b.block_type === blockFilter);
                      return (
                        <div
                          key={log.id}
                          className="workout-review-section"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        >
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 15 }}>{formatDate(log.workout_date)}</span>
                          </div>

                          {expandedId === log.id && (() => {
                            const logEntries = entriesByLog[log.id] || [];
                            return (
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate('/workout/start', { state: { edit_log_id: log.id } });
                                    }}
                                    style={{
                                      background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                      color: 'var(--text-dim)', cursor: 'pointer', padding: '4px 12px',
                                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                                      fontFamily: "'Outfit', sans-serif",
                                    }}
                                  >
                                    Edit Workout
                                  </button>
                                </div>
                                {logBlocks.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {logBlocks.map((block, i) => {
                                      const blockEntries = logEntries.filter(e => e.block_id ? e.block_id === block.id : e.block_label === block.block_label);
                                      const isSkills = block.block_type === 'skills';
                                      return (
                                        <div key={i}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', textTransform: 'uppercase' }}>
                                              {getBlockLabel(block)}
                                            </span>
                                            {block.score && (
                                              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: 'var(--text-dim)' }}>
                                                {block.score}
                                              </span>
                                            )}
                                            {block.rx && (
                                              <span style={{ fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>Rx</span>
                                            )}
                                            {block.capped ? (
                                              <span style={{
                                                fontSize: 11, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                                                background: 'rgba(234,179,8,0.15)', color: '#eab308',
                                              }}>
                                                {block.capped_reps != null ? `Capped @ ${block.capped_reps} reps` : 'Capped'}
                                              </span>
                                            ) : block.percentile != null && (
                                              <span style={{
                                                fontSize: 11,
                                                padding: '1px 6px',
                                                borderRadius: 4,
                                                fontWeight: 600,
                                                background: block.percentile >= 75 ? 'rgba(34,197,94,0.15)' : block.percentile >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                                                color: block.percentile >= 75 ? '#22c55e' : block.percentile >= 40 ? '#eab308' : '#ef4444',
                                              }}>
                                                {block.percentile}th %ile
                                              </span>
                                            )}
                                          </div>
                                          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)', paddingLeft: 8 }}>
                                            {block.block_text}
                                          </div>

                                          {/* Power (P5/P5b) — metcon + cardio blocks that computed a watts figure. */}
                                          {block.avg_power_watts != null && Number.isFinite(Number(block.avg_power_watts)) && (() => {
                                            const w = Number(block.avg_power_watts);
                                            const wkg = block.avg_w_per_kg != null ? Number(block.avg_w_per_kg) : null;
                                            const j = block.joules != null ? Number(block.joules) : null;
                                            // "vs 30d avg" — same block_type + comparable bucket; skipped when
                                            // the bucket only contains this block (no usable baseline).
                                            const bucketKey = block.block_type === 'metcon'
                                              ? `metcon:${block.time_domain ?? 'unknown'}`
                                              : block.block_type === 'cardio'
                                              ? `cardio:${block.cardio_modality ?? 'unknown'}`
                                              : null;
                                            const baseline = bucketKey ? powerBaselines[bucketKey] : null;
                                            const deltaPct = baseline && baseline.count >= 2
                                              ? Math.round(((w - baseline.avg) / baseline.avg) * 100)
                                              : null;
                                            return (
                                              <div style={{ paddingLeft: 8, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', fontFamily: 'JetBrains Mono' }}>
                                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                                                  {Math.round(w)} W
                                                </span>
                                                {wkg != null && Number.isFinite(wkg) && (
                                                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{wkg.toFixed(2)} W/kg</span>
                                                )}
                                                {block.block_type === 'cardio' && block.work_seconds != null && (
                                                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{formatDuration(Number(block.work_seconds))}</span>
                                                )}
                                                {j != null && Number.isFinite(j) && (
                                                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatJoules(j)}</span>
                                                )}
                                                {deltaPct != null && deltaPct !== 0 && (
                                                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                    {deltaPct > 0 ? '+' : ''}{deltaPct}% vs 30d avg
                                                  </span>
                                                )}
                                              </div>
                                            );
                                          })()}

                                          {block.block_type === 'strength' && blockEntries.length > 0 && (() => {
                                            // One-line top-set per movement. Full per-set detail + edit
                                            // lives on the Strength tab — strength's single home.
                                            const lbsOf = (w: number, u: string) => u === 'kg' ? w * 2.20462 : w;
                                            const tops = new Map<string, { weight: number; reps: number | null; unit: string }>();
                                            for (const e of blockEntries) {
                                              if (e.weight == null || e.weight <= 0) continue;
                                              const cur = tops.get(e.movement);
                                              if (!cur || lbsOf(e.weight, e.weight_unit) > lbsOf(cur.weight, cur.unit)) {
                                                tops.set(e.movement, { weight: e.weight, reps: e.reps, unit: e.weight_unit });
                                              }
                                            }
                                            if (tops.size === 0) return null;
                                            return (
                                              <div style={{ paddingLeft: 8, marginTop: 8, fontSize: 13, color: 'var(--text-dim)' }}>
                                                {[...tops.entries()].map(([m, top], i) => (
                                                  <span key={m}>
                                                    {i > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                                                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(m)}</span>
                                                    {' '}{top.weight}{top.unit}{top.reps != null ? ` x${top.reps}` : ''}
                                                  </span>
                                                ))}
                                              </div>
                                            );
                                          })()}

                                          {isSkills && blockEntries.length > 0 && (
                                            <div style={{ paddingLeft: 8, marginTop: 8, fontSize: 13, color: 'var(--text-dim)' }}>
                                              {blockEntries.map((entry, ei) => {
                                                const parts: string[] = [];
                                                if (entry.sets != null) parts.push(`${entry.sets} sets`);
                                                if (entry.reps_completed != null) parts.push(`x${entry.reps_completed}`);
                                                if (entry.hold_seconds != null) parts.push(`${entry.hold_seconds}s hold`);
                                                const detail = parts.length > 0 ? parts.join(' ') : 'practiced';
                                                return (
                                                  <span key={entry.id}>
                                                    {ei > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                                                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(entry.movement)}</span>
                                                    {' '}{detail}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          )}

                                          {block.block_type === 'accessory' && blockEntries.length > 0 && (() => {
                                            // One-line top-set per movement. Full detail + edit
                                            // lives on the Accessory tab — accessory's single home.
                                            const lbsOf = (w: number, u: string) => u === 'kg' ? w * 2.20462 : w;
                                            const tops = new Map<string, { weight: number | null; reps: number | null; unit: string }>();
                                            for (const e of blockEntries) {
                                              const cur = tops.get(e.movement);
                                              if (e.weight != null && e.weight > 0) {
                                                if (!cur || cur.weight == null || lbsOf(e.weight, e.weight_unit) > lbsOf(cur.weight, cur.unit)) {
                                                  tops.set(e.movement, { weight: e.weight, reps: e.reps, unit: e.weight_unit });
                                                }
                                              } else if (!cur) {
                                                tops.set(e.movement, { weight: null, reps: e.reps, unit: '' });
                                              }
                                            }
                                            if (tops.size === 0) return null;
                                            return (
                                              <div style={{ paddingLeft: 8, marginTop: 8, fontSize: 13, color: 'var(--text-dim)' }}>
                                                {[...tops.entries()].map(([m, top], i) => (
                                                  <span key={m}>
                                                    {i > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                                                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(m)}</span>
                                                    {top.weight != null ? ` ${top.weight}${top.unit}` : ''}
                                                    {top.reps != null ? ` x${top.reps}` : ''}
                                                  </span>
                                                ))}
                                              </div>
                                            );
                                          })()}

                                          {block.block_type === 'metcon' && blockEntries.length > 0 && (
                                            <div style={{ paddingLeft: 8, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                              {blockEntries.map((entry, ei) => (
                                                editingEntryId === entry.id ? (
                                                  <div key={ei} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: '100%', alignItems: 'center' }}>
                                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{formatMovementName(entry.movement)}</span>
                                                    <input type="number" value={editFields.reps} onChange={ev => setEditFields(f => ({ ...f, reps: ev.target.value }))} placeholder="Reps" style={{ width: 50, padding: '2px 5px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                                    <input type="number" value={editFields.weight} onChange={ev => setEditFields(f => ({ ...f, weight: ev.target.value }))} placeholder="Weight" style={{ width: 70, padding: '2px 5px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                                                    <button onClick={() => saveEdit(entry.id)} disabled={editSaving} style={{ padding: '2px 6px', fontSize: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{editSaving ? '...' : 'Save'}</button>
                                                    <button onClick={cancelEdit} style={{ padding: '2px 6px', fontSize: 11, background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                                                    <button onClick={() => deleteEntry(entry.id)} disabled={editSaving} style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', color: 'var(--danger, #e74c3c)', border: 'none', cursor: 'pointer' }}>Delete</button>
                                                  </div>
                                                ) : (
                                                <span key={ei} onClick={(ev) => { ev.stopPropagation(); startEdit(entry); }} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }} title="Click to edit">
                                                  {formatMovementName(entry.movement)}
                                                  {entry.reps != null && ` x${entry.reps}`}
                                                  {entry.weight != null && ` @${entry.weight}${entry.weight_unit}`}
                                                  {entry.distance != null && ` ${entry.distance}${entry.distance_unit || 'm'}`}
                                                  {entry.scaling_note && ` (${entry.scaling_note})`}
                                                </span>
                                                )
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)' }}>
                                    {log.workout_text}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  );
                })()}
              </>
            )}

            {/* Back to program link */}
            <div style={{ textAlign: 'center', padding: '32px 0 16px' }}>
              <button
                onClick={() => navigate('/programs')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                </svg>
                Back to Training Program
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
