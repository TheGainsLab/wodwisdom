import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface Block {
  label: string;
  type: string;
  text: string;
}

interface EntryValues {
  reps?: number;
  weight?: number;
  weight_unit: 'lbs' | 'kg';
  rpe?: number;
  set_number?: number;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  'warm-up': 'Warm-up',
  skills: 'Skills',
  strength: 'Strength',
  metcon: 'Metcon',
  'cool-down': 'Cool Down',
};

function getMetconTypeLabel(text: string): string {
  const t = text.toUpperCase();
  if (/AMRAP|AS MANY ROUNDS/.test(t)) return 'AMRAP';
  if (/EMOM|E\d+MOM/.test(t)) return 'EMOM';
  return 'For Time';
}

function parseSetsReps(text: string): { sets?: number; reps?: number } {
  const match = text.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (match) return { sets: parseInt(match[1], 10), reps: parseInt(match[2], 10) };
  return {};
}

function extractMovementName(text: string): string {
  return text
    .replace(/\d+\s*[x×]\s*\d+/i, '')
    .replace(/@\s*\d+%/g, '')
    .replace(/,\s*$/, '')
    .trim() || text.trim();
}

function inferWorkoutType(blocks: Block[]): string {
  const metcon = blocks.find(b => b.type === 'metcon');
  if (metcon) {
    const t = metcon.text.toUpperCase();
    if (/AMRAP|AS MANY ROUNDS/.test(t)) return 'amrap';
    if (/EMOM|E\d+MOM/.test(t)) return 'emom';
    return 'for_time';
  }
  if (blocks.some(b => b.type === 'strength')) return 'strength';
  return 'other';
}

const compactInputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 14,
};

