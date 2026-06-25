import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, ADJUST_WORKOUT_ENDPOINT, getAuthHeaders } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import { useMovementVocab, matchMovements } from '../lib/movementVocab';
import { GainsName } from '../components/GainsLogo';
import Nav from '../components/Nav';
import WorkoutBlocksDisplay, { BlockContent } from '../components/WorkoutBlocksDisplay';
import { BlockCoachingBody, coachingForBlockType, formatReviewMarkdown, CHEVRON_DOWN, type ReviewBlock } from '../components/reviewCoaching';
import { useWorkoutReview } from '../lib/useWorkoutReview';
import BlockLog, { type DayLogController } from '../components/blockLog';

interface ProgramBlock {
  id: string;
  program_workout_id: string;
  block_type: string;
  block_order: number;
  block_text: string;
}

interface ProgramWorkout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
  day_type?: string | null;
}

// v3 structured data shapes — fetched from program_blocks_v2 +
// program_movements_v2 when programs.program_version === 'v3'.
export interface ProgramMovementV2 {
  id: string;
  block_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  rep_scheme: number[] | null;
  calories: number | null;
  weight: number | null;
  weight_unit: string | null;
  rpe: number | null;
  time_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  scaling_note: string | null;
  target_pct_1rm: number | null;
  sort_order: number;
}

export interface ProgramBlockV2 {
  id: string;
  program_workout_id: string;
  block_type: string;
  block_label: string | null;
  block_scheme: string | null;
  time_cap_seconds: number | null;
  block_notes: string | null;
  sort_order: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expected_benchmark: any | null;
  movements: ProgramMovementV2[];
}

// AI Edit proposal shape (BlockPrescription from the adjust-workout edge fn).
export interface BlockProposalMovement {
  movement: string;
  sets?: number | null;
  reps?: number | null;
  rep_scheme?: number[] | null;
  weight?: number | null;
  weight_unit?: string | null;
  rpe?: number | null;
  time_seconds?: number | null;
  distance?: number | null;
  distance_unit?: string | null;
  scaling_note?: string | null;
  target_pct_1rm?: number | null;
  cardio_modality?: string | null;
  calories?: number | null;
}
export interface BlockProposal {
  block_type: string;
  block_label?: string | null;
  block_scheme?: string | null;
  time_cap_seconds?: number | null;
  block_notes?: string | null;
  cardio_modality?: string | null;
  movements: BlockProposalMovement[];
}

/** Mirror save-program-v3's reconcileReps: rep_scheme present → reps = sum. */
export function reconcileReps(
  reps: number | null | undefined,
  repScheme: number[] | null | undefined,
): { reps: number | null; rep_scheme: number[] | null } {
  if (!Array.isArray(repScheme) || repScheme.length === 0) {
    return { reps: reps ?? null, rep_scheme: null };
  }
  const cleaned = repScheme.filter((n) => Number.isFinite(n) && n > 0 && n <= 1000);
  if (cleaned.length === 0) return { reps: reps ?? null, rep_scheme: null };
  return { reps: cleaned.reduce((a, b) => a + b, 0), rep_scheme: cleaned };
}

const DAY_TYPE_LABELS: Record<string, string> = {
  strength: 'Strength Day',
  metcon: 'Metcon Day',
  fitness: 'Fitness Day',
  skill: 'Skill Day',
  recovery: 'Recovery Day',
};

const SUMMARY_LABELS = ['skills', 'strength', 'metcon', 'accessory'] as const;

const DISPLAY_LABELS: Record<string, string> = {
  skills: 'Skill',
  strength: 'Strength',
  metcon: 'Conditioning',
  accessory: 'Accessory',
};

interface SummaryLine { label: string; text: string }

/** Extract structured summary lines from workout text. */
function workoutSummaryLines(text: string): SummaryLine[] {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const allLabels = ['warm-up', 'skills', 'strength', 'metcon', 'cool down', 'accessory', 'mobility'];
  const lines: SummaryLine[] = [];

  for (const label of SUMMARY_LABELS) {
    const needle = label + ':';
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    let end = text.length;
    for (const other of allLabels) {
      const otherNeedle = other + ':';
      const idx = lower.indexOf(otherNeedle, contentStart);
      if (idx >= 0 && idx < end) end = idx;
    }
    const content = text.slice(contentStart, end).trim();
    const firstLine = content.split('\n')[0].trim();
    if (firstLine) {
      lines.push({
        label: DISPLAY_LABELS[label] || label,
        text: firstLine.length > 40 ? firstLine.slice(0, 38) + '…' : firstLine,
      });
    }
  }

  return lines;
}

