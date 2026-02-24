import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface BlockMovement {
  canonical: string;
  modality: string;
  load: string;
  suggested_weight?: number;
}

interface Block {
  label: string;
  type: string;
  text: string;
  movements: BlockMovement[];
}

interface EntryValues {
  sets?: number;
  reps?: number;
  weight?: number;
  weight_unit: 'lbs' | 'kg';
  rpe?: number;
  scaling_note?: string;
}

function inferWorkoutType(blocks: Block[]): string {
  if (blocks.length === 0) return 'other';
  const first = blocks[0];
  if (first.type === 'metcon') {
    const t = first.text.toUpperCase();
    if (/AMRAP|AS MANY ROUNDS/.test(t)) return 'amrap';
    if (/EMOM|E\d+MOM/.test(t)) return 'emom';
    return 'for_time';
  }
  if (first.type === 'strength') return 'strength';
  return 'other';
}

function parseSetsReps(text: string): { sets?: number; reps?: number } {
  const match = text.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (match) return { sets: parseInt(match[1], 10), reps: parseInt(match[2], 10) };
  return {};
}

function formatMovementName(canonical: string): string {
  return canonical.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
  const [workoutText, setWorkoutText] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [workoutDate, setWorkoutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workoutType, setWorkoutType] = useState('strength');
  const [score, setScore] = useState('');
  const [rx, setRx] = useState(false);
  const [notes, setNotes] = useState('');
  const [entryValues, setEntryValues] = useState<Record<string, EntryValues>>({});
  const [blockScores, setBlockScores] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const sourceState = location.state as { workout_text?: string; source_type?: string; source_id?: string } | null;

  useEffect(() => {
    if (sourceState?.workout_text) {
      setWorkoutText(sourceState.workout_text);
    }
  }, [sourceState?.workout_text]);

  const parseWorkout = async () => {
    const trimmed = workoutText.trim();
    if (!trimmed || trimmed.length < 10) {
      setError('Paste a complete workout');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-workout', {
        body: { workout_text: trimmed },
      });
      if (error) throw new Error(error.message || 'Parse failed');
      if (data?.error) throw new Error(data.error);
      setBlocks(data?.blocks || []);
      setNotices(data?.notices || []);
      setWorkoutType(inferWorkoutType(data?.blocks || []));
      const initial: Record<string, EntryValues> = {};
      (data?.blocks || []).forEach((b: Block, bi: number) => {
        const { sets, reps } = parseSetsReps(b.text);
        b.movements.forEach((m: BlockMovement, mi: number) => {
          const key = `${bi}-${mi}`;
          initial[key] = {
            sets,
            reps,
            weight: m.suggested_weight ?? undefined,
            weight_unit: 'lbs',
            rpe: undefined,
            scaling_note: undefined,
          };
        });
      });
      setEntryValues(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse workout');
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  };

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
        const entries = b.movements.map((m, mi) => {
          const key = `${bi}-${mi}`;
          const ev = entryValues[key] || {};
          return {
            movement: m.canonical,
            sets: ev.sets ?? null,
            reps: ev.reps ?? null,
            weight: ev.weight ?? null,
            weight_unit: ev.weight_unit || 'lbs',
            rpe: ev.rpe ?? null,
            scaling_note: ev.scaling_note?.trim() || null,
          };
        });
        return {
          label: b.label,
          type: b.type,
          text: b.text,
          score: blockScores[bi]?.trim() || (b.type === 'metcon' ? score.trim() : null),
          entries,
        };
      });

      const { data, error } = await supabase.functions.invoke('log-workout', {
        body: {
          workout_date: workoutDate,
          workout_text: workoutText.trim(),
          workout_type: workoutType,
          score: score.trim() || null,
          rx,
          source_type: sourceState?.source_type || 'manual',
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

  const hasMetcon = blocks.some(b => b.type === 'metcon');

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
                <button className="auth-btn" onClick={() => navigate('/training-log')} style={{ maxWidth: 200, margin: '0 8px 8px 0' }}>
                  View Training Log
                </button>
                <button className="auth-btn" onClick={() => { setSuccess(false); setBlocks([]); setWorkoutText(''); }} style={{ maxWidth: 200, background: 'var(--surface2)', color: 'var(--text)' }}>
                  Log Another
                </button>
              </div>
            ) : blocks.length === 0 ? (
              <div>
                <textarea
                  className="workout-review-textarea"
                  value={workoutText}
                  onChange={e => setWorkoutText(e.target.value)}
                  placeholder="Paste a workout to log...&#10;&#10;e.g. A) 5x3 Back Squat @80%&#10;B) 3 RFT: 15 wall balls, 10 toes to bar"
                  rows={6}
                />
                {error && <div className="auth-error" style={{ display: 'block', marginTop: 12 }}>{error}</div>}
                <button
                  className="auth-btn"
                  onClick={parseWorkout}
                  disabled={loading || !workoutText.trim()}
                  style={{ marginTop: 16 }}
                >
                  {loading ? 'Parsing...' : 'Parse & Start'}
                </button>
              </div>
            ) : (
              <>
                <div className="workout-review-section" style={{ marginBottom: 16 }}>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label>Date</label>
                    <input
                      type="date"
                      value={workoutDate}
                      onChange={e => setWorkoutDate(e.target.value)}
                      style={{ maxWidth: 180 }}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label>Workout type</label>
                    <select
                      value={workoutType}
                      onChange={e => setWorkoutType(e.target.value)}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', color: 'var(--text)', fontFamily: 'inherit', fontSize: 15, maxWidth: 200 }}
                    >
                      <option value="strength">Strength</option>
                      <option value="for_time">For Time</option>
                      <option value="amrap">AMRAP</option>
                      <option value="emom">EMOM</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  {hasMetcon && (
                    <>
                      <div className="field" style={{ marginBottom: 12 }}>
                        <label>Score (time or rounds+reps)</label>
                        <input
                          type="text"
                          placeholder="e.g. 4:48 or 8+12"
                          value={score}
                          onChange={e => setScore(e.target.value)}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <input
                          type="checkbox"
                          id="rx"
                          checked={rx}
                          onChange={e => setRx(e.target.checked)}
                        />
                        <label htmlFor="rx" style={{ fontSize: 14, color: 'var(--text-dim)' }}>Rx</label>
                      </div>
                    </>
                  )}
                  <div className="field">
                    <label>Notes</label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                    />
                  </div>
                </div>

                {blocks.map((block, bi) => (
                  <div key={bi} className="workout-review-section" style={{ marginBottom: 16 }}>
                    <h3>{block.label}) {block.type}</h3>
                    <div className="workout-review-content" style={{ whiteSpace: 'pre-wrap', marginBottom: 16 }}>{block.text}</div>

                    {block.type === 'strength' && block.movements.map((m, mi) => {
                      const key = `${bi}-${mi}`;
                      const ev = entryValues[key] || {};
                      return (
                        <div key={key} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, minWidth: 120 }}>{formatMovementName(m.canonical)}</span>
                          <input
                            type="number"
                            placeholder="Sets"
                            value={ev.sets ?? ''}
                            onChange={e => setEntry(key, 'sets', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                            style={{ ...compactInputStyle, width: 60 }}
                          />
                          <input
                            type="number"
                            placeholder="Reps"
                            value={ev.reps ?? ''}
                            onChange={e => setEntry(key, 'reps', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                            style={{ ...compactInputStyle, width: 60 }}
                          />
                          <input
                            type="number"
                            placeholder="Weight"
                            value={ev.weight ?? ''}
                            onChange={e => setEntry(key, 'weight', e.target.value ? parseFloat(e.target.value) : undefined)}
                            style={{ ...compactInputStyle, width: 80 }}
                          />
                          <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>{ev.weight_unit || 'lbs'}</span>
                          <input
                            type="number"
                            placeholder="RPE 1-10"
                            min={1}
                            max={10}
                            value={ev.rpe ?? ''}
                            onChange={e => setEntry(key, 'rpe', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                            style={{ ...compactInputStyle, width: 70 }}
                          />
                        </div>
                      );
                    })}

                    {block.type === 'metcon' && (
                      <>
                        <div className="field" style={{ marginBottom: 12 }}>
                          <label>Block score</label>
                          <input
                            type="text"
                            placeholder="e.g. 14:22"
                            value={blockScores[bi] ?? ''}
                            onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))}
                          />
                        </div>
                        {block.movements.map((m, mi) => {
                          const key = `${bi}-${mi}`;
                          const ev = entryValues[key] || {};
                          return (
                          <div key={key} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, minWidth: 140 }}>{formatMovementName(m.canonical)}</span>
                            <input
                              type="text"
                              placeholder="Scaling (e.g. Rx, banded)"
                              value={ev.scaling_note ?? ''}
                              onChange={e => setEntry(key, 'scaling_note', e.target.value)}
                              style={{ ...compactInputStyle, flex: 1, maxWidth: 200 }}
                            />
                          </div>
                          );
                        })}
                      </>
                    )}

                    {(block.type === 'accessory' || block.type === 'other') && block.movements.length > 0 && (
                      block.movements.map((m, mi) => {
                        const key = `${bi}-${mi}`;
                        const ev = entryValues[key] || {};
                        return (
                          <div key={key} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, minWidth: 120 }}>{formatMovementName(m.canonical)}</span>
                            <input type="number" placeholder="Sets" value={ev.sets ?? ''} onChange={e => setEntry(key, 'sets', e.target.value ? parseInt(e.target.value, 10) : undefined)} style={{ ...compactInputStyle, width: 60 }} />
                            <input type="number" placeholder="Reps" value={ev.reps ?? ''} onChange={e => setEntry(key, 'reps', e.target.value ? parseInt(e.target.value, 10) : undefined)} style={{ ...compactInputStyle, width: 60 }} />
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}

                {notices.length > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{notices.join(' ')}</div>
                )}

                {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <button
                    className="auth-btn"
                    style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)' }}
                    onClick={() => { setBlocks([]); setWorkoutText(''); setError(''); }}
                  >
                    Start Over
                  </button>
                  <button
                    className="auth-btn"
                    onClick={handleFinish}
                    disabled={saving}
                    style={{ flex: 1 }}
                  >
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
