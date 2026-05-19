import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { localDateString } from '../lib/localDate';
import Nav from '../components/Nav';
import { BlockContent } from '../components/WorkoutBlocksDisplay';
import {
  calculateBenchmarks,
  calculateBenchmarksLocal,
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
  // v3-only structured metadata. Surfaced as chips above the prescription.
  // v1 blocks leave these null and fall back to prose-only rendering.
  scheme?: string | null;
  timeCapSeconds?: number | null;
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

interface AccessoryEntryValues {
  movement: string;
  sets?: number;
  reps_completed?: number;
  weight?: number;
  weight_unit?: 'lbs' | 'kg';
  hold_seconds?: number;
  distance?: number;
  distance_unit?: 'm' | 'ft';
  rpe?: number;
  notes?: string;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  'warm-up': 'Warm-up & Mobility',
  mobility: 'Mobility',
  skills: 'Skills',
  strength: 'Strength',
  accessory: 'Accessory',
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
    // v3 blocks put structural metadata ("EMOM 15", "AMRAP 12", "4 rounds for
    // time") in b.scheme rather than b.text. Combine both so the regexes catch.
    const combined = [metcon.scheme, metcon.text].filter(Boolean).join('\n').toUpperCase();
    if (/AMRAP|AS MANY ROUNDS/.test(combined)) return 'amrap';
    if (/EMOM|E\d+MOM/.test(combined)) return 'emom';
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
  const [workoutDate, setWorkoutDate] = useState<string>(() => localDateString());
  const [workoutType, setWorkoutType] = useState('other');
  const [blockNotes, setBlockNotes] = useState<Record<number, string>>({});
  const [entryValues, setEntryValues] = useState<Record<string, EntryValues>>({});
  const [metconEntries, setMetconEntries] = useState<Record<string, MetconEntryValues>>({});
  const [skillsEntries, setSkillsEntries] = useState<Record<string, SkillsEntryValues>>({});
  const [accessoryEntries, setAccessoryEntries] = useState<Record<string, AccessoryEntryValues>>({});
  const [workRates, setWorkRates] = useState<MovementWorkRate[]>([]);
  const [blockScores, setBlockScores] = useState<Record<number, string>>({});
  const [blockRx, setBlockRx] = useState<Record<number, boolean>>({});
  const [blockCapped, setBlockCapped] = useState<Record<number, boolean>>({});
  const [blockCappedReps, setBlockCappedReps] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [parsingSkills, setParsingSkills] = useState(false);
  const [parsingAccessories, setParsingAccessories] = useState(false);
  const [parsingMetcon, setParsingMetcon] = useState(false);
  // Faults from cached coach review, keyed by entry key (e.g. "0-sk0", "1-m2")
  const [reviewFaults, setReviewFaults] = useState<Record<string, string[]>>({});
  const [checkedFaults, setCheckedFaults] = useState<Record<string, string[]>>({});

  // In-progress tracking: which blocks have been saved, and the parent log id
  const [inProgressLogId, setInProgressLogId] = useState<string | null>(null);
  const [savedBlocks, setSavedBlocks] = useState<Set<number>>(new Set());
  const [savingBlock, setSavingBlock] = useState<number | null>(null);
  // Per-movement skip tracking. Key conventions match the existing entry maps:
  //   strength  → `${bi}-strength`   (one toggle per block; covers all sets)
  //   skills    → `${bi}-sk${i}`
  //   accessory → `${bi}-ac${i}`
  //   metcon    → `${bi}-m${i}`
  const [skippedKeys, setSkippedKeys] = useState<Record<string, boolean>>({});
  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  // In edit mode the source_id is resolved from the log being edited rather
  // than passed via location.state. Cached so save paths can read it later.
  const [resolvedSourceId, setResolvedSourceId] = useState<string | null>(null);
  const [userUnits, setUserUnits] = useState<'lbs' | 'kg'>('lbs');

  const sourceState = location.state as {
    workout_text?: string;
    source_id?: string;
    edit_log_id?: string;
  } | null;
  const isEditMode = !!sourceState?.edit_log_id;

  // Fetch blocks from program_workout_blocks on mount
  useEffect(() => {
    if (!sourceState?.source_id && !sourceState?.edit_log_id) {
      setLoading(false);
      setError('No workout selected');
      return;
    }

    (async () => {
      setLoading(true);

      // Edit mode: resolve source_id from the existing log first so the rest
      // of the load flow (fetch program blocks, restore state) works the same.
      let localSourceId = sourceState.source_id ?? null;
      if (sourceState.edit_log_id) {
        const { data: editLog, error: editLogErr } = await supabase
          .from('workout_logs')
          .select('id, source_id, workout_text, workout_date')
          .eq('id', sourceState.edit_log_id)
          .maybeSingle();
        if (editLogErr || !editLog) {
          setError('Could not load workout to edit');
          setLoading(false);
          return;
        }
        if (!editLog.source_id) {
          setError('This workout cannot be edited (no program reference)');
          setLoading(false);
          return;
        }
        if (!localSourceId) localSourceId = editLog.source_id;
        // Preserve the original log date so saves don't silently move the
        // workout to today's calendar slot.
        if (editLog.workout_date) setWorkoutDate(editLog.workout_date);
        setInProgressLogId(editLog.id);
      }
      setResolvedSourceId(localSourceId);

      // Fetch blocks, work rates, and user units in parallel
      const [blocksRes, ratesRes, unitsRes] = await Promise.all([
        supabase
          .from('program_workout_blocks')
          .select('id, block_type, block_text, block_order, parsed_tasks')
          .eq('program_workout_id', localSourceId!)
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
      let loaded: Block[];

      if (!fetchErr && data && data.length > 0) {
        // v1 path — block_text already prose in program_workout_blocks.
        loaded = data.map(row => ({
          id: row.id,
          label: BLOCK_TYPE_LABELS[row.block_type] || row.block_type,
          type: row.block_type,
          text: row.block_text,
          parsed_tasks: row.parsed_tasks as any[] | null,
        }));
      } else {
        // v3 fallback — reconstruct block_text + parsed_tasks from
        // program_blocks_v2 + program_movements_v2. v1 had a parse step
        // (extract-movements-ai); v3 movements are already structured,
        // so we can populate parsed_tasks directly from them.
        const { data: v3Blocks } = await supabase
          .from('program_blocks_v2')
          .select('id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, sort_order')
          .eq('program_workout_id', localSourceId!)
          .order('sort_order');
        if (!v3Blocks || v3Blocks.length === 0) {
          setError('Could not load workout blocks');
          setLoading(false);
          return;
        }
        const blockIds = v3Blocks.map((b: any) => b.id);
        const { data: v3Movs } = await supabase
          .from('program_movements_v2')
          .select('block_id, movement, sets, reps, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, sort_order')
          .in('block_id', blockIds)
          .order('sort_order');
        const movsByBlock = new Map<string, any[]>();
        for (const m of v3Movs ?? []) {
          const arr = movsByBlock.get((m as any).block_id) ?? [];
          arr.push(m);
          movsByBlock.set((m as any).block_id, arr);
        }
        const fmtMv = (m: any) => {
          const parts: string[] = [];
          if (m.sets != null && m.reps != null) parts.push(`${m.sets}×${m.reps}`);
          else if (m.sets != null) parts.push(`${m.sets} sets`);
          else if (m.reps != null) parts.push(`${m.reps} reps`);
          if (m.weight != null) {
            const pct = m.target_pct_1rm != null ? ` (${Math.round(m.target_pct_1rm)}% 1RM)` : '';
            parts.push(`${m.weight}${m.weight_unit ?? 'lbs'}${pct}`);
          }
          if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
          if (m.time_seconds != null) parts.push(`${m.time_seconds}s`);
          if (m.distance != null) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
          const scheme = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
          const scaling = m.scaling_note ? ` (${m.scaling_note})` : '';
          return `${m.movement}${scheme}${scaling}`;
        };
        loaded = v3Blocks.map((b: any) => {
          const movements = movsByBlock.get(b.id) ?? [];
          // Scheme + time_cap are rendered as chips at the card header
          // (Step 12), not in the prose body. The reassembled text only
          // carries the block_label (when distinct) + notes + movements,
          // so the chip + the body don't duplicate info.
          const lines: string[] = [];
          if (b.block_label && b.block_label !== (BLOCK_TYPE_LABELS[b.block_type] || b.block_type)) {
            lines.push(b.block_label);
          }
          if (b.block_notes) lines.push(b.block_notes);
          for (const m of movements) lines.push(fmtMv(m));
          // Pre-populate parsed_tasks from the structured movements so the
          // log form doesn't need to re-parse the prose. v3 movements
          // already carry the typed prescription. Field names match what
          // parse-skills / parse-accessory write back for v1, so the
          // cached prefill consumers can stay version-agnostic.
          const parsed_tasks = movements.map((m: any) => ({
            movement: m.movement,
            sets: m.sets ?? null,
            reps: m.reps ?? null,
            weight: m.weight ?? null,
            weight_unit: m.weight_unit ?? null,
            hold_seconds: m.time_seconds ?? null,
            rpe: m.rpe ?? null,
            distance: m.distance ?? null,
            distance_unit: m.distance_unit ?? null,
          }));
          return {
            id: b.id,
            label: BLOCK_TYPE_LABELS[b.block_type] || b.block_type,
            type: b.block_type,
            text: lines.join('\n'),
            parsed_tasks,
            scheme: b.block_scheme ?? null,
            timeCapSeconds: b.time_cap_seconds ?? null,
          };
        });
      }

      setBlocks(loaded);
      setWorkoutType(inferWorkoutType(loaded));

      // Pre-fill strength per-set entries
      const initial: Record<string, EntryValues> = {};
      loaded.forEach((b, bi) => {
        if (b.type === 'strength') {
          const { sets, reps, perSetReps } = parseSetsReps(b.text);
          const numSets = sets && sets > 0 ? sets : 1;
          const primary = b.parsed_tasks?.[0] as { weight?: number | null; weight_unit?: string | null } | undefined;
          const seededWeight = primary?.weight ?? undefined;
          const seededWeightUnit: 'lbs' | 'kg' =
            primary?.weight_unit === 'kg' ? 'kg' : 'lbs';
          for (let s = 0; s < numSets; s++) {
            initial[`${bi}-s${s}`] = {
              reps: perSetReps ? perSetReps[s] : reps,
              weight: seededWeight,
              weight_unit: seededWeightUnit,
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
            // Cached in DB (v1 via parse-skills, v3 inline from program_movements_v2).
            // Field-name mapping is required: parsed_tasks carries `reps`, the form
            // field is `reps_completed`. RPE/quality intentionally left blank.
            skills = (block.parsed_tasks as Array<{
              movement: string;
              sets?: number | null;
              reps?: number | null;
              hold_seconds?: number | null;
            }>).map(s => ({
              movement: s.movement,
              sets: s.sets ?? undefined,
              reps_completed: s.reps ?? undefined,
              hold_seconds: s.hold_seconds ?? undefined,
            }));
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

      // Pre-fill accessory per-movement entries (LLM parse with lazy caching)
      const initialAccessory: Record<string, AccessoryEntryValues> = {};
      const accessoryBlocks = loaded
        .map((b, bi) => ({ block: b, bi }))
        .filter(({ block }) => block.type === 'accessory');

      const accessoryNeedsParse = accessoryBlocks.some(({ block }) => !block.parsed_tasks?.length);
      if (accessoryNeedsParse) setParsingAccessories(true);

      await Promise.all(
        accessoryBlocks.map(async ({ block, bi }) => {
          let movements: AccessoryEntryValues[];

          if (block.parsed_tasks && block.parsed_tasks.length > 0) {
            // Cached in DB (v1 via parse-accessory, v3 inline from program_movements_v2).
            // Field-name mapping required: parsed_tasks carries `reps`, form uses `reps_completed`.
            // RPE/notes intentionally left blank.
            movements = (block.parsed_tasks as Array<{
              movement: string;
              sets?: number | null;
              reps?: number | null;
              weight?: number | null;
              weight_unit?: string | null;
              hold_seconds?: number | null;
              distance?: number | null;
              distance_unit?: string | null;
            }>).map(m => ({
              movement: m.movement,
              sets: m.sets ?? undefined,
              reps_completed: m.reps ?? undefined,
              weight: m.weight ?? undefined,
              weight_unit: m.weight_unit === 'kg' ? 'kg' : m.weight_unit === 'lbs' ? 'lbs' : undefined,
              hold_seconds: m.hold_seconds ?? undefined,
              distance: m.distance ?? undefined,
              distance_unit: m.distance_unit === 'm' || m.distance_unit === 'ft' ? m.distance_unit : undefined,
            }));
          } else {
            try {
              const { data: fnData, error: fnErr } = await supabase.functions.invoke('parse-accessory', {
                body: { block_text: block.text, block_id: block.id },
              });
              if (fnErr || !fnData?.movements) {
                console.error('parse-accessory failed:', fnErr);
                movements = [];
              } else {
                movements = (fnData.movements as { movement: string; sets: number | null; reps: number | null; weight: number | null; weight_unit: 'lbs' | 'kg' | null; hold_seconds: number | null; distance: number | null; distance_unit: 'm' | 'ft' | null; notes: string | null }[]).map(m => ({
                  movement: m.movement,
                  sets: m.sets ?? undefined,
                  reps_completed: m.reps ?? undefined,
                  weight: m.weight ?? undefined,
                  weight_unit: m.weight_unit ?? undefined,
                  hold_seconds: m.hold_seconds ?? undefined,
                  distance: m.distance ?? undefined,
                  distance_unit: m.distance_unit ?? undefined,
                  notes: m.notes ?? undefined,
                }));
              }
            } catch (e) {
              console.error('parse-accessory call error:', e);
              movements = [];
            }
          }

          movements.forEach((mv, mi) => {
            initialAccessory[`${bi}-ac${mi}`] = mv;
          });
        }),
      );
      setAccessoryEntries(initialAccessory);
      if (accessoryNeedsParse) setParsingAccessories(false);

      // Resolve which log (if any) to restore form state from. In edit mode
      // the caller picked the exact log; otherwise we look for an in-progress
      // resume on this source_id.
      {
        let logToRestore: { id: string } | null = null;
        if (sourceState.edit_log_id) {
          logToRestore = { id: sourceState.edit_log_id };
        } else {
          const { data: ipLog } = await supabase
            .from('workout_logs')
            .select('id')
            .eq('source_id', localSourceId!)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          logToRestore = ipLog ?? null;
        }
        const ipLog = logToRestore;

        if (ipLog) {
          setInProgressLogId(ipLog.id);
          // Load previously saved blocks
          const { data: savedBlockRows } = await supabase
            .from('workout_log_blocks')
            .select('sort_order, block_type, block_label, block_text, score, rx, notes, capped, capped_reps')
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
              // Restore score/rx/capped for metcon blocks
              if (sb.block_type === 'metcon') {
                if (sb.score) setBlockScores(prev => ({ ...prev, [sb.sort_order]: sb.score }));
                setBlockRx(prev => ({ ...prev, [sb.sort_order]: sb.rx ?? true }));
                if (sb.capped) {
                  setBlockCapped(prev => ({ ...prev, [sb.sort_order]: true }));
                  if (sb.capped_reps != null) {
                    setBlockCappedReps(prev => ({ ...prev, [sb.sort_order]: String(sb.capped_reps) }));
                  }
                }
              }
            }
            setSavedBlocks(savedSet);

            // Load previously saved entries to restore strength/metcon/skills values
            const { data: savedEntryRows } = await supabase
              .from('workout_log_entries')
              .select('block_label, movement, sets, reps, weight, weight_unit, rpe, set_number, reps_completed, hold_seconds, distance, distance_unit, quality, variation, faults_observed, scaling_note, sort_order')
              .eq('log_id', ipLog.id)
              .order('sort_order');

            if (savedEntryRows && savedEntryRows.length > 0) {
              const restoredEntries: Record<string, EntryValues> = { ...initial };
              const restoredMetcon: Record<string, MetconEntryValues> = { ...initialMetcon };
              const restoredSkills: Record<string, SkillsEntryValues> = { ...initialSkills };
              const restoredAccessory: Record<string, AccessoryEntryValues> = { ...initialAccessory };

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
                } else if (block.type === 'accessory') {
                  const key = `${bi}-ac${entry.sort_order}`;
                  restoredAccessory[key] = {
                    movement: entry.movement,
                    sets: entry.sets ?? undefined,
                    reps_completed: entry.reps_completed ?? undefined,
                    weight: entry.weight ?? undefined,
                    weight_unit: (entry.weight_unit as 'lbs' | 'kg') ?? undefined,
                    hold_seconds: entry.hold_seconds ?? undefined,
                    distance: entry.distance ?? undefined,
                    distance_unit: (entry.distance_unit as 'm' | 'ft') ?? undefined,
                    rpe: entry.rpe ?? undefined,
                    notes: entry.scaling_note ?? undefined,
                  };
                }
              }

              setEntryValues(restoredEntries);
              setMetconEntries(restoredMetcon);
              setSkillsEntries(restoredSkills);
              setAccessoryEntries(restoredAccessory);
            }
          }
        }
      }

      // Fetch cached coach review to get common_faults per movement
      const { data: reviewRow } = await supabase
        .from('workout_reviews')
        .select('review')
        .eq('source_id', localSourceId!)
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
  }, [sourceState?.source_id, sourceState?.edit_log_id]);

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

  const setAccessoryEntry = (key: string, field: keyof AccessoryEntryValues, value: unknown) => {
    setAccessoryEntries(prev => ({
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

  const isSkipped = (key: string) => !!skippedKeys[key];
  const setSkippedFlag = (key: string, val: boolean) => {
    setSkippedKeys(prev => {
      const next = { ...prev, [key]: val };
      if (!val) delete next[key];
      return next;
    });
    if (!val) {
      setSkipReasons(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };
  const setSkipReasonFor = (key: string, reason: string) => {
    setSkipReasons(prev => ({ ...prev, [key]: reason }));
  };

  /**
   * Renders the skip toggle for a single movement. Two states:
   *   not skipped: small text-link "Skip"
   *   skipped:     "Skipped — reason ▾ · undo"
   * The reason picker is a select with canned options + free-text via "Other…".
   */
  const renderSkipControl = (key: string) => {
    if (!isSkipped(key)) {
      return (
        <button
          type="button"
          onClick={() => setSkippedFlag(key, true)}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label="Skip this movement"
        >
          Skip
        </button>
      );
    }
    const reason = skipReasons[key] || '';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Skipped</span>
        <select
          value={reason}
          onChange={e => setSkipReasonFor(key, e.target.value)}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 6px',
            fontSize: 11,
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
        >
          <option value="">reason…</option>
          <option value="time">Time</option>
          <option value="crowded gym">Crowded gym</option>
          <option value="injury">Injury / pain</option>
          <option value="felt off">Felt off</option>
          <option value="substituted">Substituted</option>
          <option value="equipment">No equipment</option>
        </select>
        <button
          type="button"
          onClick={() => setSkippedFlag(key, false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            fontSize: 11,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
            fontFamily: 'inherit',
          }}
          aria-label="Undo skip"
        >
          undo
        </button>
      </div>
    );
  };

  /** Block-level "Skip Block" — marks every movement in the block as skipped */
  const skipBlock = (bi: number) => {
    const block = blocks[bi];
    if (!block) return;
    if (block.type === 'strength') {
      setSkippedFlag(`${bi}-strength`, true);
      return;
    }
    let keys: string[] = [];
    if (block.type === 'metcon') {
      keys = Object.keys(metconEntries).filter(k => k.startsWith(`${bi}-m`));
    } else if (block.type === 'skills') {
      keys = Object.keys(skillsEntries).filter(k => k.startsWith(`${bi}-sk`));
    } else if (block.type === 'accessory') {
      keys = Object.keys(accessoryEntries).filter(k => k.startsWith(`${bi}-ac`));
    }
    setSkippedKeys(prev => {
      const next = { ...prev };
      for (const k of keys) next[k] = true;
      return next;
    });
  };

  // Reactively compute benchmarks per metcon block.
  // Two-pass for smooth UX:
  //   1. Synchronous initial render uses calculateBenchmarksLocal (the
  //      PERFORMANCE_FACTORS fallback) so block cards show numbers immediately.
  //   2. Async useEffect calls calculateBenchmarks (cohort-derived via
  //      compute-benchmarks edge fn) and swaps the values in when they
  //      resolve. On edge-fn failure, calculateBenchmarks itself falls back
  //      to the local math, so the swap is a no-op.
  const localBenchmarks = useMemo<Record<number, BenchmarkResult>>(() => {
    const result: Record<number, BenchmarkResult> = {};
    if (workRates.length === 0) return result;
    blocks.forEach((b, bi) => {
      if (b.type !== 'metcon') return;
      const mvKeys = Object.keys(metconEntries)
        .filter(k => k.startsWith(`${bi}-m`));
      if (mvKeys.length === 0) return;
      const entries = mvKeys.map(k => metconEntries[k]).filter(Boolean);
      const wType = inferWorkoutType([b]);
      // v3 blocks split the scheme ("4 rounds for time, 8:00 cap") into b.scheme
      // and the prescription body into b.text. The extractors (rounds, cap)
      // need both. Combine for benchmark parsing.
      const combinedText = [b.scheme, b.text].filter(Boolean).join('\n');
      result[bi] = calculateBenchmarksLocal(entries, wType, combinedText, workRates);
    });
    return result;
  }, [blocks, metconEntries, workRates]);

  const [cohortBenchmarks, setCohortBenchmarks] = useState<Record<number, BenchmarkResult>>({});

  useEffect(() => {
    if (workRates.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.type !== 'metcon') continue;
        const mvKeys = Object.keys(metconEntries)
          .filter(k => k.startsWith(`${bi}-m`));
        if (mvKeys.length === 0) continue;
        const entries = mvKeys.map(k => metconEntries[k]).filter(Boolean);
        const wType = inferWorkoutType([b]);
        // Same as the sync path — combine scheme + text so rounds/cap reach
        // the client's extractRoundCount + extractTimeCapSeconds.
        const combinedText = [b.scheme, b.text].filter(Boolean).join('\n');
        const result = await calculateBenchmarks(entries, wType, combinedText, workRates);
        if (cancelled) return;
        // Stream updates as each block resolves so the first metcon shows
        // its cohort number before the later ones finish.
        setCohortBenchmarks((prev) => ({ ...prev, [bi]: result }));
      }
    })();
    return () => { cancelled = true; };
  }, [blocks, metconEntries, workRates]);

  // Cohort values win where available; local fallback fills the gaps during
  // the brief async window or on edge-fn failure paths.
  const blockBenchmarks = useMemo<Record<number, BenchmarkResult>>(
    () => ({ ...localBenchmarks, ...cohortBenchmarks }),
    [localBenchmarks, cohortBenchmarks],
  );

  /** Build a single block's log payload from current form state */
  const buildBlockPayload = (bi: number) => {
    const b = blocks[bi];
    if (!b) return null;

    let entries: any[] = [];
    let score: string | null = null;
    let rx = false;

    // Step 18: snapshot the prescription from b.parsed_tasks (populated by the
    // v3 fallback from program_movements_v2, or by parse-* fns for v1) into
    // each entry so adherence math has both prescribed and actual. NULL for
    // any field/movement the prescription didn't specify.
    const rxTasks = (b.parsed_tasks as Array<{
      movement?: string | null;
      reps?: number | null;
      weight?: number | null;
      hold_seconds?: number | null;
      rpe?: number | null;
    }> | null) ?? [];
    const getPrescription = (movementName: string) => {
      const target = movementName.trim().toLowerCase();
      const matches = rxTasks.filter(t => (t.movement ?? '').trim().toLowerCase() === target);
      if (matches.length === 0) {
        return {
          prescribed_weight: null as number | null,
          prescribed_reps: null as number | null,
          prescribed_hold_seconds: null as number | null,
          prescribed_rpe: null as number | null,
        };
      }
      // Metcons sometimes have duplicate rows (e.g., 21-15-9 expanded across
      // rounds); sum reps across them. Load + hold + rpe don't accumulate.
      const repsSum = matches.reduce((s, t) => s + (t.reps ?? 0), 0);
      return {
        prescribed_weight: matches[0].weight ?? null,
        prescribed_reps: repsSum > 0 ? repsSum : null,
        prescribed_hold_seconds: matches[0].hold_seconds ?? null,
        prescribed_rpe: matches[0].rpe ?? null,
      };
    };

    if (b.type === 'strength') {
      // v3 strength has a clean canonical movement in parsed_tasks; use it
      // directly so getPrescription can match and per-lift analytics group
      // cleanly. extractMovementName remains only as the v1 prose fallback.
      const movementName =
        (b.parsed_tasks as Array<{ movement?: string | null }> | null)?.[0]?.movement?.trim()
        || extractMovementName(b.text);
      const setKeys = Object.keys(entryValues)
        .filter(k => k.startsWith(`${bi}-s`))
        .sort((a, b2) => parseInt(a.split('-s')[1], 10) - parseInt(b2.split('-s')[1], 10));
      const strFaults = checkedFaults[`${bi}-str`];
      const blockSkipKey = `${bi}-strength`;
      const blockSkipped = isSkipped(blockSkipKey);
      const blockSkipReason = skipReasons[blockSkipKey]?.trim() || null;
      const strengthRx = getPrescription(movementName);
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
          completed: !blockSkipped,
          skip_reason: blockSkipped ? blockSkipReason : null,
          ...strengthRx,
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
          const rowSkipped = isSkipped(key);
          const reason = skipReasons[key]?.trim() || null;
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
            completed: !rowSkipped,
            skip_reason: rowSkipped ? reason : null,
            ...getPrescription(mv.movement),
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
          const rowSkipped = isSkipped(key);
          const reason = skipReasons[key]?.trim() || null;
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
            completed: !rowSkipped,
            skip_reason: rowSkipped ? reason : null,
            ...getPrescription(sk.movement),
          };
        });
    } else if (b.type === 'accessory') {
      const acKeys = Object.keys(accessoryEntries)
        .filter(k => k.startsWith(`${bi}-ac`))
        .sort((a, b2) => parseInt(a.split('-ac')[1], 10) - parseInt(b2.split('-ac')[1], 10));
      entries = acKeys
        .filter(key => accessoryEntries[key]?.movement?.trim())
        .map(key => {
          const ac = accessoryEntries[key];
          const rowSkipped = isSkipped(key);
          const reason = skipReasons[key]?.trim() || null;
          return {
            movement: ac.movement.trim(),
            sets: ac.sets ?? null,
            reps: null,
            weight: ac.weight ?? null,
            weight_unit: ac.weight_unit || userUnits,
            rpe: ac.rpe ?? null,
            scaling_note: ac.notes?.trim() || null,
            set_number: null,
            reps_completed: ac.reps_completed ?? null,
            hold_seconds: ac.hold_seconds ?? null,
            distance: ac.distance ?? null,
            distance_unit: ac.distance_unit ?? null,
            quality: null,
            variation: null,
            faults_observed: null,
            completed: !rowSkipped,
            skip_reason: rowSkipped ? reason : null,
            ...getPrescription(ac.movement),
          };
        });
    }

    // Compute scoring for metcon blocks. Skip when capped — there's no
    // meaningful percentile without a finish time.
    const benchmarks = blockBenchmarks[bi];
    const isCapped = b.type === 'metcon' && (blockCapped[bi] ?? false);
    const scoreStr = blockScores[bi]?.trim() || '';
    const wType = inferWorkoutType([b]);
    const scoring = b.type === 'metcon' && benchmarks && scoreStr && !isCapped
      ? scoreMetcon(scoreStr, wType, benchmarks)
      : null;
    const cappedRepsRaw = blockCappedReps[bi]?.trim();
    const cappedReps = isCapped && cappedRepsRaw ? parseInt(cappedRepsRaw, 10) : null;

    return {
      label: b.label,
      type: b.type,
      text: b.text,
      score: isCapped ? null : score,
      rx,
      notes: blockNotes[bi]?.trim() || null,
      sort_order: bi,
      entries,
      capped: isCapped,
      capped_reps: Number.isFinite(cappedReps) ? cappedReps : null,
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
          source_id: resolvedSourceId || sourceState?.source_id || null,
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
            source_id: resolvedSourceId || sourceState?.source_id || null,
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
      // buildBlockPayload returns the full per-block shape for every block
      // type (loggable + non-loggable). Non-loggable types get an empty
      // entries[] which is the same shape the previous duplicated branch
      // produced. Using one builder also routes Step 10's completed +
      // skip_reason fields through cleanly.
      const logBlocks = blocks
        .map((_, bi) => buildBlockPayload(bi))
        .filter((b): b is NonNullable<typeof b> => b != null);

      const workoutText = sourceState?.workout_text?.trim() ||
        blocks.map(b => `${b.label}: ${b.text}`).join('\n');

      const { data, error } = await supabase.functions.invoke('log-workout', {
        body: {
          workout_date: workoutDate,
          workout_text: workoutText,
          workout_type: workoutType,
          source_id: resolvedSourceId || sourceState?.source_id || null,
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
          <h1>{isEditMode ? 'Edit Workout' : inProgressLogId ? 'Resume Workout' : 'Start Workout'}</h1>
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
                    {(block.scheme || block.timeCapSeconds) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        {block.scheme && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            background: 'var(--surface2)',
                            border: '1px solid var(--border)',
                            borderRadius: 999,
                            padding: '4px 10px',
                            fontSize: 12,
                            color: 'var(--text)',
                            lineHeight: 1.2,
                          }}>{block.scheme}</span>
                        )}
                        {block.timeCapSeconds != null && block.timeCapSeconds > 0 && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'var(--surface2)',
                            border: '1px solid var(--border)',
                            borderRadius: 999,
                            padding: '4px 10px',
                            fontSize: 12,
                            color: 'var(--text)',
                            lineHeight: 1.2,
                            fontVariantNumeric: 'tabular-nums',
                          }}>
                            <span aria-hidden>⏱</span>
                            {Math.floor(block.timeCapSeconds / 60)}:{String(block.timeCapSeconds % 60).padStart(2, '0')} cap
                          </span>
                        )}
                      </div>
                    )}
                    <div className="workout-review-content" style={{ marginBottom: 16 }}>
                      <BlockContent label={block.label} content={block.text} />
                    </div>

                    {block.type === 'strength' && (() => {
                      const setKeys = Object.keys(entryValues)
                        .filter(k => k.startsWith(`${bi}-s`))
                        .sort((a, b) => parseInt(a.split('-s')[1], 10) - parseInt(b.split('-s')[1], 10));

                      const skipKey = `${bi}-strength`;
                      const blockSkipped = isSkipped(skipKey);

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                            {renderSkipControl(skipKey)}
                          </div>
                          {blockSkipped ? (
                            <div style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic', padding: '8px 0' }}>
                              Strength block skipped.
                            </div>
                          ) : (
                          <>
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
                          </>
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

                      const isForTime = inferWorkoutType([block]) === 'for_time';
                      const isCapped = blockCapped[bi] ?? false;

                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type="checkbox" id={`rx-${bi}`} checked={blockRx[bi] ?? true} onChange={e => setBlockRx(prev => ({ ...prev, [bi]: e.target.checked }))} />
                              <label htmlFor={`rx-${bi}`} style={{ fontSize: 14, color: 'var(--text-dim)' }}>Rx</label>
                            </div>
                            {isForTime && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                  type="checkbox"
                                  id={`capped-${bi}`}
                                  checked={isCapped}
                                  onChange={e => setBlockCapped(prev => ({ ...prev, [bi]: e.target.checked }))}
                                />
                                <label htmlFor={`capped-${bi}`} style={{ fontSize: 14, color: 'var(--text-dim)' }}>Capped</label>
                              </div>
                            )}
                          </div>
                          {isCapped ? (
                            <div className="field" style={{ marginBottom: 16 }}>
                              <label>Reps completed at cap</label>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="e.g. 142"
                                value={blockCappedReps[bi] ?? ''}
                                onChange={e => setBlockCappedReps(prev => ({ ...prev, [bi]: e.target.value }))}
                              />
                            </div>
                          ) : (
                            <div className="field" style={{ marginBottom: 16 }}>
                              <label>Score</label>
                              <input type="text" placeholder="e.g. 4:48 or 8+12" value={blockScores[bi] ?? ''} onChange={e => setBlockScores(prev => ({ ...prev, [bi]: e.target.value }))} />
                            </div>
                          )}

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
                                  const rowSkipped = isSkipped(key);
                                  return (
                                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input
                                          type="text"
                                          value={mv.movement}
                                          onChange={e => setMetconEntry(key, 'movement', e.target.value)}
                                          style={{ ...compactInputStyle, flex: 1, textDecoration: rowSkipped ? 'line-through' : 'none', color: rowSkipped ? 'var(--text-dim)' : 'var(--text)' }}
                                        />
                                        {renderSkipControl(key)}
                                      </div>
                                      {rowSkipped ? null : (
                                      <>
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
                                  const rowSkipped = isSkipped(key);
                                  return (
                                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input
                                          type="text"
                                          value={sk.movement}
                                          onChange={e => setSkillEntry(key, 'movement', e.target.value)}
                                          style={{ ...compactInputStyle, flex: 1, textDecoration: rowSkipped ? 'line-through' : 'none', color: rowSkipped ? 'var(--text-dim)' : 'var(--text)' }}
                                        />
                                        {renderSkipControl(key)}
                                      </div>
                                      {rowSkipped ? null : (
                                      <>
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
                                      </>
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

                    {block.type === 'accessory' && (() => {
                      const acKeys = Object.keys(accessoryEntries)
                        .filter(k => k.startsWith(`${bi}-ac`))
                        .sort((a, b2) => parseInt(a.split('-ac')[1], 10) - parseInt(b2.split('-ac')[1], 10));

                      return (
                        <>
                          {parsingAccessories && acKeys.length === 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Parsing accessory movements…</div>
                            </div>
                          )}
                          {acKeys.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Accessory movements (confirm or adjust)</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {acKeys.map(key => {
                                  const ac = accessoryEntries[key];
                                  if (!ac) return null;
                                  const rowSkipped = isSkipped(key);
                                  return (
                                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input
                                          type="text"
                                          value={ac.movement}
                                          onChange={e => setAccessoryEntry(key, 'movement', e.target.value)}
                                          style={{ ...compactInputStyle, flex: 1, textDecoration: rowSkipped ? 'line-through' : 'none', color: rowSkipped ? 'var(--text-dim)' : 'var(--text)' }}
                                        />
                                        {renderSkipControl(key)}
                                      </div>
                                      {rowSkipped ? null : (
                                      <>
                                      <div className="acc-grid">
                                        <div className="acc-field">
                                          <span className="acc-field-label">Sets</span>
                                          <input
                                            type="number"
                                            value={ac.sets ?? ''}
                                            onChange={e => setAccessoryEntry(key, 'sets', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          />
                                        </div>
                                        <div className="acc-field">
                                          <span className="acc-field-label">Reps</span>
                                          <input
                                            type="number"
                                            value={ac.reps_completed ?? ''}
                                            onChange={e => setAccessoryEntry(key, 'reps_completed', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          />
                                        </div>
                                        <div className="acc-field">
                                          <span className="acc-field-label">Wt</span>
                                          <input
                                            type="number"
                                            value={ac.weight ?? ''}
                                            onChange={e => setAccessoryEntry(key, 'weight', e.target.value ? parseFloat(e.target.value) : undefined)}
                                          />
                                        </div>
                                        <div className="acc-field">
                                          <span className="acc-field-label">Hold (s)</span>
                                          <input
                                            type="number"
                                            value={ac.hold_seconds ?? ''}
                                            onChange={e => setAccessoryEntry(key, 'hold_seconds', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          />
                                        </div>
                                        <div className="acc-field">
                                          <span className="acc-field-label">Dist</span>
                                          <input
                                            type="number"
                                            value={ac.distance ?? ''}
                                            onChange={e => setAccessoryEntry(key, 'distance', e.target.value ? parseFloat(e.target.value) : undefined)}
                                          />
                                        </div>
                                        <div className="acc-field">
                                          <span className="acc-field-label">RPE</span>
                                          <select
                                            value={ac.rpe ?? ''}
                                            onChange={e => setAccessoryEntry(key, 'rpe', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                          >
                                            <option value=""></option>
                                            {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                      </>
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
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => skipBlock(bi)}
                        disabled={savedBlocks.has(bi)}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 12px',
                          fontSize: 12,
                          color: 'var(--text-dim)',
                          cursor: savedBlocks.has(bi) ? 'default' : 'pointer',
                          opacity: savedBlocks.has(bi) ? 0.5 : 1,
                          fontFamily: 'inherit',
                        }}
                      >
                        Skip Block
                      </button>
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
