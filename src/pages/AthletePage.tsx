import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../lib/appEvents';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { classifyAthlete } from '../utils/classify-athlete';
import { getTierStatus, type AthleteProfileInput, type TierSection } from '../utils/tier-status';
import { clampLift, maxLift, filterTimeChars, isValidTimeStr, normalizeTimeStr } from '../utils/profileValidation';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { formatMarkdown } from '../lib/formatMarkdown';
import { ATHLETEDATA_PUBLIC_TIER } from '../lib/featureFlags';

// ============================================================
// Defensive shape normalizers for LLM-emitted v2 output.
//
// TypeScript types are compile-time only. At runtime the LLM response
// (or a partial-transport blip) can hand us a non-array where the
// schema promised one. These helpers coerce to safe shapes so the
// render layer's `.map` / `.length` can't crash the page.
// ============================================================

type AnyRec = Record<string, unknown>;
const isRec = (v: unknown): v is AnyRec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const safeArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const safeStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const safeStrArr = (v: unknown): string[] =>
  safeArr(v).filter((x): x is string => typeof x === 'string');

interface SafeEvaluation {
  headline_takeaway: string;
  strengths: string[];
  weaknesses_and_priorities: string[];
  detailed_analysis: string;
  recommendations: string[];
}

function normalizeEvaluation(raw: unknown): SafeEvaluation {
  const r = isRec(raw) ? raw : {};
  return {
    headline_takeaway: safeStr(r.headline_takeaway),
    strengths: safeStrArr(r.strengths),
    weaknesses_and_priorities: safeStrArr(r.weaknesses_and_priorities),
    detailed_analysis: safeStr(r.detailed_analysis),
    recommendations: safeStrArr(r.recommendations),
  };
}

const EVAL_SECTION_LABEL: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  marginBottom: 6,
};

/** Accent kickers for the upgrade CTA's three beats (Program / Coach / Gains). */
const CTA_KICKER: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '1px',
  color: 'var(--accent)',
  marginBottom: 3,
};

/** Tier 3's three cards (Schedule / Equipment / Coach) share the eval CTA's
 *  treatment — white outline + accent kicker — so the profile speaks the same
 *  visual language as the CTA that sent the user here. */
const T3_CARD: React.CSSProperties = {
  padding: 16,
  border: '1px solid rgba(255,255,255,0.35)',
};

/** Char counter for the Tier 3 text boxes: invisible until the box has focus
 *  or content, so an untouched form shows zero bookkeeping. */
function t3CounterStyle(len: number, show: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    color: len >= 480 ? '#e5484d' : 'var(--text-muted)',
    textAlign: 'right',
    visibility: show ? 'visible' : 'hidden',
    fontVariantNumeric: 'tabular-nums',
  };
}

/** Shared structured-evaluation renderer (admin v2 panel + user eval history):
 *  green strengths (bulleted), red weaknesses (numbered), synthesizing prose,
 *  numbered recommendations. */
function StructuredEvalView({ e, onUpgrade }: { e: SafeEvaluation; onUpgrade?: () => void }) {
  // Stage D: does the eval have a shelf life (re-reads)?
  useEffect(() => { track('eval_viewed'); }, []);
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      {e.headline_takeaway && (
        <div style={{ fontWeight: 700, marginBottom: 12 }}>{e.headline_takeaway}</div>
      )}
      {e.strengths.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...EVAL_SECTION_LABEL, color: '#2ec486' }}>Strengths</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {e.strengths.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
        </div>
      )}
      {e.weaknesses_and_priorities.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...EVAL_SECTION_LABEL, color: '#e5484d' }}>Weaknesses &amp; Priorities</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {e.weaknesses_and_priorities.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
          </ol>
        </div>
      )}
      {e.detailed_analysis && (
        <div style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>{e.detailed_analysis}</div>
      )}
      {e.recommendations.length > 0 && (
        <div>
          <div style={{ ...EVAL_SECTION_LABEL, color: 'var(--accent)' }}>Recommendations</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {e.recommendations.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
          </ol>
        </div>
      )}
      {/* CTA — the app talking, not the coach: visually distinct from the
          eval body, rendered only for users without AI Programming. Every
          claim here is a shipped feature: goal-fused personalized cycles,
          the day-scoped coach (letter + proposal cards), and the logging
          loop that sharpens the next cycle. */}
      {onUpgrade && (
        <div style={{ marginTop: 16, padding: '20px 22px', background: 'var(--surface2)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
            Turn This Evaluation Into Your Program
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.65, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={CTA_KICKER}>Your Program</div>
              Add your goals and training preferences. Our AI combines them with your evaluation to
              build your personalized program.
            </div>
            <div>
              <div style={CTA_KICKER}>Your Coach</div>
              Your program includes your AI Coach.{' '}
              <strong style={{ color: 'var(--text)', fontWeight: 700 }}>AI Coach is not a chatbot.</strong>{' '}
              It is trained on our methodology and has access to your evaluation, goals, program,
              and training history — so it can answer questions, coach your sessions, and adjust
              your training in real time. It&rsquo;s like having a high-level coach by your side,
              every session.
            </div>
            <div>
              <div style={CTA_KICKER}>Your Gains</div>
              Log your results and AI reviews what actually happened — then updates your program to
              keep you on track.
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '14px 0' }}>
            Personalized training and coaching. <span style={{ color: 'var(--accent)' }}>Every day.</span>
          </div>
          <button
            type="button"
            className="auth-btn"
            style={{ padding: '14px 20px', fontSize: 14, width: '100%', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}
            onClick={onUpgrade}
          >
            Build My Program
          </button>
        </div>
      )}
    </div>
  );
}

const LIFT_GROUPS = [
  {
    title: 'Squats',
    lifts: [
      { key: 'back_squat', label: 'Back Squat' },
      { key: 'front_squat', label: 'Front Squat' },
      { key: 'overhead_squat', label: 'Overhead Squat' },
    ],
  },
  {
    title: 'Hip Hinge',
    lifts: [{ key: 'deadlift', label: 'Deadlift' }],
  },
  {
    title: 'Olympic',
    lifts: [
      { key: 'clean', label: 'Clean (only)' },
      { key: 'power_clean', label: 'Power Clean' },
      { key: 'clean_and_jerk', label: 'Clean & Jerk' },
      { key: 'jerk', label: 'Jerk (only)' },
      { key: 'snatch', label: 'Snatch' },
      { key: 'power_snatch', label: 'Power Snatch' },
      { key: 'push_jerk', label: 'Push Jerk' },
    ],
  },
  {
    title: 'Pressing',
    lifts: [
      { key: 'press', label: 'Strict Press' },
      { key: 'push_press', label: 'Push Press' },
      { key: 'bench_press', label: 'Bench Press' },
    ],
  },
];

const SKILL_GROUPS = [
  {
    title: 'Muscle-Ups',
    skills: [
      { key: 'muscle_ups', label: 'Muscle-Ups (rings)' },
      { key: 'bar_muscle_ups', label: 'Bar Muscle-Ups' },
      { key: 'strict_ring_muscle_ups', label: 'Strict Ring Muscle-Ups' },
    ],
  },
  {
    title: 'Bar Skills',
    skills: [
      { key: 'toes_to_bar', label: 'Toes-to-Bar' },
      { key: 'strict_pull_ups', label: 'Strict Pull-Ups' },
      { key: 'kipping_pull_ups', label: 'Kipping Pull-Ups' },
      { key: 'butterfly_pull_ups', label: 'Butterfly Pull-Ups' },
      { key: 'chest_to_bar_pull_ups', label: 'Chest to Bar Pull-Ups' },
    ],
  },
  {
    title: 'Rope Climbs',
    skills: [
      { key: 'rope_climbs', label: 'Rope Climbs' },
      { key: 'legless_rope_climbs', label: 'Legless Rope Climbs' },
    ],
  },
  {
    title: 'HSPU',
    skills: [
      { key: 'wall_facing_hspu', label: 'Wall-Facing HSPU' },
      { key: 'hspu', label: 'HSPU' },
      { key: 'strict_hspu', label: 'Strict HSPU' },
      { key: 'deficit_hspu', label: 'Deficit HSPU' },
    ],
  },
  {
    title: 'Rings',
    skills: [
      { key: 'ring_dips', label: 'Ring Dips' },
      { key: 'l_sit', label: 'L-Sit' },
    ],
  },
  {
    title: 'Other',
    skills: [
      { key: 'handstand_walk', label: 'Handstand Walk' },
      { key: 'double_unders', label: 'Double-Unders' },
      { key: 'pistols', label: 'Pistols' },
      { key: 'ghd_sit_ups', label: 'GHD Sit-Ups' },
    ],
  },
];

const EQUIPMENT_GROUPS = [
  {
    title: 'Cardio',
    items: [
      { key: 'rower', label: 'Rower' },
      { key: 'assault_bike', label: 'Assault/Echo Bike' },
      { key: 'ski_erg', label: 'Ski Erg' },
      { key: 'treadmill', label: 'Treadmill' },
      { key: 'jump_rope', label: 'Jump Rope' },
    ],
  },
  {
    title: 'Barbell & Weights',
    items: [
      { key: 'barbell', label: 'Barbell & Plates' },
      { key: 'dumbbells', label: 'Dumbbells' },
      { key: 'kettlebells', label: 'Kettlebells' },
      { key: 'bench', label: 'Bench' },
    ],
  },
  {
    title: 'Gymnastics',
    items: [
      { key: 'pull_up_bar', label: 'Pull-Up Bar' },
      { key: 'rings', label: 'Rings' },
      { key: 'rope', label: 'Climbing Rope' },
      { key: 'ghd', label: 'GHD' },
      { key: 'parallettes', label: 'Parallettes' },
      { key: 'pegboard', label: 'Pegboard' },
    ],
  },
  {
    title: 'Other',
    items: [
      { key: 'box', label: 'Plyo Box' },
      { key: 'wall_ball', label: 'Wall Ball' },
      { key: 'sled', label: 'Sled/Prowler' },
      { key: 'blocks', label: 'Lifting Blocks' },
      { key: 'bands', label: 'Resistance Bands' },
    ],
  },
];

/** The Tier 3 equipment review persists the FULL key map, never a partial one:
 *  downstream hydration treats missing keys in a non-empty record as false
 *  ("owns nothing but what's listed"), so a one-key record would be a lie.
 *  Unset keys default to checked, matching what the checklist renders. */
