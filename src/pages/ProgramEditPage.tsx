import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, getAuthHeaders, ADJUST_WORKOUT_ENDPOINT } from '../lib/supabase';
import Nav from '../components/Nav';

const BLOCK_LABELS = ['Warm-up', 'Skills', 'Strength', 'Metcon', 'Cool down'] as const;
type BlockLabel = typeof BLOCK_LABELS[number];

interface WorkoutBlock {
  label: BlockLabel;
  content: string;
}

interface EditableWorkout {
  blocks: WorkoutBlock[];
  rawText: string | null;      // non-null only for unparseable legacy workouts
  sort_order: number;
  expanded: boolean;
  dbId: string | null;         // existing program_workouts row ID, null for newly added days
  originalText: string | null; // snapshot at load time for diffing on save, null for new days
}

/* ── Parsing helpers ─────────────────────────────────────────── */

function parseWorkoutBlocks(text: string): WorkoutBlock[] | null {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const blocks: WorkoutBlock[] = [];
  const labelsToFind = BLOCK_LABELS.map(l => ({ label: l, needle: (l + ':').toLowerCase() }));

  for (let i = 0; i < labelsToFind.length; i++) {
    const { label, needle } = labelsToFind[i];
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    const next = labelsToFind.slice(i + 1).find(x => lower.indexOf(x.needle, contentStart) >= 0);
    const end = next ? lower.indexOf(next.needle, contentStart) : text.length;
    const content = text.slice(contentStart, end).trim();
    blocks.push({ label, content });
  }
  if (blocks.length === 0) return null;
  return blocks;
}

function blocksToText(blocks: WorkoutBlock[]): string {
  return blocks
    .filter(b => b.content.trim())
    .map(b => `${b.label}: ${b.content.trim()}`)
    .join(' ');
}

function blockSummary(blocks: WorkoutBlock[]): string {
  const skip = new Set<BlockLabel>(['Warm-up', 'Cool down']);
  const parts = blocks
    .filter(b => b.content.trim() && !skip.has(b.label))
    .map(b => {
      const firstLine = b.content.trim().split('\n')[0].trim();
      return firstLine.length > 30 ? firstLine.slice(0, 28) + '…' : firstLine;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Empty workout';
}

/* ── Auto-resize textarea hook ───────────────────────────────── */

function useAutoResize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);
  return ref;
}