export default function ProgramDetailPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const monthFilter = searchParams.get('month') ? parseInt(searchParams.get('month')!, 10) : null;
  const { isAdmin } = useEntitlements(session.user.id);
  const [program, setProgram] = useState<{
    id: string;
    name: string;
    source?: string;
    generated_months?: number;
    program_version?: string;
    month_plan?: unknown;
  } | null>(null);
  const [allWorkouts, setAllWorkouts] = useState<ProgramWorkout[]>([]);
  const [completedWorkoutIds, setCompletedWorkoutIds] = useState<Set<string>>(new Set());
  const [inProgressWorkouts, setInProgressWorkouts] = useState<Map<string, { logId: string; savedCount: number; totalBlocks: number }>>(new Map());
  const [workoutBlocks, setWorkoutBlocks] = useState<Map<string, ProgramBlock[]>>(new Map());
  // v3-only: structured blocks + movements per program_workout_id.
  const [v3BlocksByWorkout, setV3BlocksByWorkout] = useState<Map<string, ProgramBlockV2[]>>(new Map());
  const [aiEditedBlockIds, setAiEditedBlockIds] = useState<Set<string>>(new Set());
  // workoutId → { id, scheduled_date } for days the user has put on the calendar.
  const [scheduleByWorkout, setScheduleByWorkout] = useState<Map<string, { id: string; scheduled_date: string }>>(new Map());
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [editingProgramName, setEditingProgramName] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [generatingNextMonth, setGeneratingNextMonth] = useState(false);


  // v3 movement edit. Optimistic local update + UPDATE; revert on error.
  const updateMovementField = useCallback(async (movementId: string, patch: Partial<ProgramMovementV2>) => {
    let previous: ProgramMovementV2 | undefined;
    setV3BlocksByWorkout(prev => {
      const next = new Map(prev);
      for (const [wid, blocks] of next) {
        const updatedBlocks = blocks.map(b => {
          const idx = b.movements.findIndex(m => m.id === movementId);
          if (idx < 0) return b;
          previous = b.movements[idx];
          return { ...b, movements: b.movements.map((m, i) => i === idx ? { ...m, ...patch } : m) };
        });
        next.set(wid, updatedBlocks);
      }
      return next;
    });
    const { error } = await supabase.from('program_movements_v2').update(patch).eq('id', movementId);
    if (error && previous) {
      const restore = previous;
      setV3BlocksByWorkout(prev => {
        const next = new Map(prev);
        for (const [wid, blocks] of next) {
          next.set(wid, blocks.map(b => ({
            ...b,
            movements: b.movements.map(m => m.id === movementId ? restore : m),
          })));
        }
        return next;
      });
      throw error;
    }
  }, []);

  // v3 edit a block-level field (e.g. block_scheme — the "Every 90s for 12 min"
  // line). Optimistic, with rollback on error. Same pattern as movement edits.
  const updateBlockField = useCallback(async (blockId: string, patch: Partial<ProgramBlockV2>) => {
    let previous: ProgramBlockV2 | undefined;
    setV3BlocksByWorkout(prev => {
      const next = new Map(prev);
      for (const [wid, blocks] of next) {
        next.set(wid, blocks.map(b => {
          if (b.id !== blockId) return b;
          previous = b;
          return { ...b, ...patch };
        }));
      }
      return next;
    });
    const { error } = await supabase.from('program_blocks_v2').update(patch).eq('id', blockId);
    if (error && previous) {
      const restore = previous;
      setV3BlocksByWorkout(prev => {
        const next = new Map(prev);
        for (const [wid, blocks] of next) {
          next.set(wid, blocks.map(b => b.id === blockId ? restore : b));
        }
        return next;
      });
      throw error;
    }
  }, []);

  // v3 add a task to a block. Block structure stays locked; only the movement
  // list grows. New row gets a placeholder name the user overwrites.
  const MOVEMENT_SELECT = 'id, block_id, movement, sets, reps, rep_scheme, calories, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, sort_order';
  const addMovementToBlock = useCallback(async (blockId: string) => {
    let maxSort = -1;
    for (const blocks of v3BlocksByWorkout.values()) {
      const b = blocks.find(bl => bl.id === blockId);
      if (b) { for (const m of b.movements) maxSort = Math.max(maxSort, m.sort_order); break; }
    }
    const { data, error } = await supabase
      .from('program_movements_v2')
      .insert({ block_id: blockId, movement: 'New movement', sort_order: maxSort + 1 })
      .select(MOVEMENT_SELECT)
      .single();
    if (error || !data) return;
    const newMovement = data as ProgramMovementV2;
    setV3BlocksByWorkout(prev => {
      const next = new Map(prev);
      for (const [wid, blocks] of next) {
        const idx = blocks.findIndex(b => b.id === blockId);
        if (idx >= 0) {
          next.set(wid, blocks.map((b, i) => i === idx ? { ...b, movements: [...b.movements, newMovement] } : b));
          break;
        }
      }
      return next;
    });
  }, [v3BlocksByWorkout]);

  // v3 remove a task from a block. Empty blocks are allowed (the user may re-add).
  const removeMovementFromBlock = useCallback(async (movementId: string) => {
    const { error } = await supabase.from('program_movements_v2').delete().eq('id', movementId);
    if (error) return;
    setV3BlocksByWorkout(prev => {
      const next = new Map(prev);
      for (const [wid, blocks] of next) {
        next.set(wid, blocks.map(b => ({ ...b, movements: b.movements.filter(m => m.id !== movementId) })));
      }
      return next;
    });
  }, []);

  // AI Edit — propose (edge fn), then accept (apply) or refuse. One shot per
  // block: the ai_edit_log row written on propose IS the lock.
  const proposeAiEdit = useCallback(async (blockId: string, request: string): Promise<{
    proposal: BlockProposal; original: BlockProposal; ai_edit_log_id: string;
  }> => {
    const resp = await fetch(ADJUST_WORKOUT_ENDPOINT, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ block_id: blockId, request }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || `AI Edit failed (${resp.status})`);
    return data;
  }, []);

  const applyAiProposal = useCallback(async (blockId: string, proposal: BlockProposal, aiLogId: string) => {
    const { error: bErr } = await supabase.from('program_blocks_v2').update({
      block_type: proposal.block_type,
      block_label: proposal.block_label ?? null,
      block_scheme: proposal.block_scheme ?? null,
      time_cap_seconds: proposal.time_cap_seconds ?? null,
      block_notes: proposal.block_notes ?? null,
      cardio_modality: proposal.cardio_modality ?? null,
    }).eq('id', blockId);
    if (bErr) throw bErr;

    await supabase.from('program_movements_v2').delete().eq('block_id', blockId);
    const inserts = proposal.movements.map((m, i) => {
      const { reps, rep_scheme } = reconcileReps(m.reps, m.rep_scheme);
      return {
        block_id: blockId,
        movement: m.movement,
        sets: m.sets ?? null,
        reps, rep_scheme,
        weight: m.weight ?? null,
        weight_unit: m.weight_unit ?? null,
        rpe: m.rpe ?? null,
        time_seconds: m.time_seconds ?? null,
        distance: m.distance ?? null,
        distance_unit: m.distance_unit ?? null,
        calories: m.calories ?? null,
        cardio_modality: m.cardio_modality ?? null,
        scaling_note: m.scaling_note ?? null,
        target_pct_1rm: m.target_pct_1rm ?? null,
        sort_order: i,
      };
    });
    let insertedRows: ProgramMovementV2[] = [];
    if (inserts.length) {
      const { data, error: insErr } = await supabase
        .from('program_movements_v2')
        .insert(inserts)
        .select('id, block_id, movement, sets, reps, rep_scheme, calories, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, sort_order');
      if (insErr) throw insErr;
      insertedRows = (data ?? []) as ProgramMovementV2[];
    }

    await supabase.from('ai_edit_log')
      .update({ outcome: 'accepted', resolved_at: new Date().toISOString() })
      .eq('id', aiLogId);

    setV3BlocksByWorkout(prev => {
      const next = new Map(prev);
      for (const [wid, blocks] of next) {
        const idx = blocks.findIndex(b => b.id === blockId);
        if (idx >= 0) {
          const updated: ProgramBlockV2 = {
            ...blocks[idx],
            block_type: proposal.block_type,
            block_label: proposal.block_label ?? null,
            block_scheme: proposal.block_scheme ?? null,
            time_cap_seconds: proposal.time_cap_seconds ?? null,
            block_notes: proposal.block_notes ?? null,
            movements: insertedRows,
          };
          next.set(wid, blocks.map((b, i2) => i2 === idx ? updated : b));
        }
      }
      return next;
    });
    setAiEditedBlockIds(prev => new Set(prev).add(blockId));
  }, []);

  const refuseAiProposal = useCallback(async (blockId: string, aiLogId: string) => {
    await supabase.from('ai_edit_log')
      .update({ outcome: 'refused', resolved_at: new Date().toISOString() })
      .eq('id', aiLogId);
    setAiEditedBlockIds(prev => new Set(prev).add(blockId));
  }, []);

  // Calendar: assign / reschedule a program day to a date. One program day per
  // date per user (DB partial unique index) — a collision surfaces as 23505.
  const scheduleDay = useCallback(async (workoutId: string, dateStr: string) => {
    setScheduleError(null);
    const existing = scheduleByWorkout.get(workoutId);
    if (existing) {
      const { error } = await supabase
        .from('training_schedule')
        .update({ scheduled_date: dateStr })
        .eq('id', existing.id);
      if (error) {
        setScheduleError(error.code === '23505'
          ? 'That date already has a training day scheduled.'
          : (error.message || 'Could not reschedule.'));
        return;
      }
      setScheduleByWorkout(prev => new Map(prev).set(workoutId, { ...existing, scheduled_date: dateStr }));
    } else {
      const { data, error } = await supabase
        .from('training_schedule')
        .insert({ user_id: session.user.id, program_workout_id: workoutId, scheduled_date: dateStr })
        .select('id, scheduled_date')
        .single();
      if (error || !data) {
        setScheduleError(error?.code === '23505'
          ? 'That date already has a training day scheduled.'
          : (error?.message || 'Could not add to calendar.'));
        return;
      }
      const row = data as { id: string; scheduled_date: string };
      setScheduleByWorkout(prev => new Map(prev).set(workoutId, { id: row.id, scheduled_date: row.scheduled_date }));
    }
  }, [scheduleByWorkout, session.user.id]);

  const unscheduleDay = useCallback(async (workoutId: string) => {
    setScheduleError(null);
    const existing = scheduleByWorkout.get(workoutId);
    if (!existing) return;
    const { error } = await supabase.from('training_schedule').delete().eq('id', existing.id);
    if (error) { setScheduleError(error.message || 'Could not remove.'); return; }
    setScheduleByWorkout(prev => {
      const next = new Map(prev);
      next.delete(workoutId);
      return next;
    });
  }, [scheduleByWorkout]);

  // Dates already taken by a program day (within this program) — the quick-pick
  // greys these out so users don't hit the one-per-date collision.
  const takenProgramDates = useMemo(
    () => new Set(Array.from(scheduleByWorkout.values()).map(v => v.scheduled_date)),
    [scheduleByWorkout],
  );

  useEffect(() => {
    if (!id) return;
    loadProgram();
  }, [id, session.user.id]);

  // Deep-link from the calendar's "View in program": ?day=<workoutId> expands
  // that day and scrolls to it, so the user lands ON the day they tapped.
  const dayParam = searchParams.get('day');
  useEffect(() => {
    if (!dayParam || !allWorkouts.some(w => w.id === dayParam)) return;
    setExpandedDays(prev => new Set(prev).add(dayParam));
    const t = setTimeout(() => {
      document.getElementById(`day-${dayParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);
    return () => clearTimeout(t);
  }, [dayParam, allWorkouts]);

  const loadProgram = async () => {
    if (!id) return;
    setLoading(true);
    const { data: prog, error: progErr } = await supabase
      .from('programs')
      .select('id, name, source, generated_months, program_version, month_plan')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (progErr || !prog) {
      setProgram(null);
      setAllWorkouts([]);
      setLoading(false);
      return;
    }
    setProgram(prog);
    const { data: wk } = await supabase
      .from('program_workouts')
      .select('id, week_num, day_num, workout_text, sort_order, month_number, day_type')
      .eq('program_id', id)
      .order('sort_order');
    setAllWorkouts(wk || []);

    // Calendar overlay: which of this program's days the user has scheduled.
    if (wk?.length) {
      const wkIds = wk.map((w) => w.id);
      const schedMap = new Map<string, { id: string; scheduled_date: string }>();
      for (let i = 0; i < wkIds.length; i += 100) {
        const batch = wkIds.slice(i, i + 100);
        const { data: sched } = await supabase
          .from('training_schedule')
          .select('id, program_workout_id, scheduled_date')
          .in('program_workout_id', batch);
        for (const s of sched || []) {
          const row = s as { id: string; program_workout_id: string; scheduled_date: string };
          schedMap.set(row.program_workout_id, { id: row.id, scheduled_date: row.scheduled_date });
        }
      }
      setScheduleByWorkout(schedMap);
    }

    const isV3 = prog.program_version === 'v3';

    // v1 path: fetch prose blocks from program_workout_blocks.
    // v3 path: fetch structured blocks + movements from program_blocks_v2 + program_movements_v2.
    if (wk?.length && !isV3) {
      const ids = wk.map((w) => w.id);
      const blockMap = new Map<string, ProgramBlock[]>();
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data: blocks } = await supabase
          .from('program_workout_blocks')
          .select('id, program_workout_id, block_type, block_order, block_text')
          .in('program_workout_id', batch)
          .order('block_order');
        for (const b of blocks || []) {
          const existing = blockMap.get(b.program_workout_id) || [];
          existing.push(b as ProgramBlock);
          blockMap.set(b.program_workout_id, existing);
        }
      }
      setWorkoutBlocks(blockMap);
    }

    if (wk?.length && isV3) {
      const workoutIds = wk.map((w) => w.id);
      const blocksByWorkout = new Map<string, ProgramBlockV2[]>();
      // 1. Fetch all blocks for these workouts (batched).
      const allBlocks: Array<ProgramBlockV2 & { program_workout_id: string }> = [];
      for (let i = 0; i < workoutIds.length; i += 100) {
        const batch = workoutIds.slice(i, i + 100);
        const { data: blocks } = await supabase
          .from('program_blocks_v2')
          .select('id, program_workout_id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, sort_order, expected_benchmark')
          .in('program_workout_id', batch)
          .order('sort_order');
        for (const b of blocks || []) {
          allBlocks.push({ ...(b as ProgramBlockV2), movements: [] });
        }
      }
      // 2. Fetch all movements for those blocks (batched).
      const movementsByBlock = new Map<string, ProgramMovementV2[]>();
      if (allBlocks.length) {
        const blockIds = allBlocks.map((b) => b.id);
        for (let i = 0; i < blockIds.length; i += 100) {
          const batch = blockIds.slice(i, i + 100);
          const { data: movements } = await supabase
            .from('program_movements_v2')
            .select('id, block_id, movement, sets, reps, rep_scheme, calories, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, sort_order')
            .in('block_id', batch)
            .order('sort_order');
          for (const m of movements || []) {
            const arr = movementsByBlock.get((m as ProgramMovementV2).block_id) ?? [];
            arr.push(m as ProgramMovementV2);
            movementsByBlock.set((m as ProgramMovementV2).block_id, arr);
          }
        }
      }
      // 3. Group blocks-with-movements by program_workout_id.
      for (const b of allBlocks) {
        b.movements = movementsByBlock.get(b.id) ?? [];
        const arr = blocksByWorkout.get(b.program_workout_id) ?? [];
        arr.push(b);
        blocksByWorkout.set(b.program_workout_id, arr);
      }
      setV3BlocksByWorkout(blocksByWorkout);

      // 4. Which blocks have already used their one AI Edit (lock).
      if (allBlocks.length) {
        const locked = new Set<string>();
        const blockIds = allBlocks.map((b) => b.id);
        for (let i = 0; i < blockIds.length; i += 100) {
          const batch = blockIds.slice(i, i + 100);
          const { data: logs } = await supabase
            .from('ai_edit_log')
            .select('block_id')
            .in('block_id', batch);
          for (const l of logs || []) locked.add((l as { block_id: string }).block_id);
        }
        setAiEditedBlockIds(locked);
      }
    }

    if (wk?.length) {
      const ids = wk.map((w) => w.id);
      // Query in batches of 100 to avoid URL length limits
      const allCompleted = new Set<string>();
      const ipMap = new Map<string, { logId: string; savedCount: number; totalBlocks: number }>();
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data: logs } = await supabase
          .from('workout_logs')
          .select('id, source_id, status')
          .eq('user_id', session.user.id)
          .in('source_id', batch);
        for (const l of logs || []) {
          if (!l.source_id) continue;
          if (l.status === 'completed') {
            allCompleted.add(l.source_id);
          } else if (l.status === 'in_progress') {
            // Count saved blocks for this in-progress log (exclude warm-up/cool-down)
            const { count } = await supabase
              .from('workout_log_blocks')
              .select('id', { count: 'exact', head: true })
              .eq('log_id', l.id)
              .not('block_type', 'in', '("warm-up","mobility","cool-down")');
            // Count total blocks for this workout (exclude warm-up/cool-down)
            const { count: totalCount } = await supabase
              .from(isV3 ? 'program_blocks_v2' : 'program_workout_blocks')
              .select('id', { count: 'exact', head: true })
              .eq('program_workout_id', l.source_id)
              .not('block_type', 'in', '("warm-up","mobility","cool-down")');
            ipMap.set(l.source_id, {
              logId: l.id,
              savedCount: count ?? 0,
              totalBlocks: totalCount ?? 0,
            });
          }
        }
      }
      setCompletedWorkoutIds(allCompleted);
      setInProgressWorkouts(ipMap);
    } else {
      setCompletedWorkoutIds(new Set());
      setInProgressWorkouts(new Map());
    }

    setLoading(false);
  };

  const handleNameChange = async (newName: string) => {
    const trimmed = newName.trim() || 'Untitled Program';
    if (!id || !program || trimmed === program.name) return;
    const { error } = await supabase.from('programs').update({ name: trimmed }).eq('id', id).eq('user_id', session.user.id);
    if (!error) setProgram(p => p ? { ...p, name: trimmed } : null);
  };

  const workouts = monthFilter
    ? allWorkouts.filter((w: any) => (w.month_number || 1) === monthFilter)
    : allWorkouts;
  const completedCount = workouts.filter(w => completedWorkoutIds.has(w.id)).length;
  const isGenerated = program?.source === 'generated' || program?.name?.startsWith('Month ');

  const handleGenerateNextMonth = async () => {
    if (!program || generatingNextMonth) return;
    setGeneratingNextMonth(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-next-month', {
        body: { program_id: program.id },
      });
      if (error) throw error;
      // Poll for completion
      const pollInterval = setInterval(async () => {
        const { data: jobData } = await supabase.functions.invoke('program-job-status', {
          body: { job_id: data.job_id },
        });
        if (jobData?.status === 'complete') {
          clearInterval(pollInterval);
          setGeneratingNextMonth(false);
          // Reload program to show new workouts
          loadProgram();
        } else if (jobData?.status === 'failed') {
          clearInterval(pollInterval);
          setGeneratingNextMonth(false);
          alert('Failed to generate next month: ' + (jobData?.error || 'Unknown error'));
        }
      }, 5000);
    } catch (err) {
      console.error('Generate next month failed:', err);
      setGeneratingNextMonth(false);
      alert('Failed to start generation');
    }
  };

  // TEMP (admin/v3 testing): invoke generate-program-v3 continuation directly
  // (program_id only → the function derives month from generated_months) to
  // verify the month-append path before generate-next-month is repointed at v3.
  const handleGenerateNextMonthV3 = async () => {
    if (!program || generatingNextMonth) return;
    setGeneratingNextMonth(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-program-v3', {
        body: { program_id: program.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message || data.error);
      const pollInterval = setInterval(async () => {
        const { data: jobData } = await supabase.functions.invoke('program-job-status', {
          body: { job_id: data.job_id },
        });
        if (jobData?.status === 'complete') {
          clearInterval(pollInterval);
          setGeneratingNextMonth(false);
          loadProgram();
        } else if (jobData?.status === 'failed') {
          clearInterval(pollInterval);
          setGeneratingNextMonth(false);
          alert('v3 next month failed: ' + (jobData?.error || 'Unknown error'));
        }
      }, 5000);
    } catch (err: any) {
      console.error('Generate next month (v3) failed:', err);
      setGeneratingNextMonth(false);
      alert('Failed to start v3 generation: ' + (err?.message || 'unknown'));
    }
  };

  if (!id) return null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          {program ? (
            editingProgramName ? (
              <input
                type="text"
                className="program-detail-name-input"
                autoFocus
                value={program.name}
                onChange={e => setProgram(p => p ? { ...p, name: e.target.value } : null)}
                onBlur={e => { handleNameChange(e.target.value); setEditingProgramName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
              />
            ) : (
              <h1
                className="program-detail-name-input"
                style={{ cursor: 'pointer', margin: 0, background: 'none', border: 'none' }}
                title="Click to rename"
                onClick={() => setEditingProgramName(true)}
              >
                <GainsName name={program.name} />
              </h1>
            )
          ) : (
            <h1>{monthFilter ? `Month ${monthFilter}` : 'Program'}</h1>
          )}
        </header>
        <div className="page-body">
          <div className="program-detail-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : !program ? (
              <div className="empty-state">
                <p>Program not found.</p>
                <button className="auth-btn" onClick={() => navigate('/programs')}>Back to programs</button>
              </div>
            ) : (
              <>
                {workouts.length > 0 && (
                  <div className="program-progress">
                    <div className="program-progress-header">
                      <span className="program-progress-label">Progress</span>
                      <span className="program-progress-count">{completedCount} / {workouts.length} days</span>
                    </div>
                    <div className="program-progress-bar">
                      <div
                        className="program-progress-fill"
                        style={{ width: `${(completedCount / workouts.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {scheduleError && (
                  <div className="schedule-error-banner" onClick={() => setScheduleError(null)}>
                    {scheduleError} <span className="schedule-error-dismiss">✕</span>
                  </div>
                )}
                <div className="program-days-accordion">
                  {(() => {
                    // Group workouts by month, then into weeks of 5 within each month
                    const monthGroups = new Map<number, ProgramWorkout[]>();
                    workouts.forEach((w) => {
                      const month = (w as any).month_number || 1;
                      if (!monthGroups.has(month)) monthGroups.set(month, []);
                      monthGroups.get(month)!.push(w);
                    });
                    const sortedMonths = Array.from(monthGroups.keys()).sort((a, b) => a - b);
                    const hasMultipleMonths = sortedMonths.length > 1 || (program?.generated_months || 1) > 1;

                    return sortedMonths.map(month => {
                      const monthWorkouts = monthGroups.get(month)!;
                      // Group by week_num written by the generator (handles variable
                      // days_per_week across the new archetype-based generation).
                      const weeks: { weekNum: number; days: ProgramWorkout[] }[] = [];
                      const weekMap = new Map<number, ProgramWorkout[]>();
                      monthWorkouts.forEach((w) => {
                        const wn = w.week_num || 1;
                        if (!weekMap.has(wn)) weekMap.set(wn, []);
                        weekMap.get(wn)!.push(w);
                      });
                      Array.from(weekMap.keys()).sort((a, b) => a - b).forEach((wn) => {
                        weeks.push({ weekNum: (month - 1) * 4 + wn, days: weekMap.get(wn)!.sort((a, b) => a.day_num - b.day_num) });
                      });

                      return (
                        <div key={month}>
                          {hasMultipleMonths && (
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', margin: '24px 0 12px', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                              Month {month}
                            </div>
                          )}
                          {weeks.map((week, wi) => (
                      <div key={wi} className="program-week-group">
                        <div className="program-week-label">Week {week.weekNum}</div>
                        {week.days.map((w) => {
                          const rawIp = inProgressWorkouts.get(w.id);
                          // Treat an in-progress log whose savedCount has reached
                          // totalBlocks as completed in the UI, even if the server
                          // hasn't flipped status yet (covers existing logs from
                          // before the save-workout-block auto-complete fix).
                          const allBlocksSaved = !!rawIp && rawIp.totalBlocks > 0 && rawIp.savedCount >= rawIp.totalBlocks;
                          const done = completedWorkoutIds.has(w.id) || allBlocksSaved;
                          const ip = done ? undefined : rawIp;
                          const isExpanded = expandedDays.has(w.id);
                          return (
                            <div key={w.id} id={`day-${w.id}`} className={`program-day-row${done ? ' program-day-completed' : ip ? ' program-day-in-progress' : ''}`}>
                              <div className="program-day-headrow">
                              <button
                                className="program-day-header"
                                onClick={() => {
                                  // v3 days open the dedicated day surface; v1 days have no
                                  // program_blocks_v2 rows (DayPage is v3-only) so they expand
                                  // inline to the prose + Coach + Start body below.
                                  if (program?.program_version === 'v3') {
                                    navigate(`/day/${w.id}`);
                                  } else {
                                    setExpandedDays(prev => {
                                      const next = new Set(prev);
                                      if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                                      return next;
                                    });
                                  }
                                }}
                                aria-label={`Open Day ${w.day_num}`}
                              >
                                <div className="program-day-left">
                                  <div className="program-day-top-row">
                                    {done ? (
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                    ) : ip ? (
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning, #f39c12)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                    ) : (
                                      <span className="program-day-dot" />
                                    )}
                                    <span className="program-day-label">Day {w.day_num}</span>
                                    {w.day_type && DAY_TYPE_LABELS[w.day_type] && (
                                      <span className="program-day-archetype" style={{
                                        fontSize: 11, color: 'var(--text-dim)', marginLeft: 6,
                                        textTransform: 'uppercase', letterSpacing: 0.5,
                                      }}>
                                        {DAY_TYPE_LABELS[w.day_type]}
                                      </span>
                                    )}
                                    {done && <span className="program-completed-badge">Done</span>}
                                    {ip && <span className="program-in-progress-badge">{ip.savedCount}/{ip.totalBlocks} blocks</span>}
                                  </div>
                                  {!isExpanded && (
                                    <div className="program-day-summary-lines">
                                      {program?.program_version === 'v3' ? (
                                        // v3: read from program_blocks_v2 (in v3BlocksByWorkout).
                                        // Show strength, metcon, skills, accessory preview lines.
                                        (v3BlocksByWorkout.get(w.id) ?? [])
                                          .filter((b) => ['strength', 'metcon', 'cardio', 'skills', 'accessory', 'other'].includes(b.block_type))
                                          .map((b) => {
                                            const label = BLOCK_DISPLAY[b.block_type] ?? b.block_type.charAt(0).toUpperCase() + b.block_type.slice(1);
                                            // Lead with the movements (so athletes can see the weaknesses
                                            // being targeted), then the scheme. CSS ellipsis trims overflow.
                                            const moves = b.movements.map((m) => m.movement).filter(Boolean).slice(0, 3).join(' · ');
                                            const scheme = (b.block_scheme && b.block_scheme.trim()) || (b.block_label && b.block_label.trim()) || '';
                                            const text =
                                              [moves, scheme].filter(Boolean).join(' — ') ||
                                              (b.block_type === 'other' ? 'Rest day' : '');
                                            return (
                                              <div key={b.id} className="program-day-summary-line">
                                                <span className="program-day-summary-label">{label}:</span>
                                                <span className="program-day-summary-text">{text}</span>
                                              </div>
                                            );
                                          })
                                      ) : workoutBlocks.has(w.id) && workoutBlocks.get(w.id)!.length > 0 ? (
                                        workoutBlocks.get(w.id)!
                                          .filter((b) => ['skills', 'strength', 'metcon', 'accessory'].includes(b.block_type))
                                          .map((b) => {
                                            const label = b.block_type === 'metcon' ? 'Conditioning' : b.block_type.charAt(0).toUpperCase() + b.block_type.slice(1);
                                            const firstLine = b.block_text.split('\n')[0].trim();
                                            const text = firstLine.length > 40 ? firstLine.slice(0, 38) + '…' : firstLine;
                                            return (
                                              <div key={b.id} className="program-day-summary-line">
                                                <span className="program-day-summary-label">{label}:</span>
                                                <span className="program-day-summary-text">{text}</span>
                                              </div>
                                            );
                                          })
                                      ) : (
                                        workoutSummaryLines(w.workout_text).map((line) => (
                                          <div key={line.label} className="program-day-summary-line">
                                            <span className="program-day-summary-label">{line.label}:</span>
                                            <span className="program-day-summary-text">{line.text}</span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                                <svg
                                  className="program-day-chevron"
                                  width="16" height="16" viewBox="0 0 24 24"
                                  fill="none" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round"
                                >
                                  <polyline points="9 6 15 12 9 18" />
                                </svg>
                              </button>
                              <DayScheduleControl
                                entry={scheduleByWorkout.get(w.id)}
                                takenDates={takenProgramDates}
                                onPick={(dateStr) => scheduleDay(w.id, dateStr)}
                                onClear={() => unscheduleDay(w.id)}
                              />
                              </div>
                              {isExpanded && (
                                <div className="program-day-body">
                                  <div className="program-day-blocks">
                                    {program?.program_version === 'v3' ? (
                                      <V3DayView
                                        blocks={v3BlocksByWorkout.get(w.id) ?? []}
                                        sourceId={w.id}
                                        workoutText={v3BlocksToProse(v3BlocksByWorkout.get(w.id) ?? [])}
                                        onUpdateMovement={updateMovementField}
                                        onUpdateBlock={updateBlockField}
                                        onAddMovement={addMovementToBlock}
                                        onRemoveMovement={removeMovementFromBlock}
                                        aiEditedBlockIds={aiEditedBlockIds}
                                        onProposeAiEdit={proposeAiEdit}
                                        onApplyAiProposal={applyAiProposal}
                                        onRefuseAiProposal={refuseAiProposal}
                                      />
                                    ) : workoutBlocks.has(w.id) && workoutBlocks.get(w.id)!.length > 0 ? (
                                      <div className="workout-blocks">
                                        {workoutBlocks.get(w.id)!.map((b, bi) => (
                                          <div key={bi} className="workout-block">
                                            <div className="workout-block-label" data-block={b.block_type}>{
                                              b.block_type === 'warm-up' ? 'Warm-up' :
                                              b.block_type === 'cool-down' ? 'Cool down' :
                                              b.block_type.charAt(0).toUpperCase() + b.block_type.slice(1)
                                            }</div>
                                            <div className="workout-block-content">
                                              <BlockContent label={b.block_type === 'skills' ? 'Skills' : ''} content={b.block_text} />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <WorkoutBlocksDisplay text={w.workout_text} />
                                    )}
                                  </div>
                                  <div className="program-day-actions">
                                    {(() => {
                                      // For v3, generate a v1-style prose representation from the
                                      // structured blocks so the existing Coach + Start flows work
                                      // unchanged. Include v3_blocks in state for future v3-native
                                      // log-form rendering (step 8b).
                                      const isV3 = program?.program_version === 'v3';
                                      const v3Blocks = isV3 ? (v3BlocksByWorkout.get(w.id) ?? []) : null;
                                      const text = isV3
                                        ? v3BlocksToProse(v3Blocks ?? [])
                                        : w.workout_text;
                                      const reviewState = {
                                        workout_text: text,
                                        source_id: w.id,
                                        program_id: id,
                                        week_num: week.weekNum,
                                        day_num: w.day_num,
                                        ...(isV3 ? { v3_blocks: v3Blocks, program_version: 'v3' as const } : {}),
                                      };
                                      return (
                                        <>
                                          {/* v3 days get inline per-block coaching; only v1 keeps the
                                              standalone Coach page button. */}
                                          {!isV3 && (
                                            <button
                                              className="auth-btn"
                                              onClick={() => navigate('/workout-review', { state: reviewState })}
                                              style={{ padding: '8px 14px', fontSize: 13, background: 'var(--surface2)', color: done ? 'var(--text-dim)' : 'var(--text)' }}
                                            >
                                              Coach
                                            </button>
                                          )}
                                          {!done && (
                                            <button
                                              className="auth-btn"
                                              onClick={() => isV3
                                                ? navigate(`/day/${w.id}`)
                                                : navigate('/workout/start', { state: reviewState })}
                                              style={{ padding: '8px 14px', fontSize: 13 }}
                                            >
                                              {ip ? 'Resume' : 'Start'}
                                            </button>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                          ))}
                        </div>
                      );
                    });
                  })()}
                </div>
                {isGenerated && isAdmin && (
                  <div style={{ marginTop: 24, padding: '16px', background: 'var(--surface2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                        Month {program.generated_months || 1} of training (Admin)
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        {generatingNextMonth
                          ? 'Generating next month — evaluating profile and building workouts...'
                          : 'Generate the next month to continue your program.'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        className="auth-btn"
                        disabled={generatingNextMonth}
                        onClick={handleGenerateNextMonth}
                        style={{ whiteSpace: 'nowrap', opacity: generatingNextMonth ? 0.6 : 1 }}
                      >
                        {generatingNextMonth ? 'Generating...' : `Generate Month ${(program.generated_months || 1) + 1}`}
                      </button>
                      {program.program_version === 'v3' && (
                        <button
                          className="auth-btn"
                          disabled={generatingNextMonth}
                          onClick={handleGenerateNextMonthV3}
                          title="TEMP admin test: append next month via generate-program-v3 (continuation)"
                          style={{ whiteSpace: 'nowrap', opacity: generatingNextMonth ? 0.6 : 1, background: 'var(--surface)', border: '1px solid var(--accent)', color: 'var(--accent)' }}
                        >
                          {generatingNextMonth ? '…' : `v3 Month ${(program.generated_months || 1) + 1} (test)`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="program-detail-actions" style={{ marginTop: 24 }}>
                  <button className="auth-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate('/programs')}>
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// v3BlocksToProse — bridge helper that converts v3 structured
// blocks + movements into a v1-style prose representation for the
// existing /workout-review (Coach) and /workout/start (logging)
// pages. Lets v3 days use those flows immediately; future iteration
// (step 8b) builds a v3-native log form that pre-fills typed fields.
/**
 * Render the rep prescription for a v3 movement. If rep_scheme has more
 * than one varying iteration (chipper 21-15-9, ascending ladder), surface
 * the structure as "21-15-9 reps". Otherwise fall back to the conventional
 * sets×reps / total-reps form.
 */
function formatRepPrescription(m: ProgramMovementV2): string | null {
  // Calorie-counted (Cal Row / Cal Bike / Cal Ski) takes precedence — when
  // calories is populated the movement is monostructural cardio measured in
  // calories, not reps.
  if (m.calories != null && m.calories > 0) return `${m.calories} cal`;
  const arr = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  if (arr && arr.length > 1) {
    const allEqual = arr.every((n) => n === arr[0]);
    if (!allEqual) return `${arr.join('-')} reps`;
    // Uniform repeated rounds — sets×reps is clearer when sets is present
    // and matches the scheme length (e.g. 5×5 instead of 5-5-5-5-5).
    if (m.sets != null && m.sets === arr.length) return `${m.sets}×${arr[0]}`;
    return `${arr.length}×${arr[0]}`;
  }
  if (m.sets != null && m.reps != null) return `${m.sets}×${m.reps}`;
  if (m.sets != null) return `${m.sets} sets`;
  if (m.reps != null) return `${m.reps} reps`;
  return null;
}

export function v3BlocksToProse(blocks: ProgramBlockV2[]): string {
  if (!blocks.length) return '';
  const fmt = (m: ProgramMovementV2) => {
    const parts: string[] = [];
    // Distance-based movements (row/run/bike/etc.) use distance as the work
    // spec; reps is meaningless there. Writer sometimes emits both — prefer
    // distance and drop reps to avoid "Row 250 reps · 250m".
    const hasDistance = m.distance != null;
    if (!hasDistance) {
      const repStr = formatRepPrescription(m);
      if (repStr) parts.push(repStr);
    }
    if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? 'lbs'}`);
    if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
    if (m.time_seconds != null) parts.push(formatDuration(m.time_seconds));
    if (hasDistance) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
    const scheme = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
    const scaling = m.scaling_note ? ` (${m.scaling_note})` : '';
    return `${m.movement}${scheme}${scaling}`;
  };

  const sections: string[] = [];
  for (const b of blocks) {
    const labelHeader = BLOCK_DISPLAY[b.block_type] ?? b.block_type;
    const lines: string[] = [];
    const headerSuffix: string[] = [];
    if (b.block_label) headerSuffix.push(b.block_label);
    if (b.block_scheme) headerSuffix.push(b.block_scheme);
    // Skip the redundant cap when the scheme already states the duration (AMRAP/EMOM).
    if (b.time_cap_seconds && !/\b(amrap|emom)\b/i.test(b.block_scheme ?? '')) headerSuffix.push(`cap ${Math.round(b.time_cap_seconds / 60)} min`);
    lines.push(`${labelHeader}:${headerSuffix.length ? ' ' + headerSuffix.join(' — ') : ''}`);
    // block_notes is internal writer reasoning — not exported to the athlete.
    for (const m of b.movements) lines.push(`  ${fmt(m)}`);
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

// ============================================================
// V3DayView — production day-expand UI for v3 programs.
// Mobile-first block cards: block-type chip + block_label header,
// prominent block_scheme line, time-cap pill, per-movement rows
// with clean prescription typography (sets × reps · weight · RPE),
// scaling notes inline in dim text.
// ============================================================

interface AiEditHandlers {
  aiEditedBlockIds?: Set<string>;
  onProposeAiEdit?: (blockId: string, request: string) => Promise<{ proposal: BlockProposal; original: BlockProposal; ai_edit_log_id: string }>;
  onApplyAiProposal?: (blockId: string, proposal: BlockProposal, aiLogId: string) => Promise<void>;
  onRefuseAiProposal?: (blockId: string, aiLogId: string) => Promise<void>;
}

interface V3DayViewProps extends AiEditHandlers {
  blocks: ProgramBlockV2[];
  onUpdateMovement?: (movementId: string, patch: Partial<ProgramMovementV2>) => Promise<void>;
  onUpdateBlock?: (blockId: string, patch: Partial<ProgramBlockV2>) => Promise<void>;
  onAddMovement?: (blockId: string) => Promise<void>;
  onRemoveMovement?: (movementId: string) => Promise<void>;
  // Inline coaching ("Coach ▾" per block). The review is fetched once per day and
  // shared across blocks; sourceId = program_workout_id, workoutText = the prose.
  sourceId?: string;
  workoutText?: string;
  // When present (the day page), each block renders its type-specific log UI.
  logging?: DayLogController;
}

// Block types the workout review generates coaching for (skills/strength/metcon).
const COACHABLE_BLOCK_TYPES = ['skills', 'strength', 'metcon', 'accessory'];

// Block display labels — aligned with v1 prose conventions so the
// same labels work in the V3DayView UI chip + the v3BlocksToProse
// output. v1's workout-review parser keys off these substrings to
// generate per-block coaching cards, so "Metcon" and "Cool down"
// must match exactly (not "Conditioning" / "Cool-down").
const BLOCK_DISPLAY: Record<string, string> = {
  'warm-up': 'Warm-up',
  'mobility': 'Mobility',
  'skills': 'Skills',
  'strength': 'Strength',
  'accessory': 'Accessory',
  'metcon': 'Metcon',
  'cardio': 'Cardio',
  'active-recovery': 'Recovery',
  'cool-down': 'Cool down',
  'other': 'Other',
};

/** Render a duration human-friendly: 2400 → "40 min", 90 → "1:30", 30 → "30s". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → "Fri Jun 5" (parse as local, not UTC, to avoid date shift). */
function formatScheduleChip(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (mo ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** Next N days as { key: "YYYY-MM-DD", label } for the quick-pick list. */
function nextNDays(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = i === 0 ? 'Today'
      : i === 1 ? 'Tomorrow'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    out.push({ key, label });
  }
  return out;
}

/** Per-day calendar affordance: add button → quick-pick day list → date chip. */
function DayScheduleControl({ entry, takenDates, onPick, onClear }: {
  entry?: { id: string; scheduled_date: string };
  takenDates: Set<string>;
  onPick: (dateStr: string) => void;
  onClear: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nativePicking, setNativePicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen && !menuOpen) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setPickerOpen(false); setMenuOpen(false); }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pickerOpen, menuOpen]);

  const pick = (dateStr: string) => { onPick(dateStr); setPickerOpen(false); setNativePicking(false); };

  if (nativePicking) {
    return (
      <input
        type="date"
        className="day-schedule-date-input"
        autoFocus
        defaultValue={entry?.scheduled_date ?? ''}
        onChange={(e) => { if (e.target.value) pick(e.target.value); else setNativePicking(false); }}
        onBlur={() => setNativePicking(false)}
      />
    );
  }

  const days = nextNDays(14);

  return (
    <div className="day-schedule-wrap" ref={wrapRef}>
      {entry ? (
        <button type="button" className="day-schedule-chip" onClick={() => setMenuOpen(o => !o)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
          {formatScheduleChip(entry.scheduled_date)}
        </button>
      ) : (
        <button type="button" className="day-schedule-add" onClick={() => setPickerOpen(o => !o)} title="Add to calendar" aria-label="Add to calendar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" /></svg>
        </button>
      )}

      {menuOpen && entry && (
        <div className="day-schedule-menu">
          <button type="button" onClick={() => { setMenuOpen(false); setPickerOpen(true); }}>Reschedule</button>
          <button type="button" onClick={() => { setMenuOpen(false); onClear(); }}>Remove</button>
        </div>
      )}

      {pickerOpen && (
        <div className="day-schedule-quickpick">
          {days.map(d => {
            const taken = takenDates.has(d.key) && d.key !== entry?.scheduled_date;
            return (
              <button
                key={d.key}
                type="button"
                className="day-schedule-qp-item"
                disabled={taken}
                onClick={() => pick(d.key)}
              >
                <span>{d.label}</span>
                {taken && <span className="day-schedule-qp-taken">scheduled</span>}
              </button>
            );
          })}
          <button
            type="button"
            className="day-schedule-qp-item day-schedule-qp-more"
            onClick={() => { setPickerOpen(false); setNativePicking(true); }}
          >
            Pick another date…
          </button>
        </div>
      )}
    </div>
  );
}

export function V3DayView({ blocks, sourceId, workoutText, logging, onUpdateMovement, onUpdateBlock, onAddMovement, onRemoveMovement, ...ai }: V3DayViewProps) {
  // One review per day, lazily generated when any "Coach ▾" / intent / sources opens.
  const { review, loading, error, generate } = useWorkoutReview(sourceId ?? null, workoutText ?? '');
  const [intentOpen, setIntentOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const canCoach = !!sourceId && !!(workoutText && workoutText.trim());
  const sourceTitles = review?.sources ? [...new Set(review.sources.map(s => s.title).filter(Boolean))] : [];

  if (!blocks.length) {
    return (
      <div style={{ padding: 12, fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>
        No blocks for this day.
      </div>
    );
  }
  return (
    <div className="workout-blocks">
      {/* Session intent (day-level "why"), collapsed, near the top. */}
      {canCoach && (
        <div className="wr-sources-section">
          <button className="wr-sources-toggle" onClick={() => { const n = !intentOpen; setIntentOpen(n); if (n) generate(); }} aria-expanded={intentOpen}>
            <span className="wr-sources-label">Today's training intent</span>
            <span className={`workout-review-block-chevron${intentOpen ? ' workout-review-block-chevron--open' : ''}`}>{CHEVRON_DOWN}</span>
          </button>
          {intentOpen && (
            review?.intent
              ? <div className="wr-intent-card" style={{ marginTop: 8 }}><div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatReviewMarkdown(review.intent) }} /></div>
              : loading ? <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '8px 2px' }}>Loading coaching…</div>
              : error ? <div style={{ fontSize: 13, color: 'var(--accent)', padding: '8px 2px' }}>{error}</div>
              : null
          )}
        </div>
      )}

      {blocks.map((b) => (
        <V3BlockCard
          key={b.id}
          block={b}
          onUpdateMovement={onUpdateMovement}
          onUpdateBlock={onUpdateBlock}
          onAddMovement={onAddMovement}
          onRemoveMovement={onRemoveMovement}
          canCoach={canCoach}
          coaching={coachingForBlockType(review, b.block_type)}
          coachingLoading={loading}
          coachingError={error}
          onEnsureCoaching={generate}
          logging={logging}
          {...ai}
        />
      ))}

      {/* Sources, collapsed, at the bottom. */}
      {canCoach && (
        <div className="wr-sources-section">
          <button className="wr-sources-toggle" onClick={() => { const n = !sourcesOpen; setSourcesOpen(n); if (n) generate(); }} aria-expanded={sourcesOpen}>
            <span className="wr-sources-label">Sources{sourceTitles.length ? ` (${sourceTitles.length})` : ''}</span>
            <span className={`workout-review-block-chevron${sourcesOpen ? ' workout-review-block-chevron--open' : ''}`}>{CHEVRON_DOWN}</span>
          </button>
          {sourcesOpen && (
            sourceTitles.length
              ? <div className="wr-sources-list">{sourceTitles.map((t, j) => <span key={j} className="source-chip">{t}</span>)}</div>
              : loading ? <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '8px 2px' }}>Loading…</div>
              : null
          )}
        </div>
      )}
    </div>
  );
}

function V3BlockCard({ block, onUpdateMovement, onUpdateBlock, onAddMovement, onRemoveMovement, aiEditedBlockIds, onProposeAiEdit, onApplyAiProposal, onRefuseAiProposal, canCoach, coaching, coachingLoading, coachingError, onEnsureCoaching, logging }: AiEditHandlers & {
  block: ProgramBlockV2;
  onUpdateMovement?: (movementId: string, patch: Partial<ProgramMovementV2>) => Promise<void>;
  onUpdateBlock?: (blockId: string, patch: Partial<ProgramBlockV2>) => Promise<void>;
  onAddMovement?: (blockId: string) => Promise<void>;
  onRemoveMovement?: (movementId: string) => Promise<void>;
  canCoach?: boolean;
  coaching?: ReviewBlock | null;
  coachingLoading?: boolean;
  coachingError?: string | null;
  onEnsureCoaching?: () => void;
  logging?: DayLogController;
}) {
  const displayLabel = BLOCK_DISPLAY[block.block_type] ?? block.block_type;
  // AMRAP / EMOM bake the duration into the scheme ("AMRAP 12", "EMOM 8"), so a
  // separate "cap 12 min" pill is redundant — suppress it for those.
  const schemeBakesDuration = /\b(amrap|emom)\b/i.test(block.block_scheme ?? '');
  const timeCapMin = block.time_cap_seconds && !schemeBakesDuration ? Math.round(block.time_cap_seconds / 60) : null;

  // Reuse the existing .workout-block-label[data-block="…"] CSS for
  // per-block-type colors (warm-up amber, skills purple, strength pink,
  // metcon green, cool-down teal — see src/index.css).
  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  };
  const capPillStyle: React.CSSProperties = {
    display: 'inline-block',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'var(--surface2)',
    color: 'var(--text-dim)',
    marginLeft: 'auto',
  };
  const schemeStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text)',
    lineHeight: 1.45,
    marginTop: 6,
    marginBottom: 4,
  };

  const [editing, setEditing] = useState(false);
  const canEdit = !!onUpdateMovement;

  // Block-level scheme ("Every 90s for 12 min (8 sets)"), editable in edit mode.
  const [scheme, setScheme] = useState(block.block_scheme ?? '');
  const commitScheme = async () => {
    if (!onUpdateBlock) return;
    const trimmed = scheme.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === (block.block_scheme ?? null)) return;
    try { await onUpdateBlock(block.id, { block_scheme: next }); }
    catch { setScheme(block.block_scheme ?? ''); }
  };
  // AI Edit is overkill for warm-up / cool-down — manual edit covers those.
  const aiEditAllowedType = block.block_type !== 'warm-up' && block.block_type !== 'cool-down';
  const canAiEdit = !!onProposeAiEdit && !!onApplyAiProposal && !!onRefuseAiProposal && aiEditAllowedType;
  const locked = aiEditedBlockIds?.has(block.id) ?? false;
  // Inline coaching disclosure (skills/strength/metcon). Collapsed by default;
  // opening it lazily generates the day's review.
  const showCoach = !!canCoach && COACHABLE_BLOCK_TYPES.includes(block.block_type);
  // Logged blocks dim to read as "done". The Log/Edit footer stays full-bright
  // (rendered outside the dimmed wrapper). Editing un-dims so fields are clear.
  const isLogged = !!logging && !editing && logging.isSaved(block.sort_order);
  const [coachOpen, setCoachOpen] = useState(false);
  const toggleCoach = () => { const n = !coachOpen; setCoachOpen(n); if (n) onEnsureCoaching?.(); };

  // AI Edit state machine (one-shot per block).
  const [aiState, setAiState] = useState<'idle' | 'input' | 'loading' | 'review'>('idle');
  const [aiRequest, setAiRequest] = useState('');
  const [aiProposal, setAiProposal] = useState<BlockProposal | null>(null);
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const runPropose = async () => {
    if (!aiRequest.trim() || !onProposeAiEdit) return;
    setAiState('loading');
    setAiError(null);
    try {
      const { proposal, ai_edit_log_id } = await onProposeAiEdit(block.id, aiRequest.trim());
      setAiProposal(proposal);
      setAiLogId(ai_edit_log_id);
      setAiState('review');
    } catch (err) {
      setAiError((err as Error).message || 'AI Edit failed');
      setAiState('input');
    }
  };

  const acceptProposal = async () => {
    if (!aiProposal || !aiLogId || !onApplyAiProposal) return;
    setAiState('loading');
    try {
      await onApplyAiProposal(block.id, aiProposal, aiLogId);
      setAiState('idle');
    } catch (err) {
      setAiError((err as Error).message || 'Failed to apply');
      setAiState('review');
    }
  };

  const refuseProposal = async () => {
    if (!aiLogId || !onRefuseAiProposal) return;
    try { await onRefuseAiProposal(block.id, aiLogId); } catch { /* lock applies regardless */ }
    setAiState('idle');
    setAiProposal(null);
  };

  return (
    <div className="workout-block" data-block={block.block_type}>
      <div style={isLogged ? { opacity: 0.5, transition: 'opacity 0.15s' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="workout-block-label" data-block={block.block_type}>{displayLabel}</span>
        {block.block_label && <span style={labelStyle}>{block.block_label}</span>}
        {timeCapMin != null && <span style={capPillStyle}>cap {timeCapMin} min</span>}
        {(canEdit || canAiEdit) && (
          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
            {canEdit && (
              <button
                type="button"
                className="block-edit-toggle"
                onClick={() => setEditing(e => !e)}
                aria-label={editing ? 'Done editing block' : 'Edit block'}
              >
                {editing ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    Done
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    Edit
                  </>
                )}
              </button>
            )}
            {canAiEdit && !editing && (
              locked ? (
                <span className="block-ai-edited-tag" title="AI Edit has been used on this block">AI edited</span>
              ) : (
                <button
                  type="button"
                  className="block-ai-edit-toggle"
                  onClick={() => { setAiState(s => s === 'idle' ? 'input' : 'idle'); setAiError(null); }}
                  disabled={aiState === 'loading'}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z" /></svg>
                  AI Edit
                </button>
              )
            )}
            {showCoach && (
              <button
                type="button"
                className={`block-ai-edit-toggle${coachOpen ? ' block-coach-toggle--open' : ''}`}
                onClick={toggleCoach}
                aria-expanded={coachOpen}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                Coach
              </button>
            )}
          </span>
        )}
      </div>
      {editing && onUpdateBlock ? (
        <input
          type="text"
          className="movement-edit-input"
          style={{ ...schemeStyle, width: '100%' }}
          value={scheme}
          onChange={e => setScheme(e.target.value)}
          onBlur={commitScheme}
          placeholder="Scheme (e.g. Every 90s for 12 min (8 sets))"
          aria-label="Block scheme"
        />
      ) : (
        block.block_scheme && <div style={schemeStyle}>{block.block_scheme}</div>
      )}
      {/* block_notes is the writer's internal reasoning (load math, percentile/
          ratio justification) — kept in the DB for admin/eval, not shown to the
          athlete. Execution cues live in each movement's scaling_note. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {block.movements.map((m) => (
          editing
            ? <V3MovementEditRow key={m.id} movement={m} onUpdate={onUpdateMovement!} onRemove={onRemoveMovement} />
            : <V3MovementRow key={m.id} movement={m} />
        ))}
        {editing && onAddMovement && (
          <button type="button" className="movement-add-btn" onClick={() => onAddMovement(block.id)}>
            + Add movement
          </button>
        )}
      </div>
      </div>

      {logging && !editing && <BlockLog block={block} controller={logging} coaching={coaching ?? null} onEnsureCoaching={onEnsureCoaching} />}

      {canAiEdit && !locked && aiState !== 'idle' && (
        <V3AiEditPanel
          state={aiState}
          request={aiRequest}
          setRequest={setAiRequest}
          proposal={aiProposal}
          error={aiError}
          onSubmit={runPropose}
          onAccept={acceptProposal}
          onRefuse={refuseProposal}
          onCancel={() => { setAiState('idle'); setAiError(null); setAiRequest(''); }}
        />
      )}

      {showCoach && coachOpen && (
        <div className="block-coach-body" style={{ marginTop: 10 }}>
          {coaching ? (
            <BlockCoachingBody block={coaching} hidePrescription />
          ) : coachingLoading ? (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '4px 2px' }}>Loading coaching…</div>
          ) : coachingError ? (
            <div style={{ fontSize: 13, color: 'var(--accent)', padding: '4px 2px' }}>{coachingError}</div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '4px 2px' }}>No coaching for this block.</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Render a movement (live row or proposal) as a single readable line. */
function movementToLine(m: BlockProposalMovement): string {
  const parts: string[] = [];
  const hasDistance = m.distance != null;
  if (!hasDistance) {
    const r = formatRepPrescription({
      calories: m.calories ?? null, rep_scheme: m.rep_scheme ?? null,
      sets: m.sets ?? null, reps: m.reps ?? null,
    } as ProgramMovementV2);
    if (r) parts.push(r);
  }
  if (m.weight != null) {
    const pct = m.target_pct_1rm != null ? ` (${Math.round(m.target_pct_1rm)}%)` : '';
    parts.push(`${m.weight}${m.weight_unit ?? 'lbs'}${pct}`);
  }
  if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
  if (m.time_seconds != null) parts.push(formatDuration(m.time_seconds));
  if (hasDistance) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
  const presc = parts.join(' · ');
  const scaling = m.scaling_note ? ` — ${m.scaling_note}` : '';
  return `${m.movement}${presc ? `  ${presc}` : ''}${scaling}`;
}

function V3AiEditPanel({ state, request, setRequest, proposal, error, onSubmit, onAccept, onRefuse, onCancel }: {
  state: 'input' | 'loading' | 'review';
  request: string;
  setRequest: (v: string) => void;
  proposal: BlockProposal | null;
  error: string | null;
  onSubmit: () => void;
  onAccept: () => void;
  onRefuse: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="ai-block-edit-panel">
      {state !== 'review' && (
        <div className="ai-block-edit-input-row">
          <input
            type="text"
            className="ai-block-edit-input"
            value={request}
            onChange={e => setRequest(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && request.trim() && state !== 'loading') onSubmit(); }}
            placeholder="What do you need to change? e.g. lighter, no barbell, add a third round"
            disabled={state === 'loading'}
            autoFocus
          />
          <button type="button" className="ai-block-edit-go" onClick={onSubmit} disabled={state === 'loading' || !request.trim()}>
            {state === 'loading' ? 'Thinking…' : 'Ask AI'}
          </button>
          <button type="button" className="ai-block-edit-cancel" onClick={onCancel} disabled={state === 'loading'}>Cancel</button>
        </div>
      )}
      {error && <div className="ai-block-edit-error">{error}</div>}
      {state === 'review' && proposal && (
        <div className="ai-block-edit-review">
          <div className="ai-block-edit-note">One AI Edit per block — accept or refuse. For more, use Coach.</div>
          <div className="ai-block-edit-proposal">
            {(proposal.block_scheme) && <div className="ai-block-edit-scheme">{proposal.block_scheme}</div>}
            {proposal.movements.map((m, i) => (
              <div key={i} className="ai-block-edit-mvline">{movementToLine(m)}</div>
            ))}
          </div>
          <div className="ai-block-edit-actions">
            <button type="button" className="ai-block-edit-accept" onClick={onAccept}>Accept</button>
            <button type="button" className="ai-block-edit-refuse" onClick={onRefuse}>Refuse</button>
          </div>
        </div>
      )}
    </div>
  );
}

function V3MovementRow({ movement }: { movement: ProgramMovementV2 }) {
  const parts: string[] = [];
  // Distance-based movements (row/run/bike/etc.) use distance as the work
  // spec; reps is meaningless there. Writer sometimes emits both — prefer
  // distance and drop reps to avoid "Row 250 reps · 250m".
  const hasDistance = movement.distance != null;
  if (!hasDistance) {
    const repStr = formatRepPrescription(movement);
    if (repStr) parts.push(repStr);
  }
  if (movement.weight != null) {
    const pct = movement.target_pct_1rm != null ? ` (${Math.round(movement.target_pct_1rm)}%)` : '';
    parts.push(`${movement.weight}${movement.weight_unit ?? 'lbs'}${pct}`);
  }
  if (movement.rpe != null) parts.push(`RPE ${movement.rpe}`);
  if (movement.time_seconds != null) parts.push(formatDuration(movement.time_seconds));
  if (hasDistance) parts.push(`${movement.distance}${movement.distance_unit ?? ''}`);
  const prescription = parts.join(' · ');

  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8,
      padding: '4px 0',
      borderBottom: '1px dashed var(--border)',
    }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', flex: '0 0 auto' }}>
        {movement.movement}
      </span>
      {prescription && (
        <span style={{
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: 'var(--text)',
          marginLeft: 'auto',
        }}>
          {prescription}
        </span>
      )}
      {movement.scaling_note && (
        <span style={{
          flex: '0 0 100%',
          fontSize: 12,
          color: 'var(--text-dim)',
          fontStyle: 'italic',
          marginTop: 2,
        }}>
          {movement.scaling_note}
        </span>
      )}
    </div>
  );
}

/**
 * Compact 1-3 line edit row shown when a block is in edit mode.
 * Per scope: only movement name, weight + unit, and scaling note are editable.
 * Other prescription fields (sets/reps/RPE/%/time/distance/calories) stay
 * read-only — those define the coaching stimulus and require regen / AI Edit.
 */
function repsToText(m: ProgramMovementV2): string {
  if (Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0) return m.rep_scheme.join('-');
  return m.reps != null ? String(m.reps) : '';
}

function V3MovementEditRow({ movement, onUpdate, onRemove }: {
  movement: ProgramMovementV2;
  onUpdate: (movementId: string, patch: Partial<ProgramMovementV2>) => Promise<void>;
  onRemove?: (movementId: string) => Promise<void>;
}) {
  const [name, setName] = useState(movement.movement);
  const [sets, setSets] = useState<string>(movement.sets != null ? String(movement.sets) : '');
  const [reps, setReps] = useState<string>(repsToText(movement));
  const [weight, setWeight] = useState<string>(movement.weight != null ? String(movement.weight) : '');
  const [unit, setUnit] = useState<'lbs' | 'kg'>((movement.weight_unit as 'lbs' | 'kg') ?? 'lbs');
  const [scaling, setScaling] = useState(movement.scaling_note ?? '');
  // Cardio metcon movements measure work as distance or calories, not reps.
  // Surface the right field so editing PRESERVES the measure instead of
  // silently switching a "Row 500m" / "16 cal" into reps.
  const [distance, setDistance] = useState<string>(movement.distance != null ? String(movement.distance) : '');
  const [distanceUnit, setDistanceUnit] = useState<string>(movement.distance_unit ?? 'm');
  const [calories, setCalories] = useState<string>(movement.calories != null ? String(movement.calories) : '');
  // Which work measure the row edits. Derived initially from the movement, but
  // the athlete can switch it deliberately via the measure selector.
  const [measure, setMeasure] = useState<'reps' | 'distance' | 'calories'>(
    movement.distance != null ? 'distance' : movement.calories != null ? 'calories' : 'reps',
  );

  // Typeahead: suggest canonical movement names (matches display_name + aliases,
  // so "T2B" → "Toes To Bar"). Suggests, never forces — a no-match name is kept.
  const vocab = useMovementVocab();
  const [nameFocused, setNameFocused] = useState(false);
  const suggestions = useMemo(() => {
    if (!nameFocused) return [];
    const trimmed = name.trim();
    if (!trimmed) return [];
    return matchMovements(vocab, trimmed, 8).filter(dn => dn.toLowerCase() !== trimmed.toLowerCase());
  }, [vocab, name, nameFocused]);

  const commitName = async () => {
    const next = name.trim();
    if (!next || next === movement.movement) return;
    try { await onUpdate(movement.id, { movement: next }); }
    catch { setName(movement.movement); }
  };

  // Pick a canonical name from the typeahead. onMouseDown (not onClick) fires
  // before the input's blur, so the partial text is never committed first.
  const selectSuggestion = async (dn: string) => {
    setName(dn);
    setNameFocused(false);
    if (dn === movement.movement) return;
    try { await onUpdate(movement.id, { movement: dn }); }
    catch { setName(movement.movement); }
  };

  const commitSets = async () => {
    const trimmed = sets.trim();
    const next = trimmed === '' ? null : Math.round(Number(trimmed));
    if (next != null && (!Number.isFinite(next) || next < 0)) { setSets(movement.sets != null ? String(movement.sets) : ''); return; }
    if (next === (movement.sets ?? null)) return;
    try { await onUpdate(movement.id, { sets: next }); }
    catch { setSets(movement.sets != null ? String(movement.sets) : ''); }
  };

  // Reps doubles as the rep-scheme field: a single number → plain reps (scheme
  // cleared); multiple numbers ("21-15-9") → rep_scheme with reps = sum.
  const commitReps = async () => {
    const parts = reps.split(/[^0-9]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n > 0);
    const patch = parts.length === 0 ? reconcileReps(null, null)
      : parts.length === 1 ? reconcileReps(parts[0], null)
      : reconcileReps(null, parts);
    const cur = reconcileReps(movement.reps, movement.rep_scheme);
    if (patch.reps === cur.reps && JSON.stringify(patch.rep_scheme) === JSON.stringify(cur.rep_scheme)) return;
    try { await onUpdate(movement.id, { reps: patch.reps, rep_scheme: patch.rep_scheme }); }
    catch { setReps(repsToText(movement)); }
  };

  const commitWeight = async () => {
    const trimmed = weight.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next != null && Number.isNaN(next)) { setWeight(movement.weight != null ? String(movement.weight) : ''); return; }
    if (next === (movement.weight ?? null)) return;
    try { await onUpdate(movement.id, { weight: next }); }
    catch { setWeight(movement.weight != null ? String(movement.weight) : ''); }
  };

  const commitUnit = async (nextUnit: 'lbs' | 'kg') => {
    setUnit(nextUnit);
    if (nextUnit === (movement.weight_unit ?? 'lbs')) return;
    try { await onUpdate(movement.id, { weight_unit: nextUnit }); }
    catch { setUnit((movement.weight_unit as 'lbs' | 'kg') ?? 'lbs'); }
  };

  const commitScaling = async () => {
    const trimmed = scaling.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === (movement.scaling_note ?? null)) return;
    try { await onUpdate(movement.id, { scaling_note: next }); }
    catch { setScaling(movement.scaling_note ?? ''); }
  };

  const commitDistance = async () => {
    const trimmed = distance.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next != null && (!Number.isFinite(next) || next < 0)) { setDistance(movement.distance != null ? String(movement.distance) : ''); return; }
    if (next === (movement.distance ?? null)) return;
    try { await onUpdate(movement.id, { distance: next }); }
    catch { setDistance(movement.distance != null ? String(movement.distance) : ''); }
  };

  const commitDistanceUnit = async (nextUnit: string) => {
    setDistanceUnit(nextUnit);
    if (nextUnit === (movement.distance_unit ?? 'm')) return;
    try { await onUpdate(movement.id, { distance_unit: nextUnit }); }
    catch { setDistanceUnit(movement.distance_unit ?? 'm'); }
  };

  const commitCalories = async () => {
    const trimmed = calories.trim();
    const next = trimmed === '' ? null : Math.round(Number(trimmed));
    if (next != null && (!Number.isFinite(next) || next < 0)) { setCalories(movement.calories != null ? String(movement.calories) : ''); return; }
    if (next === (movement.calories ?? null)) return;
    try { await onUpdate(movement.id, { calories: next }); }
    catch { setCalories(movement.calories != null ? String(movement.calories) : ''); }
  };

  // Deliberately switch the work measure. Clears the other measures so the
  // movement always carries exactly one; the new field starts empty to fill in.
  const commitMeasure = async (next: 'reps' | 'distance' | 'calories') => {
    if (next === measure) return;
    const prev = measure;
    setMeasure(next);
    const patch: Partial<ProgramMovementV2> = {};
    if (next !== 'reps') { patch.reps = null; patch.rep_scheme = null; setReps(''); }
    if (next !== 'distance') { patch.distance = null; patch.distance_unit = null; setDistance(''); }
    if (next !== 'calories') { patch.calories = null; setCalories(''); }
    if (next === 'distance') patch.distance_unit = movement.distance_unit ?? distanceUnit ?? 'm';
    try { await onUpdate(movement.id, patch); }
    catch { setMeasure(prev); }
  };

  return (
    <div className="movement-edit-row">
      <div className="movement-edit-name-wrap">
        <input
          type="text"
          className="movement-edit-input movement-edit-input--name"
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={() => setNameFocused(true)}
          onBlur={() => { setNameFocused(false); commitName(); }}
          placeholder="Movement"
          autoComplete="off"
        />
        {suggestions.length > 0 && (
          <div className="movement-suggest">
            {suggestions.map(dn => (
              <button
                key={dn}
                type="button"
                className="movement-suggest-item"
                onMouseDown={e => { e.preventDefault(); selectSuggestion(dn); }}
              >
                {dn}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        type="number"
        inputMode="numeric"
        className="movement-edit-input movement-edit-input--num"
        value={sets}
        onChange={e => setSets(e.target.value)}
        onBlur={commitSets}
        placeholder="Sets"
        aria-label="Sets"
      />
      <select
        className="movement-edit-input"
        value={measure}
        onChange={e => commitMeasure(e.target.value as 'reps' | 'distance' | 'calories')}
        aria-label="Work measure"
        title="How this movement is measured"
      >
        <option value="reps">Reps</option>
        <option value="distance">Dist</option>
        <option value="calories">Cal</option>
      </select>
      {measure === 'distance' ? (
        <div className="movement-edit-weight">
          <input
            type="number"
            inputMode="decimal"
            className="movement-edit-input movement-edit-input--num"
            value={distance}
            onChange={e => setDistance(e.target.value)}
            onBlur={commitDistance}
            placeholder="Dist"
            aria-label="Distance"
          />
          <select
            className="movement-edit-input movement-edit-input--unit"
            value={distanceUnit}
            onChange={e => commitDistanceUnit(e.target.value)}
            aria-label="Distance unit"
          >
            <option value="m">m</option>
            <option value="ft">ft</option>
          </select>
        </div>
      ) : measure === 'calories' ? (
        <input
          type="number"
          inputMode="numeric"
          className="movement-edit-input movement-edit-input--reps"
          value={calories}
          onChange={e => setCalories(e.target.value)}
          onBlur={commitCalories}
          placeholder="Cal"
          aria-label="Calories"
        />
      ) : (
        <input
          type="text"
          inputMode="numeric"
          className="movement-edit-input movement-edit-input--reps"
          value={reps}
          onChange={e => setReps(e.target.value)}
          onBlur={commitReps}
          placeholder="Reps"
          aria-label="Reps or scheme (e.g. 21-15-9)"
        />
      )}
      <div className="movement-edit-weight">
        <input
          type="number"
          inputMode="decimal"
          className="movement-edit-input movement-edit-input--weight"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          onBlur={commitWeight}
          placeholder="Wt"
        />
        <select
          className="movement-edit-input movement-edit-input--unit"
          value={unit}
          onChange={e => commitUnit(e.target.value as 'lbs' | 'kg')}
        >
          <option value="lbs">lbs</option>
          <option value="kg">kg</option>
        </select>
      </div>
      {onRemove && (
        <button
          type="button"
          className="movement-edit-remove"
          onClick={() => onRemove(movement.id)}
          aria-label="Remove movement"
          title="Remove movement"
        >
          ×
        </button>
      )}
      <input
        type="text"
        className="movement-edit-input movement-edit-input--scaling"
        value={scaling}
        onChange={e => setScaling(e.target.value)}
        onBlur={commitScaling}
        placeholder="Scaling note (optional)"
      />
    </div>
  );
}
