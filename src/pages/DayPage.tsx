import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, ADJUST_WORKOUT_ENDPOINT, getAuthHeaders } from '../lib/supabase';
import { localDateString } from '../lib/localDate';
import Nav from '../components/Nav';
import {
  V3DayView, v3BlocksToProse, reconcileReps,
  type ProgramBlockV2, type ProgramMovementV2, type BlockProposal,
} from './ProgramDetailPage';
import type { DayLogController, SaveBlockPayload } from '../components/blockLog';

// DayPage — the single surface for an AI-programming training day. Renders the
// real V3DayView (colored cards + per-block Edit / AI Edit / Coach ▾ + Session
// intent + Sources) with this page's own data + handlers. Logging lands on these
// cards next. Engine days are separate (their own timer route).
const MOVEMENT_SELECT = 'id, block_id, movement, sets, reps, rep_scheme, calories, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, sort_order';

export default function DayPage(_props: { session: Session }) {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<ProgramBlockV2[]>([]);
  const [aiEditedBlockIds, setAiEditedBlockIds] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<{ week_num: number; day_num: number; program_id: string; program_name: string } | null>(null);

  useEffect(() => {
    if (!workoutId) return;
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: wkRow }, { data: blockRows }] = await Promise.all([
        supabase
          .from('program_workouts')
          .select('week_num, day_num, program_id, programs:programs!inner(name)')
          .eq('id', workoutId)
          .maybeSingle(),
        supabase
          .from('program_blocks_v2')
          .select('id, program_workout_id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, sort_order, expected_benchmark')
          .eq('program_workout_id', workoutId)
          .order('sort_order'),
      ]);
      if (!active) return;
      if (wkRow) {
        const d = wkRow as unknown as { week_num: number; day_num: number; program_id: string; programs?: { name?: string } };
        setMeta({ week_num: d.week_num, day_num: d.day_num, program_id: d.program_id, program_name: d.programs?.name ?? 'Program' });
      }
      const blks = ((blockRows as (ProgramBlockV2 & { program_workout_id: string })[] | null) ?? []).map(b => ({ ...b, movements: [] as ProgramMovementV2[] }));
      if (blks.length) {
        const blockIds = blks.map(b => b.id);
        const [{ data: movRows }, { data: aiLogs }] = await Promise.all([
          supabase.from('program_movements_v2').select(MOVEMENT_SELECT).in('block_id', blockIds).order('sort_order'),
          supabase.from('ai_edit_log').select('block_id').in('block_id', blockIds),
        ]);
        const byBlock = new Map<string, ProgramMovementV2[]>();
        for (const m of (movRows as (ProgramMovementV2 & { block_id: string })[] | null) ?? []) {
          const arr = byBlock.get(m.block_id) ?? []; arr.push(m); byBlock.set(m.block_id, arr);
        }
        for (const b of blks) b.movements = byBlock.get(b.id) ?? [];
        if (active) setAiEditedBlockIds(new Set(((aiLogs as { block_id: string }[]) ?? []).map(l => l.block_id)));
      }
      if (!active) return;
      setBlocks(blks);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [workoutId]);

  const workoutText = useMemo(() => v3BlocksToProse(blocks), [blocks]);

  // ── Logging controller (per-block-type log UI on the cards) ──
  const workoutDate = localDateString();
  const [userUnits, setUserUnits] = useState<'lbs' | 'kg'>('lbs');
  const [logId, setLogId] = useState<string | null>(null);
  const [savedSorts, setSavedSorts] = useState<Set<number>>(new Set());
  const [savingSort, setSavingSort] = useState<number | null>(null);

  // Resume any in-progress log for this workout + the user's unit preference.
  useEffect(() => {
    if (!workoutId) return;
    let active = true;
    (async () => {
      const [{ data: ipLog }, { data: prof }] = await Promise.all([
        supabase.from('workout_logs').select('id').eq('source_id', workoutId).eq('status', 'in_progress').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('athlete_profiles').select('units').eq('user_id', _props.session.user.id).maybeSingle(),
      ]);
      if (!active) return;
      if (prof?.units === 'kg') setUserUnits('kg');
      if (ipLog?.id) {
        setLogId(ipLog.id);
        const { data: savedBlocks } = await supabase.from('workout_log_blocks').select('sort_order').eq('log_id', ipLog.id);
        if (active && savedBlocks) setSavedSorts(new Set((savedBlocks as { sort_order: number }[]).map(b => b.sort_order)));
      }
    })();
    return () => { active = false; };
  }, [workoutId]);

  const saveBlock = useCallback(async (block: SaveBlockPayload) => {
    setSavingSort(block.sort_order);
    try {
      const { data, error } = await supabase.functions.invoke('save-workout-block', {
        body: { log_id: logId, source_id: workoutId, workout_date: workoutDate, workout_text: workoutText, workout_type: 'other', block },
      });
      if (error || data?.error) return null;
      if (data?.log_id && !logId) setLogId(data.log_id);
      setSavedSorts(prev => new Set(prev).add(block.sort_order));
      return { auto_completed: data?.auto_completed };
    } finally {
      setSavingSort(null);
    }
  }, [logId, workoutId, workoutDate, workoutText]);

  const logController = useMemo<DayLogController>(() => ({
    workoutDate, userUnits,
    isSaved: (s) => savedSorts.has(s),
    saving: savingSort,
    saveBlock,
    reopen: (s) => setSavedSorts(prev => { const n = new Set(prev); n.delete(s); return n; }),
  }), [workoutDate, userUnits, savedSorts, savingSort, saveBlock]);

  // ── Edit + AI Edit handlers (operate on this page's flat blocks state) ──
  const updateMovementField = async (movementId: string, patch: Partial<ProgramMovementV2>) => {
    let previous: ProgramMovementV2 | undefined;
    setBlocks(prev => prev.map(b => {
      const idx = b.movements.findIndex(m => m.id === movementId);
      if (idx < 0) return b;
      previous = b.movements[idx];
      return { ...b, movements: b.movements.map((m, i) => i === idx ? { ...m, ...patch } : m) };
    }));
    const { error } = await supabase.from('program_movements_v2').update(patch).eq('id', movementId);
    if (error && previous) {
      const restore = previous;
      setBlocks(prev => prev.map(b => ({ ...b, movements: b.movements.map(m => m.id === movementId ? restore : m) })));
      throw error;
    }
  };

  const updateBlockField = async (blockId: string, patch: Partial<ProgramBlockV2>) => {
    let previous: ProgramBlockV2 | undefined;
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      previous = b;
      return { ...b, ...patch };
    }));
    const { error } = await supabase.from('program_blocks_v2').update(patch).eq('id', blockId);
    if (error && previous) {
      const restore = previous;
      setBlocks(prev => prev.map(b => b.id === blockId ? restore : b));
      throw error;
    }
  };

  const addMovementToBlock = async (blockId: string) => {
    const blk = blocks.find(b => b.id === blockId);
    const maxSort = blk ? blk.movements.reduce((mx, m) => Math.max(mx, m.sort_order), -1) : -1;
    const { data, error } = await supabase
      .from('program_movements_v2')
      .insert({ block_id: blockId, movement: 'New movement', sort_order: maxSort + 1 })
      .select(MOVEMENT_SELECT)
      .single();
    if (error || !data) return;
    const nm = data as ProgramMovementV2;
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, movements: [...b.movements, nm] } : b));
  };

  const removeMovementFromBlock = async (movementId: string) => {
    const { error } = await supabase.from('program_movements_v2').delete().eq('id', movementId);
    if (error) return;
    setBlocks(prev => prev.map(b => ({ ...b, movements: b.movements.filter(m => m.id !== movementId) })));
  };

  const proposeAiEdit = async (blockId: string, request: string) => {
    const resp = await fetch(ADJUST_WORKOUT_ENDPOINT, {
      method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ block_id: blockId, request }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || `AI Edit failed (${resp.status})`);
    return data as { proposal: BlockProposal; original: BlockProposal; ai_edit_log_id: string };
  };

  const applyAiProposal = async (blockId: string, proposal: BlockProposal, aiLogId: string) => {
    const { error: bErr } = await supabase.from('program_blocks_v2').update({
      block_type: proposal.block_type, block_label: proposal.block_label ?? null,
      block_scheme: proposal.block_scheme ?? null, time_cap_seconds: proposal.time_cap_seconds ?? null,
      block_notes: proposal.block_notes ?? null, cardio_modality: proposal.cardio_modality ?? null,
    }).eq('id', blockId);
    if (bErr) throw bErr;
    await supabase.from('program_movements_v2').delete().eq('block_id', blockId);
    const inserts = proposal.movements.map((m, i) => {
      const { reps, rep_scheme } = reconcileReps(m.reps, m.rep_scheme);
      return {
        block_id: blockId, movement: m.movement, sets: m.sets ?? null, reps, rep_scheme,
        weight: m.weight ?? null, weight_unit: m.weight_unit ?? null, rpe: m.rpe ?? null,
        time_seconds: m.time_seconds ?? null, distance: m.distance ?? null, distance_unit: m.distance_unit ?? null,
        calories: m.calories ?? null, cardio_modality: m.cardio_modality ?? null,
        scaling_note: m.scaling_note ?? null, target_pct_1rm: m.target_pct_1rm ?? null, sort_order: i,
      };
    });
    let insertedRows: ProgramMovementV2[] = [];
    if (inserts.length) {
      const { data, error: insErr } = await supabase.from('program_movements_v2').insert(inserts).select(MOVEMENT_SELECT);
      if (insErr) throw insErr;
      insertedRows = (data ?? []) as ProgramMovementV2[];
    }
    await supabase.from('ai_edit_log').update({ outcome: 'accepted', resolved_at: new Date().toISOString() }).eq('id', aiLogId);
    setBlocks(prev => prev.map(b => b.id === blockId ? {
      ...b, block_type: proposal.block_type, block_label: proposal.block_label ?? null,
      block_scheme: proposal.block_scheme ?? null, time_cap_seconds: proposal.time_cap_seconds ?? null,
      block_notes: proposal.block_notes ?? null, movements: insertedRows,
    } : b));
    setAiEditedBlockIds(prev => new Set(prev).add(blockId));
  };

  const refuseAiProposal = async (blockId: string, aiLogId: string) => {
    await supabase.from('ai_edit_log').update({ outcome: 'refused', resolved_at: new Date().toISOString() }).eq('id', aiLogId);
    setAiEditedBlockIds(prev => new Set(prev).add(blockId));
  };

  if (!workoutId) { navigate('/training-log', { replace: true }); return null; }

  const title = meta ? `${meta.program_name} · Wk ${meta.week_num} Day ${meta.day_num}` : 'Training Day';

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1 style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 0' }}>
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : blocks.length === 0 ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 32 }}>
                <p style={{ color: 'var(--text-dim)' }}>No blocks for this day.</p>
                <button className="auth-btn" onClick={() => meta ? navigate(`/programs/${meta.program_id}`) : navigate(-1)} style={{ marginTop: 16 }}>Back</button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => meta ? navigate(`/programs/${meta.program_id}`) : navigate('/training-log')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '4px 0', marginBottom: 12, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                  Back to program
                </button>
                <V3DayView
                  blocks={blocks}
                  sourceId={workoutId}
                  workoutText={workoutText}
                  logging={logController}
                  onUpdateMovement={updateMovementField}
                  onUpdateBlock={updateBlockField}
                  onAddMovement={addMovementToBlock}
                  onRemoveMovement={removeMovementFromBlock}
                  aiEditedBlockIds={aiEditedBlockIds}
                  onProposeAiEdit={proposeAiEdit}
                  onApplyAiProposal={applyAiProposal}
                  onRefuseAiProposal={refuseAiProposal}
                />

                {/* Done — the day auto-completes as each block is saved; this
                    just leaves. (Log a block via its own Save on the card.) */}
                <button
                  className="auth-btn"
                  style={{ width: '100%', marginTop: 20, background: 'var(--surface2)', color: 'var(--text)' }}
                  onClick={() => meta ? navigate(`/programs/${meta.program_id}`) : navigate('/training-log')}
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