function AutoTextarea({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useAutoResize(value);
  return (
    <textarea
      ref={ref}
      className="block-edit-textarea"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
    />
  );
}

/* ── Component ───────────────────────────────────────────────── */

export default function ProgramEditPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [programName, setProgramName] = useState('');
  const [workouts, setWorkouts] = useState<EditableWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const loadedDbIdsRef = useRef<string[]>([]);

  // AI Edit state
  const [aiEditIdx, setAiEditIdx] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aiPreBlocks, setAiPreBlocks] = useState<WorkoutBlock[] | null>(null); // for revert
  const [aiError, setAiError] = useState<string | null>(null);

  const loadProgram = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: prog, error: progErr } = await supabase
      .from('programs')
      .select('id, name')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (progErr || !prog) {
      setError('Program not found');
      setLoading(false);
      return;
    }
    setProgramName(prog.name);
    const { data: wk } = await supabase
      .from('program_workouts')
      .select('id, workout_text, sort_order')
      .eq('program_id', id)
      .order('sort_order');
    const loaded = (wk || []).map((w, i) => {
      const parsed = parseWorkoutBlocks(w.workout_text);
      return {
        blocks: parsed ?? [],
        rawText: parsed === null ? w.workout_text : null,
        sort_order: i,
        expanded: false,
        dbId: w.id,
        originalText: w.workout_text,
      };
    });
    setWorkouts(loaded);
    loadedDbIdsRef.current = loaded.map(w => w.dbId!);
    setError('');
    setLoading(false);
  }, [id, session.user.id]);

  useEffect(() => {
    if (!id) return;
    loadProgram();
  }, [id, loadProgram]);

  /* ── Workout mutations ───────────────────────────────────── */

  const toggleExpand = (idx: number) => {
    setWorkouts(prev => prev.map((w, i) => i === idx ? { ...w, expanded: !w.expanded } : w));
  };

  const updateBlockContent = (wIdx: number, bIdx: number, content: string) => {
    setWorkouts(prev => prev.map((w, i) => {
      if (i !== wIdx) return w;
      const blocks = w.blocks.map((b, j) => j === bIdx ? { ...b, content } : b);
      return { ...w, blocks };
    }));
  };

  const removeBlock = (wIdx: number, bIdx: number) => {
    setWorkouts(prev => prev.map((w, i) => {
      if (i !== wIdx) return w;
      return { ...w, blocks: w.blocks.filter((_, j) => j !== bIdx) };
    }));
  };

  const addBlock = (wIdx: number, label: BlockLabel) => {
    setWorkouts(prev => prev.map((w, i) => {
      if (i !== wIdx) return w;
      return { ...w, blocks: [...w.blocks, { label, content: '' }], expanded: true };
    }));
  };

  const updateRawText = (idx: number, rawText: string) => {
    setWorkouts(prev => prev.map((w, i) => i === idx ? { ...w, rawText } : w));
  };

  const removeWorkout = (idx: number) => {
    setWorkouts(prev => prev.filter((_, i) => i !== idx));
  };

  const addWorkout = () => {
    setWorkouts(prev => [...prev, {
      blocks: [{ label: 'Warm-up', content: '' }, { label: 'Strength', content: '' }, { label: 'Metcon', content: '' }],
      rawText: null,
      sort_order: prev.length,
      expanded: true,
      dbId: null,
      originalText: null,
    }]);
  };

  /* ── AI Edit ──────────────────────────────────────────────── */

  const handleAiEdit = async (wIdx: number) => {
    const w = workouts[wIdx];
    if (!w.dbId || !aiPrompt.trim()) return;

    setAiLoading(true);
    setAiRationale(null);
    setAiError(null);
    setAiPreBlocks([...w.blocks.map(b => ({ ...b }))]);

    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(ADJUST_WORKOUT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workout_id: w.dbId, request: aiPrompt.trim() }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `AI edit failed (${resp.status})`);

      const aiBlocks: WorkoutBlock[] = (data.blocks || [])
        .filter((b: { label: string; content: string }) =>
          BLOCK_LABELS.includes(b.label as BlockLabel) && b.content?.trim()
        )
        .map((b: { label: string; content: string }) => ({
          label: b.label as BlockLabel,
          content: b.content.trim(),
        }));

      if (aiBlocks.length > 0) {
        setWorkouts(prev => prev.map((wo, i) =>
          i === wIdx ? { ...wo, blocks: aiBlocks } : wo
        ));
      }

      setAiRationale(data.rationale || null);
      setAiPrompt('');
    } catch (err: any) {
      setAiError(err?.message || 'AI edit failed');
      setAiPreBlocks(null);
    } finally {
      setAiLoading(false);
    }
  };

  const revertAiEdit = (wIdx: number) => {
    if (!aiPreBlocks) return;
    setWorkouts(prev => prev.map((wo, i) =>
      i === wIdx ? { ...wo, blocks: aiPreBlocks } : wo
    ));
    setAiPreBlocks(null);
    setAiRationale(null);
  };

  const dismissAi = (wIdx: number) => {
    if (aiEditIdx === wIdx) {
      setAiEditIdx(null);
      setAiPrompt('');
      setAiRationale(null);
      setAiPreBlocks(null);
      setAiError(null);
    }
  };

  /* ── Save ─────────────────────────────────────────────────── */

  const saveProgram = async () => {
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const { error: progErr } = await supabase
        .from('programs')
        .update({ name: programName.trim() || 'Untitled Program' })
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (progErr) throw progErr;

      // Build set of current dbIds to detect removals
      const currentDbIds = new Set(workouts.filter(w => w.dbId).map(w => w.dbId!));

      // Detect removed workouts: had a dbId at load time but no longer in state
      // We need the original set of dbIds — gather from workouts that still have dbId
      // plus any that were removed. We track removals by comparing against the loaded set.
      // Since removed workouts are filtered out of state, we store original IDs via ref.
      // For now, collect all IDs we know about and let the remaining logic handle it.

      const changedIds: string[] = [];

      for (let i = 0; i < workouts.length; i++) {
        const w = workouts[i];
        const currentText = w.rawText ?? blocksToText(w.blocks);

        if (w.dbId && w.originalText !== null) {
          // Existing row — check if text or sort_order changed
          if (currentText !== w.originalText || w.sort_order !== i) {
            const { error: upErr } = await supabase
              .from('program_workouts')
              .update({ workout_text: currentText, sort_order: i, day_num: i + 1 })
              .eq('id', w.dbId);
            if (upErr) throw upErr;
            changedIds.push(w.dbId);
          }
        } else {
          // New row — insert
          const { data: inserted, error: insErr } = await supabase
            .from('program_workouts')
            .insert({
              program_id: id,
              week_num: 1,
              day_num: i + 1,
              workout_text: currentText,
              sort_order: i,
            })
            .select('id')
            .single();
          if (insErr) throw insErr;
          if (inserted) changedIds.push(inserted.id);
        }
      }

      // Delete removed workouts (rows with dbIds that are no longer in state)
      // We need the original loaded IDs for this — use loadedDbIds ref
      for (const origId of loadedDbIdsRef.current) {
        if (!currentDbIds.has(origId)) {
          await supabase.from('program_workouts').delete().eq('id', origId);
        }
      }

      // Only sync blocks for workouts that actually changed
      if (changedIds.length > 0) {
        await supabase.functions.invoke('sync-program-blocks', {
          body: { program_id: id, workout_ids: changedIds },
        });
      }

      navigate(`/programs/${id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to save program');
    } finally {
      setSaving(false);
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
          <h1>Edit program</h1>
        </header>
        <div className="page-body">
          <div className="programs-add-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : error && workouts.length === 0 ? (
              <div className="empty-state">
                <p>{error}</p>
                <button className="auth-btn" onClick={() => navigate('/programs')}>Back to programs</button>
              </div>
            ) : (
              <>
                <div className="program-preview-header">
                  <input
                    type="text"
                    className="program-name-input"
                    placeholder="Program name"
                    value={programName}
                    onChange={e => setProgramName(e.target.value)}
                  />
                  <div className="program-preview-header-right">
                    <span className="program-edit-workout-count">{workouts.length} workout{workouts.length !== 1 ? 's' : ''}</span>
                    <button type="button" className="link-btn" onClick={() => navigate(`/programs/${id}`)}>
                      Cancel
                    </button>
                  </div>
                </div>

                <div className="block-edit-list">
                  {workouts.map((w, i) => (
                    <div key={i} className={`block-edit-row${w.expanded ? ' block-edit-row--expanded' : ''}`}>
                      {/* Collapsed header */}
                      <div className="block-edit-header" onClick={() => toggleExpand(i)}>
                        <span className="block-edit-day">Day {i + 1}</span>
                        <span className="block-edit-summary">
                          {w.rawText !== null
                            ? (w.rawText.slice(0, 60) + (w.rawText.length > 60 ? '...' : ''))
                            : blockSummary(w.blocks)}
                        </span>
                        <span className="block-edit-actions">
                          {w.expanded && (
                            <button
                              type="button"
                              className="program-save-btn"
                              onClick={e => { e.stopPropagation(); saveProgram(); }}
                              disabled={saving}
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="program-remove-btn"
                            onClick={e => { e.stopPropagation(); removeWorkout(i); }}
                          >
                            Remove
                          </button>
                          <svg
                            className={`block-edit-chevron${w.expanded ? ' block-edit-chevron--open' : ''}`}
                            width="16" height="16" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </div>

                      {/* Expanded body */}
                      {w.expanded && (
                        <div className="block-edit-body">
                          {w.rawText !== null ? (
                            /* Legacy unparseable workout — single textarea fallback */
                            <div className="block-edit-block">
                              <div className="block-edit-block-label">Workout text</div>
                              <AutoTextarea
                                value={w.rawText}
                                onChange={v => updateRawText(i, v)}
                                placeholder="Full workout text..."
                              />
                            </div>
                          ) : (
                            /* Block-level editing */
                            <>
                              {w.blocks.map((b, j) => (
                                <div key={j} className="block-edit-block">
                                  <div className="block-edit-block-header">
                                    <span className="block-edit-block-label">{b.label}</span>
                                    <button
                                      type="button"
                                      className="block-edit-block-remove"
                                      onClick={() => removeBlock(i, j)}
                                      title={`Remove ${b.label}`}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                      </svg>
                                    </button>
                                  </div>
                                  <AutoTextarea
                                    value={b.content}
                                    onChange={v => updateBlockContent(i, j, v)}
                                    placeholder={`Enter ${b.label.toLowerCase()} details...`}
                                  />
                                </div>
                              ))}
                              <AddBlockDropdown
                                existingLabels={w.blocks.map(b => b.label)}
                                onAdd={label => addBlock(i, label)}
                              />

                              {/* AI Edit */}
                              {w.dbId && (
                                <div className="ai-edit-section">
                                  {aiEditIdx === i ? (
                                    <>
                                      <div className="ai-edit-input-row">
                                        <input
                                          type="text"
                                          className="ai-edit-input"
                                          value={aiPrompt}
                                          onChange={e => setAiPrompt(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter' && !aiLoading) handleAiEdit(i); }}
                                          placeholder="e.g. swap snatch for clean & jerk, make metcon shorter..."
                                          disabled={aiLoading}
                                          autoFocus
                                        />
                                        <button
                                          type="button"
                                          className="ai-edit-submit"
                                          onClick={() => handleAiEdit(i)}
                                          disabled={aiLoading || !aiPrompt.trim()}
                                        >
                                          {aiLoading ? 'Thinking...' : 'Go'}
                                        </button>
                                        <button
                                          type="button"
                                          className="ai-edit-cancel"
                                          onClick={() => dismissAi(i)}
                                          disabled={aiLoading}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                      {aiError && (
                                        <div className="ai-edit-error">{aiError}</div>
                                      )}
                                      {aiRationale && (
                                        <div className="ai-edit-rationale">
                                          {aiRationale}
                                          <button
                                            type="button"
                                            className="ai-edit-revert"
                                            onClick={() => revertAiEdit(i)}
                                          >
                                            Revert
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="ai-edit-btn"
                                      onClick={() => { setAiEditIdx(i); setAiPrompt(''); setAiRationale(null); setAiPreBlocks(null); setAiError(null); }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.26-2.5 4.13L12 11.5l-1.5-1.37C9.4 9.26 8 7.95 8 6a4 4 0 0 1 4-4z" />
                                        <path d="M8.5 14h7l1 8h-9l1-8z" />
                                      </svg>
                                      AI Edit
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button type="button" className="add-program-cta" onClick={addWorkout} style={{ marginTop: 12 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add workout
                </button>

                <div className="program-actions" style={{ marginTop: 24 }}>
                  <button className="auth-btn" onClick={saveProgram} disabled={saving}>
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </>
            )}
            {error && workouts.length > 0 && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Add-block dropdown ──────────────────────────────────────── */

function AddBlockDropdown({ existingLabels, onAdd }: {
  existingLabels: BlockLabel[];
  onAdd: (label: BlockLabel) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = BLOCK_LABELS.filter(l => !existingLabels.includes(l));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (available.length === 0) return null;

  return (
    <div className="block-edit-add-wrap" ref={ref}>
      <button type="button" className="block-edit-add-btn" onClick={() => setOpen(!open)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add block
      </button>
      {open && (
        <div className="block-edit-add-menu">
          {available.map(label => (
            <button
              key={label}
              type="button"
              className="block-edit-add-option"
              onClick={() => { onAdd(label); setOpen(false); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