function materializeEquipment(current: Record<string, boolean>): Record<string, boolean> {
  const full: Record<string, boolean> = {};
  for (const group of EQUIPMENT_GROUPS) {
    for (const item of group.items) full[item.key] = current[item.key] ?? true;
  }
  return full;
}

// Rating legend (founder copy, 2026-08-23): capacity-in-workouts framing works
// for every skill, and "pick lower" resolves the I-don't-know-which paralysis
// with the training-correct rule.
const SKILL_LEVEL_LEGEND: Array<[string, string]> = [
  ['None', "can't do it yet."],
  ['Beginner', 'small sets only, not consistent.'],
  ['Intermediate', 'can do it comfortably in workouts.'],
  ['Advanced', 'big unbroken sets even under fatigue.'],
];

/** Athlete-voice names for blank benchmarks, used by the pre-run checkpoint's
 *  "would sharpen the read" line (bike labels need the machine spelled out). */
const CONDITIONING_GAP_PHRASES: Record<string, string> = {
  '1_mile_run': '1-mile run',
  '5k_run': '5k run',
  '1k_row': '1k row',
  '2k_row': '2k row',
  '5k_row': '5k row',
  '1min_bike_cals': '1-min bike cals',
  '10min_bike_cals': '10-min bike cals',
};

/** "your 5k row and 1-min bike cals (and 3 more)" — names the first two
 *  blanks, counts the rest. Callers guarantee at least one phrase. */
function describeGaps(phrases: string[]): string {
  const named = phrases.slice(0, 2);
  const rest = phrases.length - named.length;
  const base = named.length === 1 ? `your ${named[0]}` : `your ${named[0]} and ${named[1]}`;
  return rest > 0 ? `${base} (and ${rest} more)` : base;
}

const CONDITIONING_GROUPS = [
  {
    title: 'Running',
    benchmarks: [
      { key: '1_mile_run', label: '1 Mile Run', placeholder: 'e.g. 6:45', isTime: true },
      { key: '5k_run', label: '5k Run', placeholder: 'e.g. 22:30', isTime: true },
    ],
  },
  {
    title: 'Rowing',
    benchmarks: [
      { key: '1k_row', label: '1k Row', placeholder: 'e.g. 3:45', isTime: true },
      { key: '2k_row', label: '2k Row', placeholder: 'e.g. 7:30', isTime: true },
      { key: '5k_row', label: '5k Row', placeholder: 'e.g. 20:00', isTime: true },
    ],
  },
  {
    title: 'Bike',
    benchmarks: [
      { key: '1min_bike_cals', label: '1 Min Cals', placeholder: '0', isTime: false },
      { key: '10min_bike_cals', label: '10 Min Cals', placeholder: '0', isTime: false },
    ],
  },
];

const SKILL_LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;
type SkillLevel = typeof SKILL_LEVELS[number];

// SHA-256 hex, byte-identical to parse-injuries-constraints.sha256Hex and the
// generation guard's hash. Lets the client bind an injury confirmation to the exact
// text WITHOUT calling the LLM parser — so a parser outage never leaves an
// edited-text athlete with no path to confirm (handoff 1.1/1.2).
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Open-ended coaching-intake prompts (free-text / voice). Extracted server-side
// (process-coaching-intake) into the structured coaching_intake object. Kept
// distinct from Tier-3's structured goal/injuries fields to avoid duplication.
//
// Trimmed Aug '26 (founder ruling): the essay prompts (loved_disliked,
// strong_weak, history, past_programs) overwhelmed the intake and their answers
// competed with hard data in the writer prompt. Only the catch-all remains.
// Stored answers under the retired keys are KEPT — they load into intakeAnswers
// and ride along on every save — we just stop asking new users.
const INTAKE_QUESTIONS: { key: string; label: string; helper: string }[] = [
  { key: 'anything_else', label: 'Anything else we should know?', helper: 'Training background, schedule, how you like to train. Tap the mic on your keyboard and just talk.' },
];

const LEVEL_LABELS: Record<SkillLevel, string> = {
  none: 'None',
  beginner: 'Beginner',
  intermediate: 'Inter',
  advanced: 'Advanced',
};

interface ProfileSnapshot {
  lifts?: Record<string, number>;
  skills?: Record<string, string>;
  conditioning?: Record<string, string | number>;
  bodyweight?: number | null;
  units?: string;
  age?: number | null;
  height?: number | null;
  gender?: string;
}

interface Evaluation {
  id: string;
  profile_snapshot: ProfileSnapshot;
  analysis: string | null;
  /** v2 evals carry the structured 5-section object; v1 rows are null. When
   *  present we render the structured UX instead of the flat markdown. */
  structured_evaluation?: Record<string, unknown> | null;
  created_at: string;
}

interface TrainingEvaluation {
  id: string;
  profile_snapshot: ProfileSnapshot;
  training_snapshot: string | null;
  analysis: string | null;
  created_at: string;
}