export default function StartWorkoutPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [workoutDate, setWorkoutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workoutType, setWorkoutType] = useState('other');
  const [notes, setNotes] = useState('');
  const [entryValues, setEntryValues] = useState<Record<string, EntryValues>>({});
  const [blockScores, setBlockScores] = useState<Record<number, string>>({});
  const [blockRx, setBlockRx] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  const sourceState = location.state as {
    workout_text?: string;
    source_id?: string;
  } | null;

  // Fetch blocks from program_workout_blocks on mount
  useEffect(() => {
    if (!sourceState?.source_id) {
      setLoading(false);
      setError('No workout selected');
      return;
    }

    (async () => {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from('program_workout_blocks')
        .select('block_type, block_text, block_order')
        .eq('program_workout_id', sourceState.source_id!)
        .order('block_order');

      if (fetchErr || !data || data.length === 0) {
        setError('Could not load workout blocks');
        setLoading(false);
        return;
      }

      const loaded: Block[] = data.map(row => ({
        label: BLOCK_TYPE_LABELS[row.block_type] || row.block_type,
        type: row.block_type,
        text: row.block_text,
      }));

      setBlocks(loaded);
      setWorkoutType(inferWorkoutType(loaded));

      // Pre-fill strength per-set entries
      const initial: Record<string, EntryValues> = {};
      loaded.forEach((b, bi) => {
        if (b.type === 'strength') {
          const { sets, reps } = parseSetsReps(b.text);
          const numSets = sets && sets > 0 ? sets : 1;
          for (let s = 0; s < numSets; s++) {
            initial[`${bi}-s${s}`] = {
              reps,
              weight: undefined,
              weight_unit: 'lbs',
              rpe: undefined,
              set_number: s + 1,
            };
          }
        }
      });
      setEntryValues(initial);
      setLoading(false);
    })();
  }, [sourceState?.source_id]);

  const setEntry = (key: string, field: keyof EntryValues, value: unknown) => {
    setEntryValues(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const handleFinish = async () => {
    setError('');
    setSaving(true);
    try {
      const logBlocks = blocks.map((b, bi) => {
        if (b.type === 'strength') {
          const movementName = extractMovementName(b.text);
          const setKeys = Object.keys(entryValues)
            .filter(k => k.startsWith(`${bi}-s`))
            .sort((a, b2) => {
              const aNum = parseInt(a.split('-s')[1], 10);
              const bNum = parseInt(b2.split('-s')[1], 10);
              return aNum - bNum;
            });
          const entries = setKeys.map(key => {
            const ev = entryValues[key] || {};
            return {
              movement: movementName,
              sets: 1,
              reps: ev.reps ?? null,
              weight: ev.weight ?? null,
              weight_unit: ev.weight_unit || 'lbs',
              rpe: ev.rpe ?? null,
              scaling_note: null,
              set_number: ev.set_number ?? null,
              reps_completed: null,
              hold_seconds: null,
              distance: null,
              distance_unit: null,
              quality: null,
              variation: null,
            };
          });
          return {
            label: b.label,
            type: b.type,
            text: b.text,
            score: blockScores[bi]?.trim() || null,
            rx: false,
            entries,
          };
        }

        // All other block types: no per-movement entries
        return {
          label: b.label,
          type: b.type,
          text: b.text,
          score: blockScores[bi]?.trim() || null,
          rx: blockRx[bi] ?? false,
          entries: [],
        };
      });

      const workoutText = sourceState?.workout_text?.trim() ||
        blocks.map(b => `${b.label}: ${b.text}`).join('\n');

      const { data, error } = await supabase.functions.invoke('log-workout', {
        body: {
          workout_date: workoutDate,
          workout_text: workoutText,
          workout_type: workoutType,
          source_id: sourceState?.source_id || null,
          notes: notes.trim() || null,
          blocks: logBlocks,
        },
      });
      if (error) throw new Error(error.message || 'Failed to save');
      if (data?.error) throw new Error(data.error || 'Failed to save');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Start Workout</h1>
        </header>

        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 0' }}>
            {success ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 32 }}>
                <h3 style={{ marginBottom: 12 }}>Workout saved!</h3>
                <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>Your workout has been logged.</p>
                <button className="auth-btn" onClick={() => navigate('/training-log')} style={{ maxWidth: 200 }}>
                  View Training Log
                </button>
              </div>
            ) : loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : blocks.length === 0 ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 32 }}>
                <p style={{ color: 'var(--text-dim)' }}>{error || 'No workout blocks found.'}</p>
                <button className="auth-btn" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>Go Back</button>
              </div>
            ) : (
              <>
                <div className="workout-review-section" style={{ marginBottom: 16 }}>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label>Date</label>
                    <input type="date" value={workoutDate} onChange={e => setWorkoutDate(e.target.value)} style={{ maxWidth: 180 }} />
                  </div>
                  <div className="field">
                    <label>Notes</label>
                    <input type="text" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </div>

                {blocks.map((block, bi) => (
                  <div key={bi} className="workout-review-section" style={{ marginBottom: 16 }}>
                    <h3>
                      {block.label}
                      {block.type === 'metcon' && ` — ${getMetconTypeLabel(block.text)}`}
                    </h3>
                    <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap', marginBottom: 16 }}>{block.text}</div>

                    {block.type === 'strength' && (() => {
                      const setKeys = Object.keys(entryValues)
                        .filter(k => k.startsWith(`${bi}-s`))
                        .sort((a, b) => parseInt(a.split('-s')[1], 10) - parseInt(b.split('-s')[1], 10));

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--text-dim)', paddingLeft: 40 }}>
                            <span style={{ width: 60 }}>Reps</span>
                            <span style={{ width: 80 }}>Weight</span>
                            <span style={{ width: 32 }}></span>
                            <span style={{ width: 56 }}>RPE</span>
                          </div>
                          {setKeys.map(key => {
                            const ev = entryValues[key] || {};
                            return (
                              <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 28, textAlign: 'right' }}>S{ev.set_number}</span>
                                <input type="number" placeholder="Reps" value={ev.reps ?? ''} onChange={e => setEntry(key, 'reps', e.target.value ? parseInt(e.target.value, 10) : undefined)} style={{ ...compactInputStyle, width: 60 }} />
                                <input type="number" placeholder="Weight" value={ev.weight ?? ''} onChange={e => setEntry(key, 'weight', e.target.value ? parseFloat(e.target.value) : undefined)} style={{ ...compactInputStyle, width: 80 }} />
                                <span style={{ color: 'var(--text-dim)', fontSize: 13, width: 28 }}>{ev.weight_unit || 'lbs'}</span>
                                <input type="number" placeholder="RPE" min={1} max={10} value={ev.rpe ?? ''} onChange={e => setEntry(key, 'rpe', e.target.value ? parseInt(e.target.value, 10) : undefined)} style={{ ...compactInputStyle, width: 56 }} />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {block.type === 'metcon' && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <input type="checkbox" id={`rx-${bi}`} checked={blockRx[bi] ?? false} onChange={e => setBlockRx(prev => ({ ...prev, [bi]: e.target.checked }))} />
                          <label htmlFor={`rx-${bi}`} style={{ fontSize: 14, color: 'var(--text-dim)' }}>Rx</label>
                        </div>
                        <div className="field">
                          <label>Score</label>
                          <input type="text" placeholder="e.g. 4:48 or 8+12" value={blockScores[bi] ?? ''} onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))} />
                        </div>
                      </>
                    )}

                    {(block.type === 'warm-up' || block.type === 'cool-down' || block.type === 'skills') && (
                      <div style={{ marginTop: 8 }}>
                        <input
                          type="text"
                          placeholder={
                            block.type === 'warm-up' ? 'Notes (optional, e.g. subbed row for bike)' :
                            block.type === 'cool-down' ? 'Notes (optional, e.g. extra hip stretching)' :
                            'Notes (optional, e.g. got 5 unbroken kipping)'
                          }
                          value={blockScores[bi] ?? ''}
                          onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))}
                          style={{ ...compactInputStyle, width: '100%' }}
                        />
                      </div>
                    )}
                  </div>
                ))}

                {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <button className="auth-btn" style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate(-1)}>
                    Back
                  </button>
                  <button className="auth-btn" onClick={handleFinish} disabled={saving} style={{ flex: 1 }}>
                    {saving ? 'Saving...' : 'Finish Workout'}
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
