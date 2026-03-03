import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import { BlockContent } from '../components/WorkoutBlocksDisplay';
import {
  calculateBenchmarks,
  scoreMetcon,
  type MovementWorkRate,
  type BenchmarkResult,
} from '../lib/metconScoring';

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

interface MetconEntryValues {
  movement: string;
  reps?: number;
  weight?: number;
  weight_unit: 'lbs' | 'kg';
  distance?: number;
  distance_unit?: 'ft' | 'm';
  scaling_note?: string;
}

interface SkillsEntryValues {
  movement: string;
  sets?: number;
  reps_completed?: number;
  hold_seconds?: number;
  quality?: 'A' | 'B' | 'C' | 'D';
  variation?: string;
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

// ── Metcon movement parser ──────────────────────────────────────────

function parseMetconMovements(blockText: string): MetconEntryValues[] {
  let text = blockText.trim();

  // Strip format headers (AMRAP N, For Time, N RFT, EMOM N, etc.)
  text = text
    .replace(/^(?:AMRAP|As Many Rounds(?:\s+As Possible)?)\s+\d+\s*/i, '')
    .replace(/^For\s+Time:?\s*/i, '')
    .replace(/^\d+\s+(?:RFT|Rounds?\s+For\s+Time)\s*/i, '')
    .replace(/^\d+\s+[Rr]ounds?[^,\n]*[\n,]\s*/i, '')
    .replace(/^(?:EMOM|E\d+MOM)\s+\d+\s*/i, '')
    .replace(/^Death\s+By\s*/i, '')
    .replace(/^Tabata\s*/i, '')
    .trim();

  // Check for rep scheme (21-15-9, 10-8-6, etc.) on its own line
  let schemeTotalReps: number | null = null;
  const schemeMatch = text.match(/^(\d+(?:\s*-\s*\d+)+)\s*[\n,]/);
  if (schemeMatch) {
    const rounds = schemeMatch[1].split(/\s*-\s*/).map(Number);
    schemeTotalReps = rounds.reduce((a, b) => a + b, 0);
    text = text.slice(schemeMatch[0].length).trim();
  }

  // Split into segments by newlines then commas
  const segments: string[] = [];
  for (const line of text.split('\n')) {
    for (const seg of line.split(',')) {
      const trimmed = seg.trim();
      if (trimmed && !/^(?:for quality|not time|rest\b|then\b)/i.test(trimmed)) {
        segments.push(trimmed);
      }
    }
  }

  const results: MetconEntryValues[] = [];
  for (const seg of segments) {
    const mv = parseMovementSegment(seg);
    if (mv) {
      if (schemeTotalReps && !mv.reps) mv.reps = schemeTotalReps;
      results.push(mv);
    }
  }
  return results;
}

function parseMovementSegment(raw: string): MetconEntryValues | null {
  if (!raw) return null;
  let text = raw.trim();
  let weight: number | undefined;
  let weight_unit: 'lbs' | 'kg' = 'lbs';
  let distance: number | undefined;
  let distance_unit: 'ft' | 'm' | undefined;
  let reps: number | undefined;

  // Extract weight in parentheses: (185), (95/65), (53 kg)
  const parenMatch = text.match(/\((\d+)(?:\/\d+)?\s*(lbs?|kg)?\)/i);
  if (parenMatch) {
    weight = parseFloat(parenMatch[1]);
    if (parenMatch[2] && /^kg$/i.test(parenMatch[2])) weight_unit = 'kg';
    text = text.replace(parenMatch[0], '').trim();
  }

  // Extract weight with slash notation: 185/125 (take Rx weight)
  if (!weight) {
    const slashMatch = text.match(/\b(\d+)\/(\d+)\b/);
    if (slashMatch && parseInt(slashMatch[1]) >= 20) {
      weight = parseInt(slashMatch[1]);
      text = text.replace(slashMatch[0], '').trim();
    }
  }

  // Extract distance: 200m, 400m, 500m, 1000ft
  const distMatch = text.match(/(\d+)\s*(m|ft|meters?|feet)\b/i);
  if (distMatch) {
    distance = parseInt(distMatch[1]);
    distance_unit = /^(ft|feet)$/i.test(distMatch[2]) ? 'ft' : 'm';
    text = text.replace(distMatch[0], '').trim();
  }

  // Extract cal-based monostructural: "30 cal row" → reps=30, movement="Cal Row"
  const calMatch = text.match(/^(\d+)\s+cal(?:orie)?s?\s+(.+)/i);
  if (calMatch) {
    reps = parseInt(calMatch[1]);
    const mvName = `Cal ${calMatch[2].trim()}`;
    return { movement: capitalizeWords(mvName), reps, weight, weight_unit, distance, distance_unit };
  }

  // Extract leading reps: "9 deadlifts" → reps=9
  const repsMatch = text.match(/^(\d+)\s+/);
  if (repsMatch && parseInt(repsMatch[1]) < 500) {
    reps = parseInt(repsMatch[1]);
    text = text.slice(repsMatch[0].length).trim();
  }

  // Clean up trailing punctuation
  text = text.replace(/[,;:]$/, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  return { movement: capitalizeWords(text), reps, weight, weight_unit, distance, distance_unit };
}

function capitalizeWords(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Skills movement parser ──────────────────────────────────────────

function parseSkillsMovements(blockText: string): SkillsEntryValues[] {
  const results: SkillsEntryValues[] = [];
  const lines = blockText.split('\n');

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Skip structure headers: "EMOM 8:", "E2MOM 10:", "Every 2 min:", "For quality:", "Not for time", "Rest", "Then"
    if (/^(?:e\d*mom\s+\d+|every\s+\d+|for\s+quality|not\s+for\s+time|rest|then)\b/i.test(line)) continue;
    // Skip round/time headers: "3 Rounds:", "5 Sets:"
    if (/^\d+\s+(?:rounds?|sets?)\s*:/i.test(line)) continue;

    // Strip minute/round prefixes: "Min 1 —", "Minute 2:", "Odd —", "Even —"
    line = line.replace(/^(?:min(?:ute)?\s*\d+\s*[:\-–—]\s*|(?:odd|even)\s*[:\-–—]\s*)/i, '').trim();
    if (!line) continue;

    let movement = line;
    let sets: number | undefined;
    let reps_completed: number | undefined;
    let hold_seconds: number | undefined;

    // Extract hold: ":20", "25s hold", "20 sec hold", "25s" (followed by space + word)
    const holdMatch = movement.match(/:(\d+)\b|(\d+)\s*s(?:ec(?:ond)?s?)?\s+(?:hold\b)?/i);
    if (holdMatch) {
      hold_seconds = parseInt(holdMatch[1] || holdMatch[2], 10);
      movement = movement.replace(holdMatch[0], '').trim();
    }

    // Extract sets x reps: "4x5", "4 x 5", "4×5"
    const setsRepsMatch = movement.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (setsRepsMatch) {
      sets = parseInt(setsRepsMatch[1], 10);
      reps_completed = parseInt(setsRepsMatch[2], 10);
      movement = movement.replace(setsRepsMatch[0], '').trim();
    } else {
      // Extract sets only: "4x :20" (sets parsed, hold already extracted)
      const setsOnlyMatch = movement.match(/(\d+)\s*[x×]\s*/i);
      if (setsOnlyMatch) {
        sets = parseInt(setsOnlyMatch[1], 10);
        movement = movement.replace(setsOnlyMatch[0], '').trim();
      } else {
        // Extract leading reps: "3 deficit strict HSPU negatives"
        const leadingReps = movement.match(/^(\d+)\s+/);
        if (leadingReps && parseInt(leadingReps[1], 10) < 100) {
          reps_completed = parseInt(leadingReps[1], 10);
          movement = movement.slice(leadingReps[0].length).trim();
        }
      }
    }

    // Clean up leading/trailing punctuation
    movement = movement.replace(/^[,\-–—+]+|[,\-–—+]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!movement) continue;

    results.push({
      movement: capitalizeWords(movement),
      sets,
      reps_completed,
      hold_seconds,
    });
  }

  return results;
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

export default function StartWorkoutPage({ session: _session }: { session: Session }) {
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
  const [metconEntries, setMetconEntries] = useState<Record<string, MetconEntryValues>>({});
  const [skillsEntries, setSkillsEntries] = useState<Record<string, SkillsEntryValues>>({});
  const [workRates, setWorkRates] = useState<MovementWorkRate[]>([]);
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

      // Fetch blocks and work rates in parallel
      const [blocksRes, ratesRes] = await Promise.all([
        supabase
          .from('program_workout_blocks')
          .select('block_type, block_text, block_order')
          .eq('program_workout_id', sourceState.source_id!)
          .order('block_order'),
        supabase
          .from('movements')
          .select('canonical_name, display_name, work_rate, weight_degradation_rate, modality')
          .not('work_rate', 'is', null),
      ]);

      if (ratesRes.data) {
        setWorkRates(ratesRes.data as MovementWorkRate[]);
      }

      const { data, error: fetchErr } = blocksRes;

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

      // Pre-fill metcon per-movement entries
      const initialMetcon: Record<string, MetconEntryValues> = {};
      loaded.forEach((b, bi) => {
        if (b.type === 'metcon') {
          const parsed = parseMetconMovements(b.text);
          parsed.forEach((mv, mi) => {
            initialMetcon[`${bi}-m${mi}`] = mv;
          });
        }
      });
      setMetconEntries(initialMetcon);

      // Pre-fill skills per-movement entries
      const initialSkills: Record<string, SkillsEntryValues> = {};
      loaded.forEach((b, bi) => {
        if (b.type === 'skills') {
          const parsed = parseSkillsMovements(b.text);
          parsed.forEach((sk, si) => {
            initialSkills[`${bi}-sk${si}`] = sk;
          });
        }
      });
      setSkillsEntries(initialSkills);
      setLoading(false);
    })();
  }, [sourceState?.source_id]);

  const setEntry = (key: string, field: keyof EntryValues, value: unknown) => {
    setEntryValues(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const setMetconEntry = (key: string, field: keyof MetconEntryValues, value: unknown) => {
    setMetconEntries(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const setSkillEntry = (key: string, field: keyof SkillsEntryValues, value: unknown) => {
    setSkillsEntries(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  // Reactively compute benchmarks per metcon block
  const blockBenchmarks = useMemo<Record<number, BenchmarkResult>>(() => {
    const result: Record<number, BenchmarkResult> = {};
    if (workRates.length === 0) return result;
    blocks.forEach((b, bi) => {
      if (b.type !== 'metcon') return;
      const mvKeys = Object.keys(metconEntries)
        .filter(k => k.startsWith(`${bi}-m`));
      if (mvKeys.length === 0) return;
      const entries = mvKeys.map(k => metconEntries[k]).filter(Boolean);
      const wType = inferWorkoutType([b]);
      result[bi] = calculateBenchmarks(entries, wType, b.text, workRates);
    });
    return result;
  }, [blocks, metconEntries, workRates]);

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

        if (b.type === 'metcon') {
          const mvKeys = Object.keys(metconEntries)
            .filter(k => k.startsWith(`${bi}-m`))
            .sort((a, b2) => parseInt(a.split('-m')[1], 10) - parseInt(b2.split('-m')[1], 10));
          const entries = mvKeys
            .map(key => metconEntries[key])
            .filter(mv => mv?.movement?.trim())
            .map(mv => ({
              movement: mv.movement.trim(),
              sets: null,
              reps: mv.reps ?? null,
              weight: mv.weight ?? null,
              weight_unit: mv.weight_unit || 'lbs',
              rpe: null,
              scaling_note: mv.scaling_note?.trim() || null,
              set_number: null,
              reps_completed: null,
              hold_seconds: null,
              distance: mv.distance ?? null,
              distance_unit: mv.distance_unit || null,
              quality: null,
              variation: null,
            }));

          // Compute percentile if benchmarks and score are available
          const benchmarks = blockBenchmarks[bi];
          const scoreStr = blockScores[bi]?.trim() || '';
          const wType = inferWorkoutType([b]);
          const scoring = benchmarks && scoreStr
            ? scoreMetcon(scoreStr, wType, benchmarks)
            : null;

          return {
            label: b.label,
            type: b.type,
            text: b.text,
            score: scoreStr || null,
            rx: blockRx[bi] ?? false,
            entries,
            percentile: scoring?.percentile ?? null,
            performance_tier: scoring?.performanceTier ?? null,
            median_benchmark: benchmarks?.medianScore !== '--' ? benchmarks?.medianScore : null,
            excellent_benchmark: benchmarks?.excellentScore !== '--' ? benchmarks?.excellentScore : null,
          };
        }

        if (b.type === 'skills') {
          const skKeys = Object.keys(skillsEntries)
            .filter(k => k.startsWith(`${bi}-sk`))
            .sort((a, b2) => parseInt(a.split('-sk')[1], 10) - parseInt(b2.split('-sk')[1], 10));
          const entries = skKeys
            .map(key => skillsEntries[key])
            .filter(sk => sk?.movement?.trim())
            .map(sk => ({
              movement: sk.movement.trim(),
              sets: sk.sets ?? null,
              reps: null,
              weight: null,
              weight_unit: 'lbs' as const,
              rpe: null,
              scaling_note: sk.variation?.trim() || null,
              set_number: null,
              reps_completed: sk.reps_completed ?? null,
              hold_seconds: sk.hold_seconds ?? null,
              distance: null,
              distance_unit: null,
              quality: sk.quality ?? null,
              variation: sk.variation?.trim() || null,
            }));
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
                    <div className="workout-review-content" style={{ marginBottom: 16 }}>
                      <BlockContent label={block.label} content={block.text} />
                    </div>

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

                    {block.type === 'metcon' && (() => {
                      const mvKeys = Object.keys(metconEntries)
                        .filter(k => k.startsWith(`${bi}-m`))
                        .sort((a, b2) => parseInt(a.split('-m')[1], 10) - parseInt(b2.split('-m')[1], 10));

                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <input type="checkbox" id={`rx-${bi}`} checked={blockRx[bi] ?? false} onChange={e => setBlockRx(prev => ({ ...prev, [bi]: e.target.checked }))} />
                            <label htmlFor={`rx-${bi}`} style={{ fontSize: 14, color: 'var(--text-dim)' }}>Rx</label>
                          </div>
                          <div className="field" style={{ marginBottom: 16 }}>
                            <label>Score</label>
                            <input type="text" placeholder="e.g. 4:48 or 8+12" value={blockScores[bi] ?? ''} onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))} />
                          </div>

                          {mvKeys.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Movements (confirm or adjust)</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {mvKeys.map(key => {
                                  const mv = metconEntries[key];
                                  if (!mv) return null;
                                  const hasDistance = mv.distance != null && mv.distance > 0;
                                  return (
                                    <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                      <input
                                        type="text"
                                        value={mv.movement}
                                        onChange={e => setMetconEntry(key, 'movement', e.target.value)}
                                        style={{ ...compactInputStyle, flex: '1 1 120px', minWidth: 120 }}
                                      />
                                      {hasDistance ? (
                                        <>
                                          <input
                                            type="number"
                                            placeholder="Dist"
                                            value={mv.distance ?? ''}
                                            onChange={e => setMetconEntry(key, 'distance', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                            style={{ ...compactInputStyle, width: 64 }}
                                          />
                                          <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 16 }}>{mv.distance_unit || 'm'}</span>
                                        </>
                                      ) : (
                                        <>
                                          <input
                                            type="number"
                                            placeholder="Reps"
                                            value={mv.reps ?? ''}
                                            onChange={e => setMetconEntry(key, 'reps', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                            style={{ ...compactInputStyle, width: 56 }}
                                          />
                                          <input
                                            type="number"
                                            placeholder="Wt"
                                            value={mv.weight ?? ''}
                                            onChange={e => setMetconEntry(key, 'weight', e.target.value ? parseFloat(e.target.value) : undefined)}
                                            style={{ ...compactInputStyle, width: 64 }}
                                          />
                                          <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 24 }}>{mv.weight_unit || 'lbs'}</span>
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {blockBenchmarks[bi] && blockBenchmarks[bi].medianScore !== '--' && (
                                <div style={{ display: 'flex', gap: 24, marginTop: 12, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 13 }}>
                                  <div>
                                    <span style={{ color: 'var(--text-dim)' }}>Median </span>
                                    <span style={{ fontWeight: 600 }}>{blockBenchmarks[bi].medianScore}</span>
                                  </div>
                                  <div>
                                    <span style={{ color: 'var(--text-dim)' }}>Excellent </span>
                                    <span style={{ fontWeight: 600 }}>{blockBenchmarks[bi].excellentScore}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {block.type === 'skills' && (() => {
                      const skKeys = Object.keys(skillsEntries)
                        .filter(k => k.startsWith(`${bi}-sk`))
                        .sort((a, b2) => parseInt(a.split('-sk')[1], 10) - parseInt(b2.split('-sk')[1], 10));

                      return (
                        <>
                          {skKeys.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Skill movements (confirm or adjust)</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {skKeys.map(key => {
                                  const sk = skillsEntries[key];
                                  if (!sk) return null;
                                  return (
                                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input
                                          type="text"
                                          value={sk.movement}
                                          onChange={e => setSkillEntry(key, 'movement', e.target.value)}
                                          style={{ ...compactInputStyle, flex: '1 1 140px', minWidth: 140 }}
                                        />
                                        <input
                                          type="number"
                                          placeholder="Sets"
                                          value={sk.sets ?? ''}
                                          onChange={e => setSkillEntry(key, 'sets', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 56 }}
                                        />
                                        <input
                                          type="number"
                                          placeholder="Reps"
                                          value={sk.reps_completed ?? ''}
                                          onChange={e => setSkillEntry(key, 'reps_completed', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 56 }}
                                        />
                                        <input
                                          type="number"
                                          placeholder="Hold (s)"
                                          value={sk.hold_seconds ?? ''}
                                          onChange={e => setSkillEntry(key, 'hold_seconds', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 72 }}
                                        />
                                        <select
                                          value={sk.quality ?? ''}
                                          onChange={e => setSkillEntry(key, 'quality', e.target.value || undefined)}
                                          style={{ ...compactInputStyle, width: 56, padding: '8px 4px' }}
                                        >
                                          <option value="">—</option>
                                          <option value="A">A</option>
                                          <option value="B">B</option>
                                          <option value="C">C</option>
                                          <option value="D">D</option>
                                        </select>
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="Variation / scaling note (optional)"
                                        value={sk.variation ?? ''}
                                        onChange={e => setSkillEntry(key, 'variation', e.target.value)}
                                        style={{ ...compactInputStyle, fontSize: 13 }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div className="field" style={{ marginTop: 8 }}>
                            <label>Notes</label>
                            <input
                              type="text"
                              placeholder="Optional, e.g. got 5 unbroken kipping"
                              value={blockScores[bi] ?? ''}
                              onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))}
                            />
                          </div>
                        </>
                      );
                    })()}

                    {(block.type === 'warm-up' || block.type === 'cool-down') && (
                      <div className="field" style={{ marginTop: 8 }}>
                        <label>Notes</label>
                        <input
                          type="text"
                          placeholder={
                            block.type === 'warm-up' ? 'Optional, e.g. subbed row for bike' :
                            'Optional, e.g. extra hip stretching'
                          }
                          value={blockScores[bi] ?? ''}
                          onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))}
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
