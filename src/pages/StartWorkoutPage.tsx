import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import { BlockContent } from '../components/WorkoutBlocksDisplay';
import {
  calculateBenchmarks,
  scoreMetcon,
  deriveTimeDomain,
  type MovementWorkRate,
  type BenchmarkResult,
} from '../lib/metconScoring';

interface Block {
  id: string;
  label: string;
  type: string;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed_tasks?: any[] | null;
}

interface EntryValues {
  reps?: number;
  weight?: number;
  weight_unit: 'lbs' | 'kg';
  rpe?: number;
  quality?: 'A' | 'B' | 'C' | 'D';
  set_number?: number;
}

interface MetconEntryValues {
  movement: string;
  category?: 'weighted' | 'bodyweight' | 'monostructural';
  reps?: number;
  weight?: number;
  weight_unit: 'lbs' | 'kg';
  distance?: number;
  distance_unit?: 'ft' | 'm' | 'cal';
  rpe?: number;
  quality?: 'A' | 'B' | 'C' | 'D';
  scaling_note?: string;
}

interface SkillsEntryValues {
  movement: string;
  sets?: number;
  reps_completed?: number;
  hold_seconds?: number;
  rpe?: number;
  quality?: 'A' | 'B' | 'C' | 'D';
  variation?: string;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  'warm-up': 'Warm-up',
  mobility: 'Mobility',
  skills: 'Skills',
  strength: 'Strength',
  metcon: 'Metcon',
  'cool-down': 'Cool Down',
};


function parseSetsReps(text: string): { sets?: number; reps?: number; perSetReps?: number[] } {
  // NxN format: "5x5", "3x10"
  const nxn = text.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (nxn) return { sets: parseInt(nxn[1], 10), reps: parseInt(nxn[2], 10) };
  // Dash-separated format: "5-5-3-3-1"
  const dash = text.match(/\b(\d+(?:\s*-\s*\d+){1,})\b/);
  if (dash) {
    const parts = dash[1].split(/\s*-\s*/).map(Number);
    return { sets: parts.length, perSetReps: parts };
  }
  return {};
}