interface NutritionEvaluation {
  id: string;
  nutrition_snapshot: Record<string, unknown> | null;
  analysis: string | null;
  created_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Extract a human-readable message from a supabase-js v2 functions error.
 * v2 wraps non-2xx responses in a FunctionsHttpError whose `.message` is
 * just "Edge Function returned a non-2xx status code" — the actual body
 * (where our friendly `message` / `error` fields live) is on `.context`
 * as a Response that we have to read ourselves. Returns null if the body
 * yields no usable text; callers can then fall back to a generic.
 */
async function extractFunctionError(err: unknown): Promise<string | null> {
  if (!err) return null;
  const ctx = (err as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body && typeof body === 'object') {
        const m = (body as { message?: unknown }).message;
        if (typeof m === 'string' && m.trim()) return m;
        const e = (body as { error?: unknown }).error;
        if (typeof e === 'string' && e.trim()) return e;
      }
    } catch {
      // body wasn't JSON, was empty, or was already consumed
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return null;
}

function CollapsibleSection({
  title,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  sectionRef,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onToggle?: (next: boolean) => void;
  sectionRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const toggle = () => {
    const next = !expanded;
    if (!isControlled) setInternalExpanded(next);
    onToggle?.(next);
  };
  return (
    <div className="settings-card" ref={sectionRef}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 0,
          margin: 0,
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <h2 className="settings-card-title" style={{ marginBottom: 0 }}>{title}</h2>
        <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}

function TierCard({
  tierNumber,
  title,
  unlocks,
  status,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  cardRef,
  locked = false,
  lockMessage,
  onUpgrade,
  children,
}: {
  tierNumber: 1 | 2 | 3;
  title: string;
  unlocks: string;
  status: TierSection;
  defaultExpanded?: boolean;
  /** Controlled expansion (same contract as CollapsibleSection): pass both
   *  expanded + onToggle to let a parent open the card programmatically. */
  expanded?: boolean;
  onToggle?: (next: boolean) => void;
  cardRef?: React.Ref<HTMLDivElement>;
  /** When true, the card is visually muted and the children are replaced with a locked message + upgrade CTA. */
  locked?: boolean;
  /** Replaces the "Unlocks: ..." line when locked. E.g., "Requires AI Programming subscription". */
  lockMessage?: string;
  /** Click handler for the upgrade CTA shown when locked. */
  onUpgrade?: () => void;
  children: React.ReactNode;
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded && !locked);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const setExpanded = (updater: (prev: boolean) => boolean) => {
    const next = updater(expanded);
    if (!isControlled) setInternalExpanded(next);
    onToggle?.(next);
  };
  const accent = locked
    ? 'var(--text-muted)'
    : status.complete
      ? '#2ec486'
      : 'var(--accent)';
  return (
    <div
      className="settings-card"
      ref={cardRef}
      style={{
        borderColor: locked ? 'var(--border)' : status.complete ? '#2ec486' : undefined,
        opacity: locked ? 0.75 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 0,
          margin: 0,
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px',
              color: accent,
            }}>
              Step {tierNumber}
            </span>
            {locked ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Locked
              </span>
            ) : status.complete ? (
              <span style={{ fontSize: 12, color: '#2ec486', fontWeight: 700 }}>Complete ✓</span>
            ) : null}
          </div>
          <h2 className="settings-card-title" style={{ marginBottom: 2 }}>{title}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {locked && lockMessage ? lockMessage : `Unlocks: ${unlocks}`}
          </div>
        </div>
        <span style={{ fontSize: 14, color: 'var(--text-dim)', flexShrink: 0, marginLeft: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {locked ? (
            <div style={{ padding: 12, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
                {lockMessage || 'This tier requires a subscription.'}
              </div>
              {onUpgrade && (
                <button
                  type="button"
                  className="auth-btn"
                  onClick={onUpgrade}
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  Upgrade →
                </button>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

export default function AthletePage({ session }: { session: Session }) {
  // Stage D: the eval funnel's missing middle (opened the profile page).
  useEffect(() => { track('profile_started'); }, []);
  const [navOpen, setNavOpen] = useState(false);
  const [age, setAge] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [bodyweight, setBodyweight] = useState<string>('');
  const [units, setUnits] = useState<'lbs' | 'kg'>('lbs');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [lifts, setLifts] = useState<Record<string, number>>({});
  // Starts EMPTY, not seeded with defaults: the record only becomes non-empty
  // once the athlete actually reviews equipment (checkbox touch or Save
  // Equipment). An empty record is the "review required" signal — it keeps T3
  // incomplete, so programs can't generate against equipment nobody confirmed.
  const [equipment, setEquipment] = useState<Record<string, boolean>>({});
  // True once a non-empty equipment record has been persisted (loaded from the
  // DB, or saved this session). Drives the amber "review required" → green
  // "reviewed" header on the equipment card.
  const [equipmentReviewed, setEquipmentReviewed] = useState(false);
  const [equipSaved, setEquipSaved] = useState(false);
  const [skills, setSkills] = useState<Record<string, SkillLevel>>({});
  const [conditioning, setConditioning] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [isDirty, setIsDirty] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  // Eval result is no longer read (v3 generation reads the eval from the DB; it
  // used to feed v1's evaluation_id). Setter kept for the eval-complete flow.
  const [, setAnalysisResult] = useState<{ kind: 'profile'; text: string; evaluationId?: string | null } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<'profile' | null>(null);
  // Pre-run checkpoint on the eval button (Aug '26 relaxed conditioning gate):
  // 'required' blocks the run (no 2k row / no run time yet); 'soft' nudges when
  // the required numbers are in but optional athletic fields are still blank.
  const [evalCheckpoint, setEvalCheckpoint] = useState<null | 'required' | 'soft'>(null);
  // Tier 2 card + conditioning section expansion is controlled so the
  // checkpoint's "Add benchmarks" button can open them and scroll there.
  const [t2Expanded, setT2Expanded] = useState(false);
  const [condSectionOpen, setCondSectionOpen] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [hasGeneratedProgram, setHasGeneratedProgram] = useState(false);
  // Returner pause: set by the stripe webhook on a re-subscribe; the athlete
  // reviews their numbers and taps Build (which clears it server-side).
  const [resumePending, setResumePending] = useState(false);
  const [resumeBuildState, setResumeBuildState] = useState<'idle' | 'building' | 'error'>('idle');
  // TDEE override is no longer edited here (the TDEE card was removed from the
  // profile — to be reintegrated under Nutrition later). Kept so the saved value
  // round-trips through load/save and isn't lost.
  const [tdeeOverride, setTdeeOverride] = useState<string>('');
  // Tier 3 — training context
  const [daysPerWeek, setDaysPerWeek] = useState<string>('');
  const [sessionLengthMinutes, setSessionLengthMinutes] = useState<string>('');
  const [injuriesConstraints, setInjuriesConstraints] = useState<string>('');
  const [goal, setGoal] = useState<string>('');
  // Tier 3 card chrome: equipment collapse + which text box has focus (drives
  // the show-on-focus char counters).
  const [equipExpanded, setEquipExpanded] = useState(false);
  const [t3FocusedBox, setT3FocusedBox] = useState<string | null>(null);
  // Injury show-back confirmation (handoff 1.1). When a save re-parses non-empty
  // injuries text into a do-not-program list, we surface it against the athlete's
  // own words for sign-off BEFORE it becomes the active safety filter. `hash` binds
  // the confirmation to the exact text this parse ran against.
  const [injuryShowback, setInjuryShowback] = useState<
    { verbatim: string; list: string[]; hash: string } | null
  >(null);
  const [injuryAddInput, setInjuryAddInput] = useState('');
  const [injuryConfirmSaving, setInjuryConfirmSaving] = useState(false);
  const [injuryConfirmError, setInjuryConfirmError] = useState('');
  const [injuryConfirmedNote, setInjuryConfirmedNote] = useState(false);
  // True when the show-back is the one-time existing-user migration (T6) rather
  // than a fresh post-save parse — drives the top-of-page banner.
  const [injuryMigrationPrompt, setInjuryMigrationPrompt] = useState(false);
  // Qualitative coaching intake (free-text / voice) — its own save (LLM extract).
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeSaved, setIntakeSaved] = useState(false);
  const [intakeError, setIntakeError] = useState('');

  const navigate = useNavigate();
  const { hasFeature, isAdmin } = useEntitlements(session.user.id);

  // Evaluation history
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [trainingEvaluations, setTrainingEvaluations] = useState<TrainingEvaluation[]>([]);
  const [nutritionEvaluations, setNutritionEvaluations] = useState<NutritionEvaluation[]>([]);
  const [expandedEvalId, setExpandedEvalId] = useState<string | null>(null);
  const [evalHistoryOpen, setEvalHistoryOpen] = useState(false);
  const evalHistoryRef = useRef<HTMLDivElement | null>(null);
  const tier2Ref = useRef<HTMLDivElement | null>(null);
  const [evalCreditsRemaining, setEvalCreditsRemaining] = useState<number>(1);

  // Tier 4 — competition-history linkage. The /profile card only needs to know
  // whether it's linked (and the athlete's name); the full experience lives at
  // /competition-history.
  const [competitionAthleteId, setCompetitionAthleteId] = useState<string | null>(null);
  const [competitionAthleteLabel, setCompetitionAthleteLabel] = useState<string | null>(null);

  const fetchEvaluations = async () => {
    const [profileRes, trainingRes, nutritionRes] = await Promise.all([
      // Only surface complete evaluations. Pending/failed rows (created by
      // the async-job kickoff in profile-analysis) have analysis=null and
      // must not appear as "ready" in the status card.
      supabase
        .from('profile_evaluations')
        .select('id, profile_snapshot, analysis, structured_evaluation, created_at, month_number, visible')
        .eq('user_id', session.user.id)
        .eq('visible', true)
        .eq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('training_evaluations')
        .select('id, profile_snapshot, training_snapshot, analysis, created_at, month_number')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('nutrition_evaluations')
        .select('id, nutrition_snapshot, analysis, created_at, month_number')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (profileRes.data) {
      setEvaluations(profileRes.data);
    }
    if (trainingRes.data) {
      setTrainingEvaluations(trainingRes.data);
    }
    if (nutritionRes.data) {
      setNutritionEvaluations(nutritionRes.data);
    }
  };

  const loadProfile = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      supabase
        .from('athlete_profiles')
        .select('lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, tdee_override, days_per_week, session_length_minutes, injuries_constraints, goal, eval_credits_remaining, competition_athlete_id, competition_athlete_label, coaching_intake_raw, injuries_structured, injuries_constraints_hash, injuries_avoidance_confirmed, programming_resume_pending_at')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('profile_evaluations')
        .select('id, profile_snapshot, analysis, structured_evaluation, created_at, month_number, visible')
        .eq('user_id', session.user.id)
        .eq('visible', true)
        .eq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('training_evaluations')
        .select('id, profile_snapshot, training_snapshot, analysis, created_at, month_number')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('programs')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('source', 'generated')
        .limit(1),
    ]).then(([profileRes, evalRes, trainingEvalRes, programsRes]) => {
      setHasGeneratedProgram(!!(programsRes.data && programsRes.data.length > 0));
      setResumePending(!!profileRes.data?.programming_resume_pending_at);
      if (!profileRes.data) {
        setIsNewUser(true);
        setEquipExpanded(true); // brand-new profile: equipment review pending
      }
      if (profileRes.data) {
        const d = profileRes.data;
        setLifts(d.lifts || {});
        if (d.equipment && Object.keys(d.equipment).length > 0) {
          // Non-empty record = the athlete (or a pre-review save) already
          // confirmed their equipment — grandfathered straight to green.
          setEquipment(d.equipment);
          setEquipmentReviewed(true);
        } else {
          // Review pending: open the checklist so the required step is in
          // front of them the moment they expand Tier 3.
          setEquipExpanded(true);
        }
        setSkills(d.skills || {});
        setConditioning(d.conditioning || {});
        setAge(d.age != null ? String(d.age) : '');
        setHeight(d.height != null ? String(d.height) : '');
        setBodyweight(d.bodyweight != null ? String(d.bodyweight) : '');
        setUnits((d.units as 'lbs' | 'kg') || 'lbs');
        setGender((d.gender as 'male' | 'female') || '');
        setTdeeOverride(d.tdee_override != null ? String(d.tdee_override) : '');
        setDaysPerWeek(d.days_per_week != null ? String(d.days_per_week) : '');
        setSessionLengthMinutes(d.session_length_minutes != null ? String(d.session_length_minutes) : '');
        // "None" is the sentinel we save for "no constraints" (Tier-3 completion
        // + the generator both want a definite value). Show it as an EMPTY box so
        // the field reads "leave blank if none" consistently on reload.
        setInjuriesConstraints(d.injuries_constraints && d.injuries_constraints !== 'None' ? d.injuries_constraints : '');
        setGoal(d.goal || '');
        // Existing-user migration show-back (handoff 1.5 / T6): an athlete with
        // non-empty injuries text but no VALID confirmation (missing, or confirmed
        // against older text) is proactively prompted to sign off — BEFORE the
        // generation guard is enforced, so nobody hits the block cold. Same panel
        // and write path as the post-save show-back; the list is pre-populated
        // from the existing raw parse as a PENDING proposal (never auto-confirmed).
        {
          const dm = d as {
            injuries_structured?: { do_not_program?: string[] } | null;
            injuries_constraints_hash?: string | null;
            injuries_avoidance_confirmed?: { confirmed_against_hash?: string } | null;
          };
          const injText = (d.injuries_constraints ?? '').trim();
          const hasInjuries = injText !== '' && !/^(none|no|nothing|no injuries|n\/a)$/i.test(injText);
          const conf = dm.injuries_avoidance_confirmed ?? null;
          const confValid = !!conf && !!dm.injuries_constraints_hash &&
            conf.confirmed_against_hash === dm.injuries_constraints_hash;
          if (hasInjuries && !confValid) {
            setInjuryShowback({
              verbatim: injText,
              list: dm.injuries_structured?.do_not_program ?? [],
              hash: dm.injuries_constraints_hash ?? '',
            });
            setInjuryMigrationPrompt(true);
          }
        }
        {
          const raw = (d as { coaching_intake_raw?: Record<string, string> | null }).coaching_intake_raw;
          if (raw && typeof raw === 'object') setIntakeAnswers(raw);
        }
        setEvalCreditsRemaining(typeof d.eval_credits_remaining === 'number' ? d.eval_credits_remaining : 1);
        setCompetitionAthleteId((d as any).competition_athlete_id ?? null);
        setCompetitionAthleteLabel((d as any).competition_athlete_label ?? null);
        setIsDirty(false);
      }
      if (evalRes.data) {
        setEvaluations(evalRes.data);
      }
      if (trainingEvalRes.data) {
        setTrainingEvaluations(trainingEvalRes.data);
      }
      setLoading(false);
    }).catch((e) => {
      // A failed load (e.g. a transient network "Failed to fetch") must NOT
      // silently blank the form — that reads as "my data got wiped." Surface a
      // retry instead; the data is safe server-side.
      console.error('[AthletePage] profile load failed:', e);
      setLoadError(true);
      setLoading(false);
    });
  }, [session.user.id]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const markDirty = () => setIsDirty(true);

  // "Save & analyze" for Section 2 — persists the structured columns (goals +
  // injuries, via the full profile save) AND, when there are free-text intake
  // answers, LLM-extracts the structured coaching_intake (a short LLM call).
  // Goals/injuries alone save without touching the extractor (no NO_ANSWERS).
  const saveIntake = async () => {
    setIntakeSaving(true); setIntakeError(''); setIntakeSaved(false);
    try {
      const savedOk = await saveProfile();
      if (!savedOk) throw new Error('Failed to save your profile');
      const hasIntake = Object.values(intakeAnswers).some(v => v && v.trim());
      if (hasIntake) {
        const { data, error } = await supabase.functions.invoke('process-coaching-intake', {
          body: { answers: intakeAnswers },
        });
        const errMsg = (data as { error?: string } | null)?.error;
        if (error || errMsg) throw new Error(errMsg || error?.message || 'Failed to analyze your answers');
      }
      setIntakeSaved(true);
    } catch (e) {
      setIntakeError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setIntakeSaving(false);
    }
  };

  const setLift = (key: string, value: string) => {
    const num = clampLift(value, units); // clamp to [0, sane cap] — no 3,000 lb squats
    if (isNaN(num)) return;
    setLifts(prev => ({ ...prev, [key]: num }));
    markDirty();
  };

  const setSkill = (key: string, level: SkillLevel) => {
    setSkills(prev => ({ ...prev, [key]: level }));
    markDirty();
  };

  const setConditioningVal = (key: string, value: string | number) => {
    if (value === '' || value === null || value === undefined) {
      setConditioning(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setConditioning(prev => ({ ...prev, [key]: value }));
    }
    markDirty();
  };

  const fetchProfileAnalysis = async () => {
    setAnalysisLoading('profile');
    setAnalysisResult(null);
    setError('');
    try {
      // Kick off the async job — returns evaluation_id immediately.
      const { data: kickoff, error: kickoffErr } = await supabase.functions.invoke('profile-analysis', {
        body: {},
      });
      if (kickoffErr) {
        const m = await extractFunctionError(kickoffErr);
        throw new Error(m || 'Analysis failed');
      }
      if (kickoff?.error) throw new Error(kickoff.message || kickoff.error || 'Analysis failed');
      const evaluationId: string | null = kickoff?.evaluation_id ?? null;
      if (!evaluationId) throw new Error('No evaluation id returned');

      // Poll status. Mirrors handleGenerateProgram's backoff pattern.
      // Each poll is a fast (<500ms) request — iOS Safari tolerates these
      // fine even across screen locks, which is why we don't do the work
      // synchronously in the initial request.
      let delay = 3000;
      const maxDelay = 8000;
      const maxAttempts = 80; // ~400s worst case

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, delay));
        const { data: status, error: statusErr } = await supabase.functions.invoke('profile-analysis-status', {
          body: { evaluation_id: evaluationId },
        });
        if (statusErr) {
          const m = await extractFunctionError(statusErr);
          throw new Error(m || 'Failed to check analysis status');
        }
        if (status?.error && status?.status !== 'failed') throw new Error(status.error);

        if (status?.status === 'complete') {
          setAnalysisResult({
            kind: 'profile',
            text: status.analysis,
            evaluationId,
          });
          // A successful manual run consumed one eval credit server-side
          // (consume_eval_credit). Reflect it locally so "Run New" hides for a
          // free user instead of lingering and 403-ing on the next click.
          // (Admins keep it — hasEvalCredit short-circuits on isAdmin.)
          setEvalCreditsRemaining((c) => Math.max(0, c - 1));
          fetchEvaluations();
          return;
        }
        if (status?.status === 'failed') {
          throw new Error(status.error || 'Analysis failed');
        }
        delay = Math.min(delay + 1000, maxDelay);
      }
      throw new Error('Analysis timed out');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalysisLoading(null);
    }
  };

  const handleGenerateProgram = async () => {
    setGenerateLoading(true);
    setError('');
    try {
      // Kick off background generation — returns immediately with job_id
      const { data, error } = await supabase.functions.invoke('generate-program-v3', {
        body: {},
      });
      if (error) throw new Error(error.message || 'Failed to generate program');
      if (data?.error) throw new Error(data.message || data.error || 'Failed to generate program');
      const jobId = data?.job_id;
      if (!jobId) throw new Error('No job ID returned');

      // Poll for completion with backoff: 3s, 4s, 5s, 6s, ... capped at 8s.
      // Budget must exceed the real end-to-end job time: a 4-day athlete runs
      // ~13 min wall-clock (skeleton + 4 week-fills + benchmark + surgical
      // passes + save, each its own edge invocation), and a heavy 6-day athlete
      // longer. 150 attempts × ~8s ≈ 20 min, comfortably clear, so the UI no
      // longer reports a false timeout while the job is still completing.
      let delay = 3000;
      const maxDelay = 8000;
      const maxAttempts = 150; // ~20 min worth of polling
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, delay));
        const { data: status, error: statusErr } = await supabase.functions.invoke('program-job-status', {
          body: { job_id: jobId },
        });
        if (statusErr) throw new Error(statusErr.message || 'Failed to check job status');
        if (status?.error && status?.status !== 'failed') throw new Error(status.error);

        if (status?.status === 'complete') {
          if (status.program_id) {
            navigate(`/programs/${status.program_id}`);
            return;
          }
          throw new Error('Program completed but no ID returned');
        }
        if (status?.status === 'failed') {
          throw new Error(status.error || 'Program generation failed');
        }
        // Still pending/processing — back off slightly
        delay = Math.min(delay + 1000, maxDelay);
      }
      throw new Error('Program generation timed out');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate program');
    } finally {
      setGenerateLoading(false);
    }
  };

  // `overrides.equipment` lets the Save Equipment button persist the freshly
  // materialized full map in the same call that sets state — React state
  // updates are async, so reading `equipment` here right after setEquipment
  // would still see the stale map.
  const saveProfile = async (overrides?: { equipment?: Record<string, boolean> }): Promise<boolean> => {
    setSaving(true);
    setError('');

    // Only store non-zero lifts
    const cleanLifts: Record<string, number> = {};
    for (const [key, val] of Object.entries(lifts)) {
      if (val > 0) cleanLifts[key] = val;
    }

    const bw = bodyweight === '' ? null : parseFloat(bodyweight);
    const ageNum = age === '' ? null : parseInt(age, 10);
    const heightNum = height === '' ? null : parseFloat(height);
    const genderVal = gender === '' ? null : gender;

    const cleanConditioning: Record<string, string | number> = {};
    for (const [key, val] of Object.entries(conditioning)) {
      if (val !== '' && val != null) {
        const b = CONDITIONING_GROUPS.flatMap(g => g.benchmarks).find(bm => bm.key === key);
        if (b?.isTime) {
          // Only persist a valid time, normalized to mm:ss — drop garbage so it
          // never reaches the coaching state / benchmark scoring.
          const s = String(val).trim();
          if (isValidTimeStr(s)) cleanConditioning[key] = normalizeTimeStr(s);
        } else {
          cleanConditioning[key] = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
        }
      }
    }

    const tdeeOverrideNum = tdeeOverride === '' ? null : parseFloat(tdeeOverride);

    const levels = classifyAthlete({
      bodyweight: bw && !isNaN(bw) ? bw : null,
      gender: genderVal,
      units,
      lifts: cleanLifts,
    });

    const daysPerWeekNum = daysPerWeek === '' ? null : parseInt(daysPerWeek, 10);
    const sessionLengthNum = sessionLengthMinutes === '' ? null : parseInt(sessionLengthMinutes, 10);
    // Default empty injuries field to "None" so T3 still completes for
    // users who have no constraints and skip the field.
    const injuriesVal = injuriesConstraints.trim() === '' ? 'None' : injuriesConstraints.trim();

    // Fill any unrated skill with 'none' on save. The UI already shows
    // None as the default selection for unrated skills (via `|| 'none'`
    // in the button className), so persisting that defaulted value keeps
    // the DB aligned with what the user sees. Tier 2 completion keys on
    // the presence of every skill key — without this, users who scroll
    // past skills they can't do silently leave them out of the jsonb
    // and Tier 2 never ticks off.
    const filledSkills: Record<string, SkillLevel> = { ...skills };
    for (const group of SKILL_GROUPS) {
      for (const skill of group.skills) {
        if (!filledSkills[skill.key]) filledSkills[skill.key] = 'none';
      }
    }

    const payload = {
      user_id: session.user.id,
      lifts: cleanLifts,
      // Untouched equipment saves as {} — the review stays pending. The record
      // only becomes non-empty via checkbox interaction or Save Equipment
      // (both materialize the FULL key map first, never a partial one).
      equipment: overrides?.equipment ?? equipment,
      skills: filledSkills,
      conditioning: cleanConditioning,
      bodyweight: bw && !isNaN(bw) ? bw : null,
      units,
      age: ageNum && !isNaN(ageNum) ? ageNum : null,
      height: heightNum && !isNaN(heightNum) ? heightNum : null,
      gender: genderVal,
      tdee_override: tdeeOverrideNum && !isNaN(tdeeOverrideNum) ? tdeeOverrideNum : null,
      days_per_week: daysPerWeekNum && !isNaN(daysPerWeekNum) ? daysPerWeekNum : null,
      session_length_minutes: sessionLengthNum && !isNaN(sessionLengthNum) ? sessionLengthNum : null,
      injuries_constraints: injuriesVal,
      goal: goal.trim() || null,
      ...levels,
      updated_at: new Date().toISOString(),
    };

    // iOS Safari occasionally drops the first fetch after an idle period
    // with a transport-level "TypeError: Load failed". supabase-js sometimes
    // surfaces that in { error }, sometimes as a thrown exception — handle
    // both, and retry once on the network-class messages before giving up.
    const attempt = async (): Promise<string | null> => {
      try {
        const { error } = await supabase
          .from('athlete_profiles')
          .upsert(payload, { onConflict: 'user_id' });
        return error?.message ?? null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };
    const isNetworkError = (msg: string | null) =>
      !!msg && /load failed|failed to fetch|networkerror/i.test(msg);

    let errMsg: string | null = null;
    try {
      errMsg = await attempt();
      if (isNetworkError(errMsg)) {
        await new Promise((r) => setTimeout(r, 500));
        errMsg = await attempt();
      }
    } finally {
      setSaving(false);
    }

    if (errMsg) {
      setError(errMsg);
      return false;
    }
    // Clear isNewUser and isDirty but STAY on /profile. The evaluation
    // flow (Save & Run Free Evaluation → Running… → Your evaluation is
    // ready) only works if the user stays on this page to see the
    // status card and button flip through their states. The legacy
    // "navigate to chat on first save" behavior actively broke that
    // flow by unmounting the component mid-click.
    if (isNewUser) setIsNewUser(false);
    setIsDirty(false);
    // Any save that persisted a non-empty equipment record completes the
    // review — this is exactly the signal the T3 gate reads, so header state
    // and gate can never drift.
    if (Object.keys(payload.equipment).length > 0) setEquipmentReviewed(true);

    // Parse the (possibly updated) injuries text into a structured do-not-program
    // list. The edge fn hash-checks internally, so an unchanged text returns a
    // `skipped` no-op. When it returns a fresh non-empty list, drive the show-back
    // (handoff 1.1): the athlete confirms it against their own words before it
    // becomes the active safety filter. Runs after save returns so the save UX
    // isn't blocked on the LLM parse; the panel pops when the parse completes.
    // Bounded retry on transient failure (T2); on PERSISTENT failure, drop into the
    // manual add-avoidances panel — confirmation there is LLM-independent (local
    // hash), so a parser outage never leaves the athlete unable to confirm.
    void (async () => {
      const maxAttempts = 3;
      let lastErr = '';
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke('parse-injuries-constraints', { body: {} });
          const errMsg = (data as { error?: string } | null)?.error;
          if (error || errMsg) {
            lastErr = errMsg || error?.message || 'parse failed';
            if (attempt < maxAttempts) { await new Promise(r => setTimeout(r, attempt * 800)); continue; }
            break;
          }
          const structured = (data as { structured?: { do_not_program?: string[] }; hash?: string } | null);
          const list = structured?.structured?.do_not_program ?? [];
          const hash = structured?.hash ?? '';
          // Only confirm when there's something to protect. Empty list (no injuries /
          // cleared) needs no sign-off — the generation guard only gates non-empty text.
          if (list.length > 0 && hash) {
            setInjuryConfirmError('');
            setInjuryConfirmedNote(false);
            setInjuryMigrationPrompt(false); // a fresh post-save parse supersedes the migration prompt
            setInjuryShowback({ verbatim: injuriesVal, list, hash });
          }
          return; // success (including the legitimately-empty case)
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt < maxAttempts) { await new Promise(r => setTimeout(r, attempt * 800)); continue; }
        }
      }
      // Persistent failure after retries. Structured tag for log-based monitoring
      // (no dedicated alert channel — see docs). Manual fallback keeps the path open:
      // empty list to build by hand, confirmed via the local-hash path.
      console.error(JSON.stringify({ tag: 'injury_parse_failed', at: 'AthletePage.saveProfile', error: lastErr }));
      setInjuryConfirmError("We couldn't process your injury notes — review and confirm the movements to avoid below.");
      setInjuryShowback({ verbatim: injuriesVal, list: [], hash: '' });
    })();

    return true;
  };

  // Show-back editing (handoff 1.1): the athlete's final list may differ from the
  // raw parse — remove a false positive, add something the parse missed.
  const removeInjuryMovement = (m: string) =>
    setInjuryShowback(prev => (prev ? { ...prev, list: prev.list.filter(x => x !== m) } : prev));
  const addInjuryMovement = () => {
    const v = injuryAddInput.trim();
    if (!v) return;
    setInjuryShowback(prev =>
      prev && !prev.list.some(x => x.toLowerCase() === v.toLowerCase())
        ? { ...prev, list: [...prev.list, v] }
        : prev,
    );
    setInjuryAddInput('');
  };

  // Confirm: write the athlete-signed avoidance list as the ACTIVE safety filter,
  // bound to the exact current text. The hash is computed LOCALLY from the athlete's
  // own words (sha256Hex) — never via the LLM parser — so confirmation works even
  // during a parse-service outage (the guard hashes the same current text, so they
  // match). This is the always-available path the manual fallback depends on.
  const confirmInjuryAvoidances = async () => {
    if (!injuryShowback) return;
    setInjuryConfirmSaving(true);
    setInjuryConfirmError('');
    try {
      const hash = await sha256Hex(injuryShowback.verbatim.trim());
      const { error } = await supabase
        .from('athlete_profiles')
        .update({
          injuries_avoidance_confirmed: {
            do_not_program: injuryShowback.list,
            confirmed_at: new Date().toISOString(),
            confirmed_against_hash: hash,
          },
        })
        .eq('user_id', session.user.id);
      if (error) throw new Error(error.message);
      setInjuryShowback(null);
      setInjuryAddInput('');
      setInjuryMigrationPrompt(false);
      setInjuryConfirmedNote(true);
    } catch (e) {
      setInjuryConfirmError(e instanceof Error ? e.message : 'Could not save your confirmation');
    } finally {
      setInjuryConfirmSaving(false);
    }
  };

  // Live tier status, computed from current form state (not yet saved values).
  // Mirror the save-time backfill: treat unrated skills as 'none' so T2 ticks
  // complete as soon as the user fills lifts + conditioning, without needing
  // to tap every single skill in the UI. Matches the "defaults to None — tap
  // to upgrade" hint shown above the skills grid.
  const filledSkillsForTierCheck: Record<string, SkillLevel> = { ...skills };
  for (const group of SKILL_GROUPS) {
    for (const s of group.skills) {
      if (!filledSkillsForTierCheck[s.key]) filledSkillsForTierCheck[s.key] = 'none';
    }
  }
  const tierStatusInput: AthleteProfileInput = {
    age: age ? parseInt(age, 10) : null,
    height: height ? parseFloat(height) : null,
    bodyweight: bodyweight ? parseFloat(bodyweight) : null,
    gender: gender || null,
    units,
    lifts,
    skills: filledSkillsForTierCheck,
    conditioning,
    equipment,
    days_per_week: daysPerWeek ? parseInt(daysPerWeek, 10) : null,
    session_length_minutes: sessionLengthMinutes ? parseInt(sessionLengthMinutes, 10) : null,
    injuries_constraints: injuriesConstraints.trim() || 'None',
    goal: goal.trim() || null,
  };
  const tierStatus = getTierStatus(tierStatusInput);

  // --- Pre-run checkpoint inputs (mirrors the tier-status conditioning gate,
  // computed from live form state so the flag reflects what's on screen). ---
  const isCondFilled = (v: string | number | null | undefined): boolean =>
    v != null && (typeof v === 'number' ? v > 0 : String(v).trim() !== '');
  const condRequiredMissing =
    !isCondFilled(conditioning['2k_row']) ||
    !(isCondFilled(conditioning['1_mile_run']) || isCondFilled(conditioning['5k_run']));
  // Blank optional athletic fields, most-valuable first (conditioning depth,
  // then the non-required lifts), for the soft checkpoint's specifics line.
  const softGapPhrases: string[] = [];
  for (const group of CONDITIONING_GROUPS) {
    for (const bm of group.benchmarks) {
      if (!isCondFilled(conditioning[bm.key])) {
        softGapPhrases.push(CONDITIONING_GAP_PHRASES[bm.key] ?? bm.label.toLowerCase());
      }
    }
  }
  for (const group of LIFT_GROUPS) {
    for (const lift of group.lifts) {
      if (!(lifts[lift.key] > 0)) softGapPhrases.push(`${lift.label.toLowerCase()} 1RM`);
    }
  }

  const proceedWithEval = async () => {
    setEvalCheckpoint(null);
    if (isDirty) {
      const ok = await saveProfile();
      if (!ok) return;
    }
    fetchProfileAnalysis();
  };
  const jumpToConditioning = () => {
    setEvalCheckpoint(null);
    setT2Expanded(true);
    setCondSectionOpen(true);
    requestAnimationFrame(() => {
      tier2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Athlete Profile</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {injuryMigrationPrompt && injuryShowback && (
              <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)' }}>
                <h2 className="settings-card-title" style={{ marginBottom: 6 }}>Confirm your avoidances</h2>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, margin: 0 }}>
                  We now ask you to sign off on the movements we'll keep out of your programming.
                  Scroll to the <strong>Exercises you'd prefer we avoid</strong> field below to review and confirm — it takes a few seconds.
                </p>
              </div>
            )}
            {/* ONE orientation card while setting up (replaces the old new-user
                intro AND the locked-state eval progress line — two meta-cards
                narrating the same journey). Live checkmarks + a "next up" line;
                hides once the eval unlocks and the Run Evaluation card takes
                over as the hero. "Step", never "Tier", in user-facing copy. */}
            {!loading && !loadError && !tierStatus.canRunEval && (() => {
              const hasProgramming = isAdmin || hasFeature('programming');
              const steps: Array<[boolean, string, React.ReactNode]> = [
                [tierStatus.tier1.complete, 'Basics', <>tailored answers from the <span style={{ color: 'var(--accent)', fontWeight: 600 }}>AI Coach</span></>],
                [tierStatus.tier2.complete, 'Athletic Data', <>unlocks your free <span style={{ color: 'var(--accent)', fontWeight: 600 }}>AI Evaluation</span></>],
                [tierStatus.tier3.complete, 'Training Context', hasProgramming
                  ? <>powers your <span style={{ color: 'var(--accent)', fontWeight: 600 }}>AI Programming</span> — built around your goals, fitness level, and schedule</>
                  : <>subscribe to unlock <span style={{ color: 'var(--accent)', fontWeight: 600 }}>AI Programming</span> built around your goals, fitness level, and schedule</>],
              ];
              const next = !tierStatus.tier1.complete ? 'Basics' : 'Athletic Data';
              return (
                <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)' }}>
                  <h2 className="settings-card-title" style={{ marginBottom: 8 }}>Your profile powers everything</h2>
                  <ul style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0, paddingLeft: 4, listStyle: 'none' }}>
                    {steps.map(([done, name, desc], i) => (
                      <li key={name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span aria-hidden style={{ color: done ? '#2ec486' : 'var(--text-muted)', fontWeight: 700, flexShrink: 0 }}>{done ? '✓' : '○'}</span>
                        <span><strong style={{ color: 'var(--text)' }}>Step {i + 1} — {name}</strong> · {desc}</span>
                      </li>
                    ))}
                  </ul>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, marginTop: 10 }}>Next up: {next} ↓</div>
                </div>
              );
            })()}
            {error && <div className="auth-error" style={{ display: 'block' }}>{error}</div>}

            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : loadError ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>Couldn’t load your profile — check your connection and try again. Your data is safe.</p>
                <button className="auth-btn" style={{ maxWidth: 200 }} onClick={() => loadProfile()}>Retry</button>
              </div>
            ) : (
              <>
                {/* Returner welcome-back banner — the stripe webhook paused this
                    re-subscriber's next month (resume-pending) so it builds from
                    numbers they've just reviewed, not the profile they left
                    behind. Build calls generate-next-month (continuation path —
                    appends month N+1 to their existing program; the first-gen
                    button below stays hidden since a program exists) and the
                    server clears the flag on kickoff. */}
                {resumePending && hasGeneratedProgram && (
                  <div className="workout-review-section" style={{ border: '1px solid var(--accent)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Welcome back 👋</div>
                    {resumeBuildState === 'building' ? (
                      <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
                        Building your next month from your numbers — it'll appear in <a href="/programs" style={{ color: 'var(--accent)' }}>your programs</a> in a few minutes.
                      </p>
                    ) : (
                      <>
                        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px' }}>
                          Your next training month gets built from the numbers below. Take a minute to review them — update anything that changed while you were away — then build.
                        </p>
                        <button
                          type="button"
                          className="auth-btn"
                          onClick={async () => {
                            setResumeBuildState('building');
                            // Unsaved profile edits ride along: save first so the
                            // generation reads what the athlete just confirmed.
                            if (isDirty) await saveProfile();
                            const { error } = await supabase.functions.invoke('generate-next-month', { body: {} });
                            // Success keeps the banner in its 'building' state; the
                            // server cleared the flag, so next page load it's gone.
                            if (error) setResumeBuildState('error');
                          }}
                          style={{ maxWidth: 260 }}
                        >
                          Build my next month
                        </button>
                        {resumeBuildState === 'error' && (
                          <div className="auth-error" style={{ display: 'block', marginTop: 10 }}>
                            Couldn't start the build — try again in a minute, or just leave it: your month builds automatically within a few days either way.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {/* Evaluation Status Card — first-class entry point for the free Tier 2 evaluation.
                    Four states based on tier completeness + evaluation existence + current analysis run. */}
                {(() => {
                  const hasEvaluation = evaluations.length > 0;
                  const hasEvalCredit = isAdmin || evalCreditsRemaining > 0;
                  const canRun = tierStatus.canRunEval && hasEvalCredit;
                  const running = analysisLoading === 'profile';
                  const latestEval = evaluations[0];
                  if (running) {
                    return (
                      <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div className="loading-pulse" style={{ width: 20, height: 20, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Running your evaluation…</div>
                            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>This takes 20–30 seconds.</div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (hasEvaluation) {
                    const when = latestEval.created_at
                      ? new Date(latestEval.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                      : '';
                    return (
                      <div className="settings-card" style={{ borderColor: '#2ec486' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: '#2ec486', marginBottom: 4 }}>
                              AI Evaluation · Ready
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600 }}>Your evaluation is ready</div>
                            {when && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Last run: {when}</div>}
                            {!hasEvalCredit && (
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                                Subscribers receive ongoing monthly analysis automatically.
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {hasEvalCredit && (
                              <button
                                className="auth-btn"
                                style={{ padding: '8px 16px', fontSize: 13 }}
                                onClick={async () => {
                                  if (isDirty) {
                                    const ok = await saveProfile();
                                    if (!ok) return;
                                  }
                                  fetchProfileAnalysis();
                                }}
                                disabled={saving || !!analysisLoading}
                              >
                                Run New
                              </button>
                            )}
                            <button
                              className="auth-btn"
                              style={{ padding: '8px 16px', fontSize: 13 }}
                              onClick={() => {
                                setExpandedEvalId(latestEval.id);
                                setEvalHistoryOpen(true);
                                requestAnimationFrame(() => {
                                  evalHistoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                });
                              }}
                            >
                              View Evaluation →
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  // Tier complete but credit used (rare — eval row deleted/failed
                  // and never replaced). Tell the user explicitly so they're not
                  // stuck staring at a profile that "looks ready" but has no run
                  // button and no ready-card.
                  if (tierStatus.canRunEval && !hasEvalCredit) {
                    return (
                      <div className="settings-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-muted)', marginBottom: 4 }}>
                              Free AI Evaluation · Used
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600 }}>You've used your free evaluation</div>
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                              Subscribers receive ongoing monthly analysis automatically.
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  // The run card also shows when ONLY the conditioning requirement
                  // (2k row + one run) is still open — clicking Run then flags the
                  // gap instead of the form marking fields required. Any other gap
                  // (basics, key lifts) keeps the card hidden as before.
                  const onlyCondBlocking =
                    !tierStatus.canRunEval &&
                    tierStatus.tier1.complete &&
                    tierStatus.tier2.missing.every((m) => m === 'conditioning');
                  if (canRun || (hasEvalCredit && onlyCondBlocking)) {
                    const showRequired = evalCheckpoint === 'required' && condRequiredMissing;
                    const showSoft = evalCheckpoint === 'soft' && !condRequiredMissing && softGapPhrases.length > 0;
                    return (
                      <>
                        <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 4 }}>
                                {canRun ? 'Free AI Evaluation · Ready to run' : 'Free AI Evaluation'}
                              </div>
                              <div style={{ fontSize: 15, fontWeight: 600 }}>
                                {canRun ? 'Your profile is ready — run your free evaluation' : 'Run your free evaluation'}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Takes 20–30 seconds. You'll get a personalized breakdown of your strengths, weaknesses, and priorities.</div>
                            </div>
                            <button
                              className="auth-btn"
                              style={{ padding: '10px 20px', fontSize: 14, background: 'var(--accent)', color: 'white' }}
                              onClick={async () => {
                                if (condRequiredMissing) {
                                  setEvalCheckpoint('required');
                                  return;
                                }
                                if (softGapPhrases.length > 0) {
                                  setEvalCheckpoint('soft');
                                  return;
                                }
                                await proceedWithEval();
                              }}
                              disabled={saving || !!analysisLoading}
                            >
                              Run Evaluation →
                            </button>
                          </div>
                        </div>
                        {showRequired && (
                          <div className="settings-card" style={{ borderColor: 'var(--text-dim)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 8 }}>
                              Almost there
                            </div>
                            <p style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.55 }}>
                              <strong>Two benchmarks anchor your conditioning read:</strong> a 2k row, and one run — your mile or your 5k, whichever you do.
                            </p>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
                              An estimate is fine. Add those and your evaluation is ready to run.
                            </p>
                            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                              <button type="button" className="auth-btn" style={{ padding: '10px 18px', fontSize: 13, background: 'var(--accent)', color: 'white' }} onClick={jumpToConditioning}>
                                Add benchmarks
                              </button>
                            </div>
                          </div>
                        )}
                        {showSoft && (
                          <div className="settings-card" style={{ borderColor: 'var(--text-dim)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 8 }}>
                              Before you run it
                            </div>
                            <p style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.55 }}>
                              <strong>This is your free evaluation</strong> — one letter, built from everything you've entered.
                            </p>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
                              A few numbers are still blank — {describeGaps(softGapPhrases)} would sharpen the read.
                            </p>
                            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                              <button type="button" className="auth-btn" style={{ padding: '10px 16px', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)' }} onClick={jumpToConditioning}>
                                Add numbers first
                              </button>
                              <button type="button" className="auth-btn" style={{ padding: '10px 18px', fontSize: 13, background: 'var(--accent)', color: 'white' }} onClick={proceedWithEval} disabled={saving || !!analysisLoading}>
                                Run with what I have
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  }
                  // Locked — render nothing here: the orientation card at the
                  // top ("Your profile powers everything", live checkmarks +
                  // next-up line) narrates the journey until the eval unlocks.
                  return null;
                })()}

                {/* Tier 1 — Basics */}
                <TierCard
                  tierNumber={1}
                  title="Basics"
                  unlocks="Tailored answers from the AI Coach"
                  status={tierStatus.tier1}
                  defaultExpanded={false}
                >
                  <div className="lift-grid" style={{ marginBottom: 16 }}>
                    <div className="lift-item">
                      <span className="lift-label">Units</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={'skill-level-btn' + (units === 'lbs' ? ' active' : '')}
                          onClick={() => { setUnits('lbs'); markDirty(); }}
                        >
                          Imperial (lbs / in)
                        </button>
                        <button
                          type="button"
                          className={'skill-level-btn' + (units === 'kg' ? ' active' : '')}
                          onClick={() => { setUnits('kg'); markDirty(); }}
                        >
                          Metric (kg / cm)
                        </button>
                      </div>
                    </div>
                    <div className="lift-item">
                      <span className="lift-label">Age</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="1"
                        max="120"
                        placeholder="—"
                        value={age}
                        onChange={e => { setAge(e.target.value); markDirty(); }}
                      />
                    </div>
                    <div className="lift-item">
                      <span className="lift-label">Height ({units === 'kg' ? 'cm' : 'in'})</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="0"
                        step={units === 'lbs' ? 1 : 0.1}
                        placeholder="—"
                        value={height}
                        onChange={e => { setHeight(e.target.value); markDirty(); }}
                      />
                    </div>
                    <div className="lift-item">
                      <span className="lift-label">Weight ({units === 'kg' ? 'kg' : 'lbs'})</span>
                      <input
                        className="lift-input"
                        type="number"
                        min="0"
                        step={units === 'lbs' ? 5 : 2}
                        placeholder="0"
                        value={bodyweight}
                        onChange={e => { setBodyweight(e.target.value); markDirty(); }}
                      />
                    </div>
                    <div className="lift-item">
                      <span className="lift-label">Gender</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={'skill-level-btn' + (gender === 'male' ? ' active' : '')}
                          onClick={() => { setGender('male'); markDirty(); }}
                        >
                          Male
                        </button>
                        <button
                          type="button"
                          className={'skill-level-btn' + (gender === 'female' ? ' active' : '')}
                          onClick={() => { setGender('female'); markDirty(); }}
                        >
                          Female
                        </button>
                      </div>
                    </div>
                  </div>
                </TierCard>

                {/* Tier 2 — Athletic Data */}
                <TierCard
                  tierNumber={2}
                  title="Athletic Data"
                  unlocks="Free AI Evaluation"
                  status={tierStatus.tier2}
                  expanded={t2Expanded}
                  onToggle={setT2Expanded}
                  cardRef={tier2Ref}
                >
                <p className="athlete-card-subtitle" style={{ marginBottom: 16 }}>
                  We use this information to build your evaluation. Enter as much as you can — scientific
                  precision not required, a general idea is fine.
                </p>
                <CollapsibleSection title={`1RM Lifts (${units})`}>
                  <p className="athlete-card-subtitle">Enter your one-rep max weights in {units}</p>
                  {LIFT_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>{group.title}</h3>
                      <div className="lift-grid">
                        {group.lifts.map(lift => (
                          <div className="lift-item" key={lift.key}>
                            <span className="lift-label">{lift.label}</span>
                            <input
                              className="lift-input"
                              type="number"
                              min="0"
                              max={maxLift(units)}
                              step={units === 'kg' ? 2.5 : 5}
                              placeholder="0"
                              value={lifts[lift.key] || ''}
                              onChange={e => setLift(lift.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CollapsibleSection>

                {/* Skills Assessment */}
                <CollapsibleSection title="Skills Assessment">
                  <p className="athlete-card-subtitle">Every skill defaults to <strong>None</strong> — tap to upgrade any you can do.</p>
                  <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 16 }}>
                    {SKILL_LEVEL_LEGEND.map(([level, desc]) => (
                      <div key={level}><strong style={{ color: 'var(--text)' }}>{level}</strong> — {desc}</div>
                    ))}
                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>Not sure? Pick lower. Your program adjusts fast from your results.</div>
                  </div>
                  {SKILL_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 24 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 12 }}>{group.title}</h3>
                      <div className="skill-list">
                        {group.skills.map(skill => (
                          <div className="skill-row" key={skill.key}>
                            <span className="skill-name">{skill.label}</span>
                            <div className="skill-levels">
                              {SKILL_LEVELS.map(level => (
                                <button
                                  key={level}
                                  className={'skill-level-btn' + ((skills[skill.key] || 'none') === level ? ' active' : '')}
                                  onClick={() => setSkill(skill.key, level)}
                                  type="button"
                                >
                                  {LEVEL_LABELS[level]}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CollapsibleSection>

                {/* Conditioning Benchmarks */}
                <CollapsibleSection title="Conditioning Benchmarks" expanded={condSectionOpen} onToggle={setCondSectionOpen}>
                  <p className="athlete-card-subtitle">Running and rowing times (MM:SS), bike in calories.</p>
                  {CONDITIONING_GROUPS.map(group => (
                    <div key={group.title} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>{group.title}</h3>
                      <div className="lift-grid">
                        {group.benchmarks.map(bm => {
                          const rawVal = conditioning[bm.key] ?? '';
                          const timeInvalid = !!bm.isTime && typeof rawVal === 'string' && rawVal.trim() !== '' && !isValidTimeStr(rawVal);
                          return (
                          <div className="lift-item" key={bm.key}>
                            <span className="lift-label">{bm.label}</span>
                            <input
                              className="lift-input"
                              type={bm.isTime ? 'text' : 'number'}
                              min={bm.isTime ? undefined : 0}
                              title={timeInvalid ? 'Use mm:ss (e.g. 6:45)' : undefined}
                              placeholder={bm.placeholder}
                              value={rawVal}
                              onChange={e => setConditioningVal(bm.key, bm.isTime ? filterTimeChars(e.target.value) : (e.target.value === '' ? '' : parseInt(e.target.value, 10) || 0))}
                              style={timeInvalid ? { borderColor: 'var(--danger, #e5484d)' } : undefined}
                            />
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CollapsibleSection>
                </TierCard>

                {/* Tier 3 — Training Context (locked for non-subscribers) */}
                <TierCard
                  tierNumber={3}
                  title="Training Context"
                  unlocks="Personalized AI Programming"
                  status={tierStatus.tier3}
                  defaultExpanded={false}
                  locked={!isAdmin && !hasFeature('programming')}
                  lockMessage="Requires AI Programming or All Access subscription"
                  onUpgrade={() => navigate('/features/programs')}
                >
                  {/* Card 1 — YOUR SCHEDULE (session length dropped Aug '26 — no
                      longer required for T3; stored values still feed the writer) */}
                  <div className="settings-card" style={T3_CARD}>
                    <div style={CTA_KICKER}>Your Schedule</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>How many days a week can you train?</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <input
                        className="lift-input"
                        type="number"
                        min="3"
                        max="6"
                        placeholder="—"
                        aria-label="Days per week"
                        value={daysPerWeek}
                        onChange={e => { setDaysPerWeek(e.target.value); markDirty(); }}
                        style={{ width: 92, textAlign: 'center', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>3–6 days. Your program is built to fit — no filler days.</span>
                    </div>
                  </div>

                  {/* Card 2 — YOUR EQUIPMENT: a required one-time review. The
                      record persists empty until the athlete saves it, which
                      keeps T3 incomplete — no programs against equipment
                      nobody confirmed. Header: amber demand → green done. */}
                  <div className="settings-card" style={{ ...T3_CARD, marginTop: 16 }}>
                    <button
                      type="button"
                      onClick={() => setEquipExpanded(v => !v)}
                      aria-expanded={equipExpanded}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 0, margin: 0, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                    >
                      <div>
                        <div style={{ ...CTA_KICKER, marginBottom: 4 }}>Your Equipment</div>
                        {equipmentReviewed ? (
                          <div style={{ fontSize: 14, color: '#2ec486', fontWeight: 600 }}>✓ Equipment reviewed</div>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--warning, #f39c12)', fontWeight: 600 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning, #f39c12)', flex: 'none' }} />
                            Equipment review required
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 14, color: 'var(--text-dim)', flex: 'none' }}>{equipExpanded ? '▲' : '▼'}</span>
                    </button>
                    {equipExpanded && (
                      <div style={{ marginTop: 16 }}>
                        <p className="athlete-card-subtitle">Uncheck anything you don't have. We'll never program it.</p>
                        {EQUIPMENT_GROUPS.map(group => (
                          <div key={group.title} style={{ marginBottom: 20 }}>
                            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>{group.title}</h3>
                            <div className="skill-list">
                              {group.items.map(item => (
                                <label
                                  key={item.key}
                                  className="skill-row"
                                  style={{ cursor: 'pointer', userSelect: 'none' }}
                                >
                                  <span className="skill-name">{item.label}</span>
                                  <input
                                    type="checkbox"
                                    checked={equipment[item.key] ?? true}
                                    onChange={e => {
                                      // Materialize the FULL map on any touch so a
                                      // save never persists a partial (= lying) record.
                                      setEquipment(prev => ({ ...materializeEquipment(prev), [item.key]: e.target.checked }));
                                      markDirty();
                                      setEquipSaved(false);
                                    }}
                                    style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer' }}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="auth-btn"
                          disabled={saving}
                          onClick={async () => {
                            const full = materializeEquipment(equipment);
                            setEquipment(full);
                            const ok = await saveProfile({ equipment: full });
                            if (ok) setEquipSaved(true);
                          }}
                          style={{ padding: '8px 16px', fontSize: 13, ...(equipSaved && !saving ? { background: '#2ec486', color: 'white' } : {}) }}
                        >
                          {saving ? 'Saving…' : equipSaved ? 'Saved ✓' : 'Save Equipment'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Card 3 — YOUR COACH: ALL the free-text / voice. One
                      "Save & analyze" persists goals/injuries (via the full
                      profile save) AND runs the intake extraction. */}
                  <div className="settings-card" style={{ ...T3_CARD, marginTop: 16 }}>
                    <div style={{ ...CTA_KICKER, marginBottom: 12 }}>Your Coach</div>

                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>What are you working toward?</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                        General goals are useful — specific ones are even better. <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>This is what your program gets built around.</span>
                      </div>
                      <textarea
                        className="lift-input"
                        rows={3}
                        maxLength={500}
                        placeholder='e.g. "Get stronger overall" · "First bar muscle-up by spring" · "Sub-20 5k without losing my squat"'
                        value={goal}
                        onChange={e => { setGoal(e.target.value); markDirty(); setIntakeSaved(false); }}
                        onFocus={() => setT3FocusedBox('goal')}
                        onBlur={() => setT3FocusedBox(f => (f === 'goal' ? null : f))}
                        style={{
                          width: '100%', resize: 'vertical', fontFamily: 'inherit', textAlign: 'left',
                          // The page's one accent element: red border while the
                          // required box is empty, settles to neutral once filled.
                          ...(goal.trim() === '' ? { borderColor: 'var(--accent)' } : {}),
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 5 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: goal.trim() ? '#2ec486' : 'var(--text-dim)' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: goal.trim() ? '#2ec486' : 'var(--accent)', flex: 'none' }} />
                          {goal.trim() ? 'Got it — your program builds around this' : "Required — this is the one your coach can't skip"}
                        </span>
                        <span style={t3CounterStyle(goal.length, t3FocusedBox === 'goal' || goal.length > 0)}>{goal.length} / 500</span>
                      </div>
                    </div>

                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                        Any injuries or exercises we should avoid? <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>(optional)</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                        Anything you list here stays out of your program — we'll never program it. No injuries? Leave this blank.
                      </div>
                      {/* Deliberately a PREFERENCE, not a health question (founder decision
                          2026-07-12, supersedes the 3.1 consent line): we never ask WHY, so the
                          field solicits no Art. 9 health data and needs no consent notice. If a
                          user volunteers a reason anyway, it stays in this raw field only — the
                          parser emits movement names, never reasons. */}
                      <textarea
                        className="lift-input"
                        rows={2}
                        maxLength={500}
                        value={injuriesConstraints}
                        onChange={e => { setInjuriesConstraints(e.target.value); markDirty(); setIntakeSaved(false); }}
                        onFocus={() => setT3FocusedBox('injuries')}
                        onBlur={() => setT3FocusedBox(f => (f === 'injuries' ? null : f))}
                        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', textAlign: 'left' }}
                      />
                      <div style={{ ...t3CounterStyle(injuriesConstraints.length, t3FocusedBox === 'injuries' || injuriesConstraints.length > 0), marginTop: 4 }}>
                        {injuriesConstraints.length} / 500
                      </div>
                      {injuryConfirmedNote && !injuryShowback && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#2ec486' }}>
                          ✓ Avoidances confirmed — we'll keep these out of your programming.
                        </div>
                      )}
                    </div>

                    {/* Show-back confirmation (handoff 1.1): sign off on the avoidance
                        list, shown against your own words, before it goes active. */}
                    {injuryShowback && (
                      <div style={{ marginBottom: 16, padding: 14, borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-glow)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                          Confirm the movements we'll avoid
                        </div>
                        {injuryConfirmError && (
                          <div style={{ fontSize: 12, color: '#e5484d', marginBottom: 8 }}>{injuryConfirmError}</div>
                        )}
                        {injuryShowback.verbatim && injuryShowback.verbatim !== 'None' && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontStyle: 'italic' }}>
                            You wrote: “{injuryShowback.verbatim}”
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6 }}>
                          Based on that, we'll avoid programming{injuryShowback.list.length === 0 ? ' — nothing yet, add anything we should skip:' : ':'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {injuryShowback.list.map(m => (
                            <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text)' }}>
                              {m}
                              <button
                                type="button"
                                onClick={() => removeInjuryMovement(m)}
                                aria-label={`Remove ${m}`}
                                style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                              >×</button>
                            </span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                          <input
                            className="lift-input"
                            value={injuryAddInput}
                            onChange={e => setInjuryAddInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInjuryMovement(); } }}
                            placeholder="Add a movement to avoid"
                            style={{ flex: 1, fontFamily: 'inherit' }}
                          />
                          <button type="button" className="auth-btn" onClick={addInjuryMovement} style={{ padding: '8px 14px', fontSize: 13 }}>Add</button>
                        </div>
                        <button
                          type="button"
                          className="auth-btn"
                          onClick={confirmInjuryAvoidances}
                          disabled={injuryConfirmSaving}
                          style={{ padding: '8px 16px', fontSize: 13, background: '#2ec486', color: 'white' }}
                        >
                          {injuryConfirmSaving ? 'Confirming…' : 'Confirm these avoidances'}
                        </button>
                      </div>
                    )}

                    {INTAKE_QUESTIONS.map(q => (
                      <div key={q.key} style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                          {q.label} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>(optional)</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{q.helper}</div>
                        <textarea
                          className="lift-input"
                          rows={2}
                          maxLength={500}
                          value={intakeAnswers[q.key] ?? ''}
                          onChange={e => { setIntakeAnswers(prev => ({ ...prev, [q.key]: e.target.value })); setIntakeSaved(false); }}
                          onFocus={() => setT3FocusedBox(q.key)}
                          onBlur={() => setT3FocusedBox(f => (f === q.key ? null : f))}
                          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', textAlign: 'left' }}
                        />
                        <div style={{ ...t3CounterStyle((intakeAnswers[q.key] ?? '').length, t3FocusedBox === q.key || (intakeAnswers[q.key] ?? '').length > 0), marginTop: 4 }}>
                          {(intakeAnswers[q.key] ?? '').length} / 500
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="auth-btn"
                      onClick={saveIntake}
                      disabled={intakeSaving}
                      style={{ padding: '8px 16px', fontSize: 13 }}
                    >
                      {intakeSaving ? 'Saving…' : intakeSaved ? 'Saved ✓' : 'Save & analyze'}
                    </button>
                    {intakeError && <div className="auth-error" style={{ display: 'block', marginTop: 12 }}>{intakeError}</div>}
                  </div>
                </TierCard>

                {/* Competition History — an OPTIONAL add-on, NOT a tier (it doesn't
                    gate the eval or programmer and has no prerequisite). Sits AFTER the
                    profile tiers (2026-08 reorder): optional enrichment must not
                    read as step two of the eval funnel. The feature itself is the
                    /athletedata route. Public to ALL athletes via ATHLETEDATA_PUBLIC_TIER
                    (currently on); only admin-only if that flag is turned off. */}
                {(isAdmin || ATHLETEDATA_PUBLIC_TIER) && (
                  <div className="settings-card" style={{ borderColor: competitionAthleteId ? '#2ec486' : undefined }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>
                      <span style={{ color: competitionAthleteId ? '#2ec486' : 'var(--accent)' }}>Competition History</span>
                      {competitionAthleteId
                        ? <span style={{ color: '#2ec486' }}> · Linked ✓</span>
                        : <span style={{ color: 'var(--text-muted)' }}> (Free)</span>}
                    </div>
                    <h2 className="settings-card-title" style={{ marginBottom: 2 }}>
                      {competitionAthleteId
                        ? `Linked: ${competitionAthleteLabel ?? 'your competition profile'}`
                        : 'Import your competition history'}
                    </h2>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
                      {competitionAthleteId
                        ? 'Your Open / Quarterfinals / Games history, a completion map, and throwbacks.'
                        : 'Unlock a detailed analysis of your fitness over the years. No competition history? Start one, with access to every year’s workouts.'}
                    </div>
                    <button
                      type="button"
                      className="auth-btn"
                      style={{ padding: '8px 16px', fontSize: 13 }}
                      onClick={() => navigate('/athletedata')}
                    >
                      {competitionAthleteId ? 'View your competition history →' : 'Get started →'}
                    </button>
                  </div>
                )}

                {(() => {
                  // Pure SAVE button. Running the free evaluation lives entirely in
                  // the Evaluation Status Card above (which saves first if dirty) —
                  // keeping save and run-eval separate avoids the "wait, does this
                  // also run/save?" confusion.
                  const saveBtnLabel = saving ? 'Saving...' : !isDirty ? 'Saved ✓' : 'Save Profile';
                  return (
                    <>
                      <button
                        className="auth-btn"
                        onClick={async () => { await saveProfile(); }}
                        disabled={saving || !!analysisLoading}
                        style={!isDirty && !saving && !analysisLoading ? { background: '#2ec486', color: 'white' } : undefined}
                      >
                        {saveBtnLabel}
                      </button>
                      {!tierStatus.canRunEval && !hasGeneratedProgram && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>
                          Finish your Basics, key lifts, a 2k row, and one run (mile or 5k) to run your free evaluation.
                        </span>
                      )}
                    </>
                  );
                })()}

                {/* Generate Program — first-time generation only. Hidden once a
                    program exists; admins no longer get a regenerate button here
                    (use the v3 admin section below for testing). handleGenerateProgram
                    + generateLoading state are kept intact in case the v1 path
                    needs to be exposed again. */}
                {!hasGeneratedProgram && (() => {
                  const canGenerate = isAdmin || hasFeature('programming');
                  const isFreeUser = !hasFeature('ai_chat') && !hasFeature('engine') && !hasFeature('programming') && !hasFeature('nutrition') && !isAdmin;
                  const upgradeRoute = isFreeUser ? '/checkout' : '/settings';
                  const tierBlocked = canGenerate && !tierStatus.canRunPrograms;
                  const disabled = (canGenerate && generateLoading) || tierBlocked;
                  const genTitle = tierBlocked
                    ? 'Fill in your training context to generate a program tailored to your week.'
                    : undefined;
                  // Ready = entitled, tier-complete, not generating. The old
                  // surface2 styling made an ARMED button look dormant — ready
                  // now reads as the primary action it is.
                  const ready = canGenerate && !tierBlocked && !generateLoading;
                  return (
                    <>
                      <button
                        type="button"
                        className="auth-btn"
                        style={{
                          background: ready ? 'var(--accent-glow)' : 'var(--surface2)',
                          color: ready ? 'var(--accent)' : 'var(--text)',
                          border: ready ? '1px solid var(--accent)' : undefined,
                          fontWeight: ready ? 700 : undefined,
                          opacity: tierBlocked ? 0.55 : undefined,
                          cursor: tierBlocked ? 'not-allowed' : undefined,
                        }}
                        onClick={canGenerate ? (tierBlocked ? undefined : handleGenerateProgram) : () => navigate(upgradeRoute)}
                        disabled={disabled}
                        title={genTitle}
                      >
                        {canGenerate ? (
                          generateLoading ? 'Generating...' : ready ? 'Generate Program →' : 'Generate Program'
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                            Generate Program
                          </span>
                        )}
                      </button>
                      {(ready || generateLoading) && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>
                          Generation takes a few minutes — your full month, warm-ups to cool-downs.
                        </span>
                      )}
                      {!canGenerate && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>Requires AI Programming or All Access subscription</span>
                      )}
                      {tierBlocked && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>
                          Fill in your training context to generate a program tailored to your week.
                        </span>
                      )}
                    </>
                  );
                })()}

                {/* AI Evaluation History — grouped by month */}
                {(evaluations.length > 0 || trainingEvaluations.length > 0 || nutritionEvaluations.length > 0) && (
                  <CollapsibleSection
                    title="AI Evaluation History"
                    expanded={evalHistoryOpen}
                    onToggle={setEvalHistoryOpen}
                    sectionRef={evalHistoryRef}
                  >
                  <p className="athlete-card-subtitle" style={{ marginBottom: 12 }}>Past AI evaluations grouped by month. Click a section to expand.</p>

                  {(() => {
                    // Group all evaluations by month_number
                    type EvalEntry = { id: string; analysis?: string; created_at: string; month_number?: number; profile_snapshot?: any };
                    const byMonth = new Map<number, { date: string; profile?: EvalEntry; training?: EvalEntry; nutrition?: EvalEntry }>();

                    const ensureMonth = (m: number, created_at: string) => {
                      if (!byMonth.has(m)) byMonth.set(m, { date: created_at });
                      return byMonth.get(m)!;
                    };

                    // Queries return newest-first. Keep the first-seen row per
                    // month so the newest eval wins when multiple exist for the
                    // same month_number (admin re-runs, retries, etc.).
                    for (const ev of evaluations) {
                      const m = (ev as any).month_number || 1;
                      const month = ensureMonth(m, ev.created_at);
                      if (!month.profile) month.profile = ev as EvalEntry;
                    }
                    for (const ev of trainingEvaluations) {
                      const m = (ev as any).month_number || 1;
                      const month = ensureMonth(m, ev.created_at);
                      if (!month.training) month.training = ev as EvalEntry;
                    }
                    for (const ev of nutritionEvaluations) {
                      const m = (ev as any).month_number || 1;
                      const month = ensureMonth(m, ev.created_at);
                      if (!month.nutrition) month.nutrition = ev as EvalEntry;
                    }

                    const months = Array.from(byMonth.keys()).sort((a, b) => b - a); // Most recent first

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {months.map(m => {
                          const group = byMonth.get(m)!;
                          return (
                            <div key={m}>
                              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
                                Month {m} — {formatDate(group.date)}
                              </h3>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {(['profile', 'training', 'nutrition'] as const).map(kind => {
                                  const ev = group[kind];
                                  if (!ev) return null;
                                  const label = kind === 'profile' ? 'Profile Evaluation' : kind === 'training' ? 'Training Review' : 'Nutrition Review';
                                  const isExpanded = expandedEvalId === ev.id;
                                  const structured = kind === 'profile' ? (ev as Evaluation).structured_evaluation : null;
                                  return (
                                    <div key={ev.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedEvalId(isExpanded ? null : ev.id)}
                                        style={{
                                          width: '100%',
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          padding: '12px 16px',
                                          background: 'var(--bg)',
                                          border: 'none',
                                          color: 'var(--text)',
                                          cursor: 'pointer',
                                          fontFamily: 'inherit',
                                          fontSize: 14,
                                        }}
                                      >
                                        <span style={{ fontWeight: 600 }}>{label}</span>
                                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{isExpanded ? '▲' : '▼'}</span>
                                      </button>
                                      {isExpanded && (structured || ev.analysis) && (
                                        <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
                                          {structured ? (
                                            <StructuredEvalView
                                              e={normalizeEvaluation(structured)}
                                              onUpgrade={!isAdmin && !hasFeature('programming') ? () => navigate('/checkout') : undefined}
                                            />
                                          ) : (
                                            <div className="workout-review-section" style={{ marginTop: 0 }}>
                                              <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(ev.analysis!) }} />
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  </CollapsibleSection>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