function extractMovementName(text: string): string {
  return text
    .replace(/\d+\s*[x×]\s*\d+/i, '')
    .replace(/\b\d+(?:\s*-\s*\d+)+\b/, '')
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
      // Strip minute/round prefixes: "Min 1:", "Minute 2 —", "Odd —", "Even —"
      let trimmed = seg.trim();
      trimmed = trimmed.replace(/^(?:min(?:ute)?\s*\d+\s*[:\-–—]\s*|(?:odd|even)\s*[:\-–—]\s*)/i, '').trim();
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

/**
 * Merge entries that share the same movement name (e.g. 15-12-9 schemes
 * where the LLM returns separate entries per round). Sums reps/distance,
 * keeps weight and other fields from the first occurrence.
 */
function consolidateMovements(entries: MetconEntryValues[]): MetconEntryValues[] {
  const seen = new Map<string, number>(); // normalized name → index in result
  const result: MetconEntryValues[] = [];

  for (const entry of entries) {
    const key = entry.movement.toLowerCase().replace(/[^a-z0-9]/g, '');
    const idx = seen.get(key);
    if (idx !== undefined) {
      // Merge into existing entry
      const existing = result[idx];
      if (entry.reps && existing.reps) existing.reps += entry.reps;
      if (entry.distance && existing.distance) existing.distance += entry.distance;
    } else {
      seen.set(key, result.length);
      result.push({ ...entry });
    }
  }

  return result;
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

  // Strip leading rep scheme: "15-12-9 Power Cleans" → total reps, keep "Power Cleans"
  const schemeInline = text.match(/^(\d+(?:\s*-\s*\d+)+)\s+/);
  if (schemeInline) {
    const rounds = schemeInline[1].split(/\s*-\s*/).map(Number);
    reps = rounds.reduce((a, b) => a + b, 0);
    text = text.slice(schemeInline[0].length).trim();
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

// Normalize a movement name for fuzzy matching against coach review faults
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-\s'']/g, '').replace(/[^a-z0-9]/g, '');
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
  const workoutDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [workoutType, setWorkoutType] = useState('other');
  const [blockNotes, setBlockNotes] = useState<Record<number, string>>({});
  const [entryValues, setEntryValues] = useState<Record<string, EntryValues>>({});
  const [metconEntries, setMetconEntries] = useState<Record<string, MetconEntryValues>>({});
  const [skillsEntries, setSkillsEntries] = useState<Record<string, SkillsEntryValues>>({});
  const [workRates, setWorkRates] = useState<MovementWorkRate[]>([]);
  const [blockScores, setBlockScores] = useState<Record<number, string>>({});
  const [blockRx, setBlockRx] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [parsingSkills, setParsingSkills] = useState(false);
  const [parsingMetcon, setParsingMetcon] = useState(false);
  // Faults from cached coach review, keyed by entry key (e.g. "0-sk0", "1-m2")
  const [reviewFaults, setReviewFaults] = useState<Record<string, string[]>>({});
  const [checkedFaults, setCheckedFaults] = useState<Record<string, string[]>>({});

  // In-progress tracking: which blocks have been saved, and the parent log id
  const [inProgressLogId, setInProgressLogId] = useState<string | null>(null);
  const [savedBlocks, setSavedBlocks] = useState<Set<number>>(new Set());
  const [savingBlock, setSavingBlock] = useState<number | null>(null);
  const [userUnits, setUserUnits] = useState<'lbs' | 'kg'>('lbs');

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

      // Fetch blocks, work rates, and user units in parallel
      const [blocksRes, ratesRes, unitsRes] = await Promise.all([
        supabase
          .from('program_workout_blocks')
          .select('id, block_type, block_text, block_order, parsed_tasks')
          .eq('program_workout_id', sourceState.source_id!)
          .order('block_order'),
        supabase
          .from('movements')
          .select('canonical_name, display_name, work_rate, weight_degradation_rate, modality')
          .not('work_rate', 'is', null),
        supabase
          .from('athlete_profiles')
          .select('units')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ]);

      if (ratesRes.data) {
        setWorkRates(ratesRes.data as MovementWorkRate[]);
      }
      if (unitsRes.data?.units === 'kg') {
        setUserUnits('kg');
      }

      const { data, error: fetchErr } = blocksRes;

      if (fetchErr || !data || data.length === 0) {
        setError('Could not load workout blocks');
        setLoading(false);
        return;
      }

      const loaded: Block[] = data.map(row => ({
        id: row.id,
        label: BLOCK_TYPE_LABELS[row.block_type] || row.block_type,
        type: row.block_type,
        text: row.block_text,
        parsed_tasks: row.parsed_tasks as any[] | null,
      }));

      setBlocks(loaded);
      setWorkoutType(inferWorkoutType(loaded));

      // Pre-fill strength per-set entries
      const initial: Record<string, EntryValues> = {};
      loaded.forEach((b, bi) => {
        if (b.type === 'strength') {
          const { sets, reps, perSetReps } = parseSetsReps(b.text);
          const numSets = sets && sets > 0 ? sets : 1;
          for (let s = 0; s < numSets; s++) {
            initial[`${bi}-s${s}`] = {
              reps: perSetReps ? perSetReps[s] : reps,
              weight: undefined,
              weight_unit: 'lbs',
              rpe: undefined,
              set_number: s + 1,
            };
          }
        }
      });
      setEntryValues(initial);

      // Pre-fill metcon per-movement entries (LLM parse with lazy caching)
      const initialMetcon: Record<string, MetconEntryValues> = {};
      const metconBlocks = loaded
        .map((b, bi) => ({ block: b, bi }))
        .filter(({ block }) => block.type === 'metcon');

      const needsMetconParse = metconBlocks.some(({ block }) => !block.parsed_tasks?.length);
      if (needsMetconParse) setParsingMetcon(true);

      await Promise.all(
        metconBlocks.map(async ({ block, bi }) => {
          let movements: MetconEntryValues[];

          if (block.parsed_tasks && block.parsed_tasks.length > 0) {
            // Already cached in DB — use directly
            movements = (block.parsed_tasks as { movement: string; category?: string; reps: number | null; weight: number | null; weight_unit: string | null; distance: number | null; distance_unit: string | null }[]).map(m => ({
              movement: m.movement,
              category: (['weighted', 'bodyweight', 'monostructural'].includes(m.category || '') ? m.category : 'bodyweight') as MetconEntryValues['category'],
              reps: m.reps ?? undefined,
              weight: m.weight ?? undefined,
              weight_unit: (m.weight_unit === 'kg' ? 'kg' : 'lbs') as 'lbs' | 'kg',
              distance: m.distance ?? undefined,
              distance_unit: (['ft', 'm', 'cal'].includes(m.distance_unit || '') ? m.distance_unit : undefined) as MetconEntryValues['distance_unit'],
            }));
          } else {
            // Call LLM to parse, write result back to DB
            try {
              const { data: fnData, error: fnErr } = await supabase.functions.invoke('parse-metcon', {
                body: { block_text: block.text, block_id: block.id },
              });
              if (fnErr || !fnData?.movements) {
                console.error('parse-metcon failed:', fnErr);
                // Fallback to regex parser
                movements = parseMetconMovements(block.text);
              } else {
                movements = (fnData.movements as { movement: string; category?: string; reps: number | null; weight: number | null; weight_unit: string | null; distance: number | null; distance_unit: string | null }[]).map(m => ({
                  movement: m.movement,
                  category: (['weighted', 'bodyweight', 'monostructural'].includes(m.category || '') ? m.category : 'bodyweight') as MetconEntryValues['category'],
                  reps: m.reps ?? undefined,
                  weight: m.weight ?? undefined,
                  weight_unit: (m.weight_unit === 'kg' ? 'kg' : 'lbs') as 'lbs' | 'kg',
                  distance: m.distance ?? undefined,
                  distance_unit: (['ft', 'm', 'cal'].includes(m.distance_unit || '') ? m.distance_unit : undefined) as MetconEntryValues['distance_unit'],
                }));
              }
            } catch (e) {
              console.error('parse-metcon call error:', e);
              // Fallback to regex parser
              movements = parseMetconMovements(block.text);
            }
          }

          // Merge duplicate movements (e.g. 15-12-9 expanded per round → single entry with total reps)
          const consolidated = consolidateMovements(movements);
          consolidated.forEach((mv, mi) => {
            initialMetcon[`${bi}-m${mi}`] = mv;
          });
        }),
      );
      setMetconEntries(initialMetcon);
      if (needsMetconParse) setParsingMetcon(false);

      // Pre-fill skills per-movement entries (LLM parse with lazy caching)
      const initialSkills: Record<string, SkillsEntryValues> = {};
      const skillBlocks = loaded
        .map((b, bi) => ({ block: b, bi }))
        .filter(({ block }) => block.type === 'skills');

      const needsParse = skillBlocks.some(({ block }) => !block.parsed_tasks?.length);
      if (needsParse) setParsingSkills(true);

      await Promise.all(
        skillBlocks.map(async ({ block, bi }) => {
          let skills: SkillsEntryValues[];

          if (block.parsed_tasks && block.parsed_tasks.length > 0) {
            // Already cached in DB — use directly
            skills = block.parsed_tasks;
          } else {
            // Call LLM to parse, write result back to DB
            try {
              const { data: fnData, error: fnErr } = await supabase.functions.invoke('parse-skills', {
                body: { block_text: block.text, block_id: block.id },
              });
              if (fnErr || !fnData?.skills) {
                console.error('parse-skills failed:', fnErr);
                skills = [];
              } else {
                skills = (fnData.skills as { movement: string; sets: number | null; reps: number | null; hold_seconds: number | null; notes: string | null }[]).map(s => ({
                  movement: s.movement,
                  sets: s.sets ?? undefined,
                  reps_completed: s.reps ?? undefined,
                  hold_seconds: s.hold_seconds ?? undefined,
                }));
              }
            } catch (e) {
              console.error('parse-skills call error:', e);
              skills = [];
            }
          }

          skills.forEach((sk, si) => {
            initialSkills[`${bi}-sk${si}`] = sk;
          });
        }),
      );
      setSkillsEntries(initialSkills);
      if (needsParse) setParsingSkills(false);

      // Check for an existing in-progress workout log to resume
      {
        const { data: ipLog } = await supabase
          .from('workout_logs')
          .select('id')
          .eq('source_id', sourceState.source_id!)
          .eq('status', 'in_progress')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ipLog) {
          setInProgressLogId(ipLog.id);
          // Load previously saved blocks
          const { data: savedBlockRows } = await supabase
            .from('workout_log_blocks')
            .select('sort_order, block_type, block_label, block_text, score, rx, notes')
            .eq('log_id', ipLog.id)
            .order('sort_order');

          if (savedBlockRows && savedBlockRows.length > 0) {
            const savedSet = new Set<number>();
            for (const sb of savedBlockRows) {
              savedSet.add(sb.sort_order);
              // Restore notes
              if (sb.notes) {
                setBlockNotes(prev => ({ ...prev, [sb.sort_order]: sb.notes }));
              }
              // Restore score/rx for metcon blocks
              if (sb.block_type === 'metcon') {
                if (sb.score) setBlockScores(prev => ({ ...prev, [sb.sort_order]: sb.score }));
                setBlockRx(prev => ({ ...prev, [sb.sort_order]: sb.rx ?? true }));
              }
            }
            setSavedBlocks(savedSet);

            // Load previously saved entries to restore strength/metcon/skills values
            const { data: savedEntryRows } = await supabase
              .from('workout_log_entries')
              .select('block_label, movement, sets, reps, weight, weight_unit, rpe, set_number, reps_completed, hold_seconds, distance, distance_unit, quality, variation, faults_observed, sort_order')
              .eq('log_id', ipLog.id)
              .order('sort_order');

            if (savedEntryRows && savedEntryRows.length > 0) {
              const restoredEntries: Record<string, EntryValues> = { ...initial };
              const restoredMetcon: Record<string, MetconEntryValues> = { ...initialMetcon };
              const restoredSkills: Record<string, SkillsEntryValues> = { ...initialSkills };

              // Group entries by block_label to figure out which block index they belong to
              for (const entry of savedEntryRows) {
                const bi = loaded.findIndex(b => b.label === entry.block_label);
                if (bi < 0) continue;
                const block = loaded[bi];

                if (block.type === 'strength' && entry.set_number != null) {
                  const key = `${bi}-s${entry.set_number - 1}`;
                  restoredEntries[key] = {
                    reps: entry.reps ?? undefined,
                    weight: entry.weight ?? undefined,
                    weight_unit: (entry.weight_unit as 'lbs' | 'kg') || 'lbs',
                    rpe: entry.rpe ?? undefined,
                    quality: (entry.quality as EntryValues['quality']) ?? undefined,
                    set_number: entry.set_number,
                  };
                } else if (block.type === 'metcon') {
                  const key = `${bi}-m${entry.sort_order}`;
                  restoredMetcon[key] = {
                    movement: entry.movement,
                    reps: entry.reps ?? undefined,
                    weight: entry.weight ?? undefined,
                    weight_unit: (entry.weight_unit as 'lbs' | 'kg') || 'lbs',
                    distance: entry.distance ?? undefined,
                    distance_unit: (entry.distance_unit as MetconEntryValues['distance_unit']) ?? undefined,
                    rpe: entry.rpe ?? undefined,
                    quality: (entry.quality as MetconEntryValues['quality']) ?? undefined,
                  };
                } else if (block.type === 'skills') {
                  const key = `${bi}-sk${entry.sort_order}`;
                  restoredSkills[key] = {
                    movement: entry.movement,
                    sets: entry.sets ?? undefined,
                    reps_completed: entry.reps_completed ?? undefined,
                    hold_seconds: entry.hold_seconds ?? undefined,
                    rpe: entry.rpe ?? undefined,
                    quality: (entry.quality as SkillsEntryValues['quality']) ?? undefined,
                    variation: entry.variation ?? undefined,
                  };
                }
              }

              setEntryValues(restoredEntries);
              setMetconEntries(restoredMetcon);
              setSkillsEntries(restoredSkills);
            }
          }
        }
      }

      // Fetch cached coach review to get common_faults per movement
      const { data: reviewRow } = await supabase
        .from('workout_reviews')
        .select('review')
        .eq('source_id', sourceState.source_id!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (reviewRow?.review) {
        const review = reviewRow.review as { blocks?: { block_type: string; cues_and_faults: { movement: string; common_faults: string[] }[] }[] };
        const faultsMap: Record<string, string[]> = {};

        // Build a lookup of normalized movement name → faults from the review
        const reviewFaultsByName: { norm: string; faults: string[] }[] = [];
        for (const rb of review.blocks ?? []) {
          for (const cf of rb.cues_and_faults ?? []) {
            if (cf.common_faults?.length > 0) {
              reviewFaultsByName.push({ norm: normalizeName(cf.movement), faults: cf.common_faults });
            }
          }
        }

        // Match review faults to entry keys by movement name
        const matchFaults = (movement: string): string[] => {
          const n = normalizeName(movement);
          for (const rf of reviewFaultsByName) {
            if (rf.norm === n || rf.norm.includes(n) || n.includes(rf.norm)) return rf.faults;
          }
          return [];
        };

        for (const [key, sk] of Object.entries(initialSkills)) {
          const f = matchFaults(sk.movement);
          if (f.length > 0) faultsMap[key] = f;
        }
        for (const [key, mv] of Object.entries(initialMetcon)) {
          const f = matchFaults(mv.movement);
          if (f.length > 0) faultsMap[key] = f;
        }
        // Strength: match by extracted movement name per block
        loaded.forEach((b, bi) => {
          if (b.type === 'strength') {
            const moveName = extractMovementName(b.text);
            const f = matchFaults(moveName);
            if (f.length > 0) faultsMap[`${bi}-str`] = f;
          }
        });

        setReviewFaults(faultsMap);
      }

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

  const toggleFault = (entryKey: string, fault: string) => {
    setCheckedFaults(prev => {
      const current = prev[entryKey] ?? [];
      const next = current.includes(fault)
        ? current.filter(f => f !== fault)
        : [...current, fault];
      return { ...prev, [entryKey]: next };
    });
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

  /** Build a single block's log payload from current form state */
  const buildBlockPayload = (bi: number) => {
    const b = blocks[bi];
    if (!b) return null;

    let entries: any[] = [];
    let score: string | null = null;
    let rx = false;

    if (b.type === 'strength') {
      const movementName = extractMovementName(b.text);
      const setKeys = Object.keys(entryValues)
        .filter(k => k.startsWith(`${bi}-s`))
        .sort((a, b2) => parseInt(a.split('-s')[1], 10) - parseInt(b2.split('-s')[1], 10));
      const strFaults = checkedFaults[`${bi}-str`];
      entries = setKeys.map(key => {
        const ev = entryValues[key] || {};
        return {
          movement: movementName,
          sets: 1,
          reps: ev.reps ?? null,
          weight: ev.weight ?? null,
          weight_unit: ev.weight_unit || userUnits,
          rpe: ev.rpe ?? null,
          scaling_note: null,
          set_number: ev.set_number ?? null,
          reps_completed: null,
          hold_seconds: null,
          distance: null,
          distance_unit: null,
          quality: ev.quality ?? null,
          variation: null,
          faults_observed: strFaults?.length ? strFaults : null,
        };
      });
    } else if (b.type === 'metcon') {
      const mvKeys = Object.keys(metconEntries)
        .filter(k => k.startsWith(`${bi}-m`))
        .sort((a, b2) => parseInt(a.split('-m')[1], 10) - parseInt(b2.split('-m')[1], 10));
      entries = mvKeys
        .filter(key => metconEntries[key]?.movement?.trim())
        .map(key => {
          const mv = metconEntries[key];
          const f = checkedFaults[key];
          return {
            movement: mv.movement.trim(),
            sets: null,
            reps: mv.reps ?? null,
            weight: mv.weight ?? null,
            weight_unit: mv.weight_unit || userUnits,
            rpe: mv.rpe ?? null,
            scaling_note: mv.scaling_note?.trim() || null,
            set_number: null,
            reps_completed: null,
            hold_seconds: null,
            distance: mv.distance ?? null,
            distance_unit: mv.distance_unit || null,
            quality: mv.quality ?? null,
            variation: null,
            faults_observed: f?.length ? f : null,
          };
        });
      score = blockScores[bi]?.trim() || null;
      rx = blockRx[bi] ?? true;
    } else if (b.type === 'skills') {
      const skKeys = Object.keys(skillsEntries)
        .filter(k => k.startsWith(`${bi}-sk`))
        .sort((a, b2) => parseInt(a.split('-sk')[1], 10) - parseInt(b2.split('-sk')[1], 10));
      entries = skKeys
        .filter(key => skillsEntries[key]?.movement?.trim())
        .map(key => {
          const sk = skillsEntries[key];
          const f = checkedFaults[key];
          return {
            movement: sk.movement.trim(),
            sets: sk.sets ?? null,
            reps: null,
            weight: null,
            weight_unit: 'lbs',
            rpe: sk.rpe ?? null,
            scaling_note: sk.variation?.trim() || null,
            set_number: null,
            reps_completed: sk.reps_completed ?? null,
            hold_seconds: sk.hold_seconds ?? null,
            distance: null,
            distance_unit: null,
            quality: sk.quality ?? null,
            variation: sk.variation?.trim() || null,
            faults_observed: f?.length ? f : null,
          };
        });
    }

    // Compute scoring for metcon blocks
    const benchmarks = blockBenchmarks[bi];
    const scoreStr = blockScores[bi]?.trim() || '';
    const wType = inferWorkoutType([b]);
    const scoring = b.type === 'metcon' && benchmarks && scoreStr
      ? scoreMetcon(scoreStr, wType, benchmarks)
      : null;

    return {
      label: b.label,
      type: b.type,
      text: b.text,
      score,
      rx,
      notes: blockNotes[bi]?.trim() || null,
      sort_order: bi,
      entries,
      percentile: scoring?.percentile ?? null,
      performance_tier: scoring?.performanceTier ?? null,
      median_benchmark: benchmarks?.medianScore !== '--' ? benchmarks?.medianScore : null,
      excellent_benchmark: benchmarks?.excellentScore !== '--' ? benchmarks?.excellentScore : null,
      time_domain: b.type === 'metcon'
        ? deriveTimeDomain(wType, b.text, benchmarks?.medianScore ?? null)
        : null,
    };
  };

  /** Save a single block (creates in-progress log if needed) */
  const saveBlock = async (bi: number) => {
    const payload = buildBlockPayload(bi);
    if (!payload) return;
    setSavingBlock(bi);
    try {
      const workoutText = sourceState?.workout_text?.trim() ||
        blocks.map(b => `${b.label}: ${b.text}`).join('\n');
      const { data, error: fnErr } = await supabase.functions.invoke('save-workout-block', {
        body: {
          log_id: inProgressLogId,
          source_id: sourceState?.source_id || null,
          workout_date: workoutDate,
          workout_text: workoutText,
          workout_type: workoutType,
          block: payload,
        },
      });
      if (fnErr) throw new Error(fnErr.message || 'Failed to save block');
      if (data?.error) throw new Error(data.error);
      // Track the log id for subsequent saves
      if (data?.log_id && !inProgressLogId) {
        setInProgressLogId(data.log_id);
      }
      setSavedBlocks(prev => new Set(prev).add(bi));
      // Auto-complete: all loggable blocks saved → workout is done
      if (data?.auto_completed) {
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save block');
    } finally {
      setSavingBlock(null);
    }
  };

  /** Save all current progress and navigate away */
  const handleSaveAndExit = async () => {
    setError('');
    setSaving(true);
    try {
      // Save any unsaved blocks (skip warm-up/cool-down)
      for (let bi = 0; bi < blocks.length; bi++) {
        if (savedBlocks.has(bi)) continue;
        if (blocks[bi].type === 'warm-up' || blocks[bi].type === 'mobility' || blocks[bi].type === 'cool-down') continue;
        const payload = buildBlockPayload(bi);
        if (!payload) continue;
        const workoutText = sourceState?.workout_text?.trim() ||
          blocks.map(b => `${b.label}: ${b.text}`).join('\n');
        const { data, error: fnErr } = await supabase.functions.invoke('save-workout-block', {
          body: {
            log_id: inProgressLogId,
            source_id: sourceState?.source_id || null,
            workout_date: workoutDate,
            workout_text: workoutText,
            workout_type: workoutType,
            block: payload,
          },
        });
        if (fnErr) throw new Error(fnErr.message || 'Failed to save');
        if (data?.error) throw new Error(data.error);
        if (data?.log_id && !inProgressLogId) {
          setInProgressLogId(data.log_id);
        }
        // Auto-complete: all loggable blocks saved → workout is done
        if (data?.auto_completed) {
          setSuccess(true);
          setSaving(false);
          return;
        }
      }
      navigate(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save progress');
    } finally {
      setSaving(false);
    }
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
          const strFaults = checkedFaults[`${bi}-str`];
          const entries = setKeys.map(key => {
            const ev = entryValues[key] || {};
            return {
              movement: movementName,
              sets: 1,
              reps: ev.reps ?? null,
              weight: ev.weight ?? null,
              weight_unit: ev.weight_unit || userUnits,
              rpe: ev.rpe ?? null,
              scaling_note: null,
              set_number: ev.set_number ?? null,
              reps_completed: null,
              hold_seconds: null,
              distance: null,
              distance_unit: null,
              quality: ev.quality ?? null,
              variation: null,
              faults_observed: strFaults?.length ? strFaults : null,
            };
          });
          return {
            label: b.label,
            type: b.type,
            text: b.text,
            score: blockScores[bi]?.trim() || null,
            rx: false,
            notes: blockNotes[bi]?.trim() || null,
            entries,
          };
        }

        if (b.type === 'metcon') {
          const mvKeys = Object.keys(metconEntries)
            .filter(k => k.startsWith(`${bi}-m`))
            .sort((a, b2) => parseInt(a.split('-m')[1], 10) - parseInt(b2.split('-m')[1], 10));
          const entries = mvKeys
            .filter(key => metconEntries[key]?.movement?.trim())
            .map(key => {
              const mv = metconEntries[key];
              const f = checkedFaults[key];
              return {
                movement: mv.movement.trim(),
                sets: null,
                reps: mv.reps ?? null,
                weight: mv.weight ?? null,
                weight_unit: mv.weight_unit || userUnits,
                rpe: mv.rpe ?? null,
                scaling_note: mv.scaling_note?.trim() || null,
                set_number: null,
                reps_completed: null,
                hold_seconds: null,
                distance: mv.distance ?? null,
                distance_unit: mv.distance_unit || null,
                quality: mv.quality ?? null,
                variation: null,
                faults_observed: f?.length ? f : null,
              };
            });

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
            rx: blockRx[bi] ?? true,
            notes: blockNotes[bi]?.trim() || null,
            entries,
            percentile: scoring?.percentile ?? null,
            performance_tier: scoring?.performanceTier ?? null,
            median_benchmark: benchmarks?.medianScore !== '--' ? benchmarks?.medianScore : null,
            excellent_benchmark: benchmarks?.excellentScore !== '--' ? benchmarks?.excellentScore : null,
            time_domain: deriveTimeDomain(wType, b.text, benchmarks?.medianScore ?? null),
          };
        }

        if (b.type === 'skills') {
          const skKeys = Object.keys(skillsEntries)
            .filter(k => k.startsWith(`${bi}-sk`))
            .sort((a, b2) => parseInt(a.split('-sk')[1], 10) - parseInt(b2.split('-sk')[1], 10));
          const entries = skKeys
            .filter(key => skillsEntries[key]?.movement?.trim())
            .map(key => {
              const sk = skillsEntries[key];
              const f = checkedFaults[key];
              return {
                movement: sk.movement.trim(),
                sets: sk.sets ?? null,
                reps: null,
                weight: null,
                weight_unit: 'lbs' as const,
                rpe: sk.rpe ?? null,
                scaling_note: sk.variation?.trim() || null,
                set_number: null,
                reps_completed: sk.reps_completed ?? null,
                hold_seconds: sk.hold_seconds ?? null,
                distance: null,
                distance_unit: null,
                quality: sk.quality ?? null,
                variation: sk.variation?.trim() || null,
                faults_observed: f?.length ? f : null,
              };
            });
          return {
            label: b.label,
            type: b.type,
            text: b.text,
            score: null,
            rx: false,
            notes: blockNotes[bi]?.trim() || null,
            entries,
          };
        }

        // All other block types (warm-up, cool-down, etc.): no per-movement entries
        return {
          label: b.label,
          type: b.type,
          text: b.text,
          score: null,
          rx: blockRx[bi] ?? true,
          notes: blockNotes[bi]?.trim() || null,
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
          notes: null,
          blocks: logBlocks,
          status: 'completed',
          existing_log_id: inProgressLogId,
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
          <h1>{inProgressLogId ? 'Resume Workout' : 'Start Workout'}</h1>
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
                  <div className="field">
                    <label>Date</label>
                    <div style={{ fontSize: 16, padding: '10px 0' }}>
                      {new Date(workoutDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                </div>

                {blocks.map((block, bi) => {
                  const locked = savedBlocks.has(bi);
                  return (
                  <div key={bi} className={'workout-review-section' + (locked ? ' block-locked' : '')} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h3>
                        {block.label}
                      </h3>
                      {locked && (
                        <button
                          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}
                          onClick={() => setSavedBlocks(prev => { const next = new Set(prev); next.delete(bi); return next; })}
                        >
                          Edit
                        </button>
                      )}
                    </div>
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
                            <span style={{ width: 64 }}>Wt</span>
                            <span style={{ width: 28 }}></span>
                            <span style={{ width: 48 }}>RPE</span>
                            <span style={{ width: 48 }}>Quality</span>
                          </div>
                          {setKeys.map(key => {
                            const ev = entryValues[key] || {};
                            return (
                              <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 28, textAlign: 'right' }}>S{ev.set_number}</span>
                                <input type="number" placeholder="Reps" value={ev.reps ?? ''} onChange={e => setEntry(key, 'reps', e.target.value ? parseInt(e.target.value, 10) : undefined)} style={{ ...compactInputStyle, width: 60 }} />
                                <input type="number" placeholder="" value={ev.weight ?? ''} onChange={e => setEntry(key, 'weight', e.target.value ? parseFloat(e.target.value) : undefined)} style={{ ...compactInputStyle, width: 64, border: ev.weight == null ? '1px solid var(--accent)' : '1px solid var(--border)' }} />
                                <span style={{ color: 'var(--text-dim)', fontSize: 13, width: 28 }}>{ev.weight_unit || userUnits}</span>
                                <select value={ev.rpe ?? ''} onChange={e => setEntry(key, 'rpe', e.target.value ? parseInt(e.target.value, 10) : undefined)} style={{ ...compactInputStyle, width: 48, padding: '8px 4px', border: ev.rpe == null ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                                  <option value=""></option>
                                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                                <select value={ev.quality ?? ''} onChange={e => setEntry(key, 'quality', e.target.value || undefined)} style={{ ...compactInputStyle, width: 48, padding: '8px 4px', border: ev.quality == null ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                                  <option value=""></option>
                                  <option value="A">A</option>
                                  <option value="B">B</option>
                                  <option value="C">C</option>
                                  <option value="D">D</option>
                                </select>
                              </div>
                            );
                          })}
                          {reviewFaults[`${bi}-str`] && reviewFaults[`${bi}-str`].length > 0 && (
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingLeft: 40, marginTop: 6 }}>
                              {reviewFaults[`${bi}-str`].map(fault => (
                                <label key={fault} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: (checkedFaults[`${bi}-str`] ?? []).includes(fault) ? 'var(--danger, #e74c3c)' : 'var(--text-dim)', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={(checkedFaults[`${bi}-str`] ?? []).includes(fault)} onChange={() => toggleFault(`${bi}-str`, fault)} style={{ accentColor: 'var(--danger, #e74c3c)' }} />
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                  {fault}
                                </label>
                              ))}
                            </div>
                          )}
                          <div className="field" style={{ marginTop: 8 }}>
                            <label>Notes</label>
                            <input
                              type="text"
                              placeholder=""
                              value={blockNotes[bi] ?? ''}
                              onChange={e => setBlockNotes(prev => ({ ...prev, [bi]: e.target.value }))}
                            />
                          </div>
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
                            <input type="checkbox" id={`rx-${bi}`} checked={blockRx[bi] ?? true} onChange={e => setBlockRx(prev => ({ ...prev, [bi]: e.target.checked }))} />
                            <label htmlFor={`rx-${bi}`} style={{ fontSize: 14, color: 'var(--text-dim)' }}>Rx</label>
                          </div>
                          <div className="field" style={{ marginBottom: 16 }}>
                            <label>Score</label>
                            <input type="text" placeholder="e.g. 4:48 or 8+12" value={blockScores[bi] ?? ''} onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))} />
                          </div>

                          {parsingMetcon && mvKeys.length === 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Parsing movements…</div>
                            </div>
                          )}
                          {mvKeys.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Movements (confirm or adjust)</div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                                <span style={{ width: 64 }}>Reps</span>
                                <span style={{ width: 28 }}></span>
                                {mvKeys.some(k => metconEntries[k] && (metconEntries[k].category || 'bodyweight') === 'weighted') && (
                                  <>
                                    <span style={{ width: 64 }}>Wt</span>
                                    <span style={{ width: 28 }}></span>
                                  </>
                                )}
                                <span style={{ width: 56 }}>Quality</span>
                                <span style={{ width: 56 }}>RPE</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {mvKeys.map(key => {
                                  const mv = metconEntries[key];
                                  if (!mv) return null;
                                  const cat = mv.category || 'bodyweight';
                                  const isMonostructural = cat === 'monostructural';
                                  const isWeighted = cat === 'weighted';
                                  const hasDistance = isMonostructural && (mv.distance != null && mv.distance > 0);
                                  const hasCalories = isMonostructural && mv.distance_unit === 'cal';
                                  const hasAnyWeighted = mvKeys.some(k => metconEntries[k] && (metconEntries[k].category || 'bodyweight') === 'weighted');
                                  return (
                                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <input
                                        type="text"
                                        value={mv.movement}
                                        onChange={e => setMetconEntry(key, 'movement', e.target.value)}
                                        style={{ ...compactInputStyle, width: '100%' }}
                                      />
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {hasDistance && !hasCalories ? (
                                          <>
                                            <input
                                              type="number"
                                              placeholder="Dist"
                                              value={mv.distance ?? ''}
                                              onChange={e => setMetconEntry(key, 'distance', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                              style={{ ...compactInputStyle, width: 64 }}
                                            />
                                            <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 28 }}>{mv.distance_unit || 'm'}</span>
                                          </>
                                        ) : (
                                          <>
                                            <input
                                              type="number"
                                              placeholder={hasCalories ? 'Cal' : ''}
                                              value={mv.reps ?? ''}
                                              onChange={e => setMetconEntry(key, 'reps', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                              style={{ ...compactInputStyle, width: 64 }}
                                            />
                                            <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 28 }}></span>
                                          </>
                                        )}
                                        {hasAnyWeighted && (
                                          isWeighted ? (
                                            <>
                                              <input
                                                type="number"
                                                placeholder=""
                                                value={mv.weight ?? ''}
                                                onChange={e => setMetconEntry(key, 'weight', e.target.value ? parseFloat(e.target.value) : undefined)}
                                                style={{ ...compactInputStyle, width: 64 }}
                                              />
                                              <span style={{ fontSize: 13, color: 'var(--text-dim)', width: 28 }}>{mv.weight_unit || userUnits}</span>
                                            </>
                                          ) : (
                                            <>
                                              <span style={{ width: 64 }}></span>
                                              <span style={{ width: 28 }}></span>
                                            </>
                                          )
                                        )}
                                        <select
                                          value={mv.quality ?? ''}
                                          onChange={e => setMetconEntry(key, 'quality', e.target.value || undefined)}
                                          style={{ ...compactInputStyle, width: 56, padding: '8px 4px', border: mv.quality == null ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                                        >
                                          <option value=""></option>
                                          <option value="A">A</option>
                                          <option value="B">B</option>
                                          <option value="C">C</option>
                                          <option value="D">D</option>
                                        </select>
                                        <select
                                          value={mv.rpe ?? ''}
                                          onChange={e => setMetconEntry(key, 'rpe', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 56, padding: '8px 4px', border: mv.rpe == null ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                                        >
                                          <option value=""></option>
                                          {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                      </div>
                                      {reviewFaults[key] && reviewFaults[key].length > 0 && (
                                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingLeft: 4, marginTop: 2 }}>
                                          {reviewFaults[key].map(fault => (
                                            <label key={fault} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: (checkedFaults[key] ?? []).includes(fault) ? 'var(--danger, #e74c3c)' : 'var(--text-dim)', cursor: 'pointer' }}>
                                              <input type="checkbox" checked={(checkedFaults[key] ?? []).includes(fault)} onChange={() => toggleFault(key, fault)} style={{ accentColor: 'var(--danger, #e74c3c)' }} />
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                              {fault}
                                            </label>
                                          ))}
                                        </div>
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
                          <div className="field" style={{ marginTop: 12 }}>
                            <label>Notes</label>
                            <input
                              type="text"
                              placeholder=""
                              value={blockNotes[bi] ?? ''}
                              onChange={e => setBlockNotes(prev => ({ ...prev, [bi]: e.target.value }))}
                            />
                          </div>
                        </>
                      );
                    })()}

                    {block.type === 'skills' && (() => {
                      const skKeys = Object.keys(skillsEntries)
                        .filter(k => k.startsWith(`${bi}-sk`))
                        .sort((a, b2) => parseInt(a.split('-sk')[1], 10) - parseInt(b2.split('-sk')[1], 10));

                      return (
                        <>
                          {parsingSkills && skKeys.length === 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Parsing skill movements…</div>
                            </div>
                          )}
                          {skKeys.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Skill movements (confirm or adjust)</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {skKeys.map(key => {
                                  const sk = skillsEntries[key];
                                  if (!sk) return null;
                                  return (
                                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <input
                                        type="text"
                                        value={sk.movement}
                                        onChange={e => setSkillEntry(key, 'movement', e.target.value)}
                                        style={{ ...compactInputStyle, width: '100%' }}
                                      />
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
                                        <span style={{ width: 48 }}>Sets</span>
                                        <span style={{ width: 48 }}>Reps</span>
                                        <span style={{ width: 60 }}>Hold (s)</span>
                                        <span style={{ width: 48 }}>Quality</span>
                                        <span style={{ width: 48 }}>RPE</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input
                                          type="number"
                                          placeholder=""
                                          value={sk.sets ?? ''}
                                          onChange={e => setSkillEntry(key, 'sets', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 48 }}
                                        />
                                        <input
                                          type="number"
                                          placeholder=""
                                          value={sk.reps_completed ?? ''}
                                          onChange={e => setSkillEntry(key, 'reps_completed', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 48 }}
                                        />
                                        <input
                                          type="number"
                                          placeholder=""
                                          value={sk.hold_seconds ?? ''}
                                          onChange={e => setSkillEntry(key, 'hold_seconds', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 60 }}
                                        />
                                        <select
                                          value={sk.quality ?? ''}
                                          onChange={e => setSkillEntry(key, 'quality', e.target.value || undefined)}
                                          style={{ ...compactInputStyle, width: 48, padding: '8px 4px', border: sk.quality == null ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                                        >
                                          <option value=""></option>
                                          <option value="A">A</option>
                                          <option value="B">B</option>
                                          <option value="C">C</option>
                                          <option value="D">D</option>
                                        </select>
                                        <select
                                          value={sk.rpe ?? ''}
                                          onChange={e => setSkillEntry(key, 'rpe', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          style={{ ...compactInputStyle, width: 48, padding: '8px 4px', border: sk.rpe == null ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                                        >
                                          <option value=""></option>
                                          {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                      </div>
                                      {reviewFaults[key] && reviewFaults[key].length > 0 && (
                                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingLeft: 4, marginTop: 2 }}>
                                          {reviewFaults[key].map(fault => (
                                            <label key={fault} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: (checkedFaults[key] ?? []).includes(fault) ? 'var(--danger, #e74c3c)' : 'var(--text-dim)', cursor: 'pointer' }}>
                                              <input type="checkbox" checked={(checkedFaults[key] ?? []).includes(fault)} onChange={() => toggleFault(key, fault)} style={{ accentColor: 'var(--danger, #e74c3c)' }} />
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                              {fault}
                                            </label>
                                          ))}
                                        </div>
                                      )}
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
                              placeholder=""
                              value={blockNotes[bi] ?? ''}
                              onChange={e => setBlockNotes(prev => ({ ...prev, [bi]: e.target.value }))}
                            />
                          </div>
                        </>
                      );
                    })()}

                    {(block.type === 'warm-up' || block.type === 'mobility' || block.type === 'cool-down') && (
                      <div className="field" style={{ marginTop: 8 }}>
                        <label>Notes</label>
                        <input
                          type="text"
                          placeholder=""
                          value={blockNotes[bi] ?? ''}
                          onChange={e => setBlockNotes(prev => ({ ...prev, [bi]: e.target.value }))}
                        />
                      </div>
                    )}

                    {/* Per-block save button (not for warm-up/cool-down) */}
                    {block.type !== 'warm-up' && block.type !== 'mobility' && block.type !== 'cool-down' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                      <button
                        className="auth-btn"
                        style={{
                          padding: '6px 16px',
                          fontSize: 13,
                          background: savedBlocks.has(bi) ? 'var(--surface2)' : undefined,
                          color: savedBlocks.has(bi) ? 'var(--text-dim)' : undefined,
                        }}
                        onClick={() => saveBlock(bi)}
                        disabled={savingBlock === bi}
                      >
                        {savingBlock === bi
                          ? 'Saving...'
                          : savedBlocks.has(bi)
                          ? 'Saved'
                          : 'Save Block'}
                      </button>
                    </div>
                    )}
                  </div>
                  );
                })}

                {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

                <div className="sw-bottom-actions" style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <button className="auth-btn" style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate(-1)}>
                    Back
                  </button>
                  <button className="auth-btn" onClick={handleSaveAndExit} disabled={saving} style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)' }}>
                    {saving ? 'Saving...' : 'Save & Exit'}
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
