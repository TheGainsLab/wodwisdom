import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Play, Target } from 'lucide-react';
import {
  loadMonthOneSummary,
  loadPrograms,
  loadSharedGoal,
  saveEngineGoal,
  saveProgramVersion,
  type EngineProgram,
  type MonthOneSummary,
} from '../../lib/engineService';

/**
 * EngineSetup — the first-visit flow for a new Engine subscriber, replacing
 * the eight-track picker (founder decisions, 2026-11-10; see
 * docs/engine_self_sequencing_plan.md "New-subscriber sequence").
 *
 *  Step 1 — two answers: days per week (3 / 4 / 5 → the main_* program of
 *           that cadence) and ONE free-text goal. The goal is shared with AI
 *           Programming (saveEngineGoal writes both columns); for an All
 *           Access athlete who set up Programming first it is pre-filled.
 *  Step 2 — the briefing: month one is the assessment month, identical for
 *           every goal. Computed from the chosen program's month-one mapping
 *           (never hard-coded), so it stays true if the catalog is edited.
 *           Nothing on it is a choice; to change cadence, go back.
 *  Start Day 1 persists the program (position 1) and the goal, then hands
 *  off to the Day 1 screen.
 *
 * Existing subscribers keep the old picker behind Switch Program until the
 * tracks → settings migration.
 */

const MAIN_BY_CADENCE: Record<number, string> = { 3: 'main_3day', 4: 'main_4day', 5: 'main_5day' };

function typeLabel(dayType: string): string {
  return dayType.replace(/_/g, ' ');
}

interface Props {
  /** Called after the program + goal are saved; receives the program id. */
  onDone: (programId: string) => void;
}

export default function EngineSetup({ onDone }: Props) {
  const [programs, setPrograms] = useState<EngineProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [cadence, setCadence] = useState<number | null>(null);
  const [goal, setGoal] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [summary, setSummary] = useState<MonthOneSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      loadPrograms().then(setPrograms),
      loadSharedGoal().then(setGoal).catch(() => {}),
    ])
      .catch(() => setError('Could not load Engine programs. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  // The cadence choices are the main_* programs that exist and are active.
  const cadenceOptions = useMemo(() => {
    const byId = new Map(programs.map((p) => [p.id, p]));
    return [3, 4, 5]
      .map((d) => ({ days: d, program: byId.get(MAIN_BY_CADENCE[d]) }))
      .filter((o): o is { days: number; program: EngineProgram } => !!o.program);
  }, [programs]);

  const chosen = cadence != null ? cadenceOptions.find((o) => o.days === cadence)?.program ?? null : null;

  const goToBriefing = async () => {
    if (!chosen) return;
    setError('');
    setSummaryLoading(true);
    try {
      const s = await loadMonthOneSummary(chosen.id);
      setSummary(s);
      setStep(2);
    } catch {
      setError('Could not load the first month. Please try again.');
    }
    setSummaryLoading(false);
  };

  const start = async () => {
    if (!chosen) return;
    setError('');
    setSaving(true);
    try {
      await saveProgramVersion(chosen.id);
      // Best-effort: the goal must never block the start.
      await saveEngineGoal(goal).catch(() => {});
      onDone(chosen.id);
    } catch {
      setError('Could not save your setup. Please try again.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} className="spin" style={{ color: 'var(--text-dim)' }} />
      </div>
    );
  }

  // ── Step 2: the briefing ──
  if (step === 2 && chosen) {
    const perWeek = chosen.days_per_week;
    const kinds = summary?.types.length ?? 0;
    const goalText = goal.trim();
    return (
      <div className="engine-page" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div className="engine-card" style={{ maxWidth: 560, width: '100%' }}>
          <div className="engine-section">
            <button className="engine-btn engine-btn-secondary engine-btn-sm" onClick={() => setStep(1)} style={{ alignSelf: 'flex-start' }}>
              <ChevronLeft size={16} /> Back
            </button>
            <h2 className="engine-header">Month one is your assessment</h2>
            <p className="engine-subheader">
              {perWeek} days a week, {kinds} kind{kinds === 1 ? '' : 's'} of work. We measure how you respond to each
              before the Engine starts choosing for you.
            </p>

            {summary ? (
              <div style={{ background: 'var(--surface2)', border: '1px dashed var(--border-light)', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                <div>
                  <strong style={{ color: 'var(--text)' }}>Day 1</strong> · 10-minute time trial on your machine. It sets your pace targets.
                </div>
                <div style={{ marginTop: 10 }}>
                  <strong style={{ color: 'var(--text)' }}>Days 2–{summary.days}</strong>{' · '}
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text)', fontSize: 12.5 }}>
                    {summary.types.map((t) => `${typeLabel(t.day_type)} × ${t.count}`).join(' · ')}
                  </span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <strong style={{ color: 'var(--text)' }}>Day {summary.retestDay}</strong> · retest. From here the Engine
                  sequences your weeks{goalText ? <> toward <strong style={{ color: 'var(--text)' }}>{goalText}</strong></> : ''}.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Day 1 is a 10-minute time trial; the rest of the month measures how you respond to each kind of work.
              </div>
            )}

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Pace targets adapt from your very first sessions. New kinds of training arrive as you show you're ready for them.
            </div>

            {error && <div style={{ fontSize: 13, color: 'var(--accent)' }}>{error}</div>}

            <button className="engine-btn engine-btn-primary" onClick={start} disabled={saving} style={{ width: '100%' }}>
              {saving ? <Loader2 size={18} className="spin" /> : <><Play size={18} /> Start Day 1</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: two answers ──
  return (
    <div className="engine-page" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div className="engine-card" style={{ maxWidth: 560, width: '100%' }}>
        <div className="engine-section">
          <h2 className="engine-header">Set up your Engine</h2>
          <p className="engine-subheader">Two answers. The Engine learns the rest from your first month.</p>

          <div>
            <span className="engine-label">How many days a week?</span>
            <div className="engine-category-row">
              {cadenceOptions.map((o) => (
                <button
                  key={o.days}
                  type="button"
                  className={'engine-category-btn' + (cadence === o.days ? ' active' : '')}
                  onClick={() => setCadence(o.days)}
                  style={{ flex: 1, minWidth: 90, flexDirection: 'column', gap: 2, padding: '12px 10px' }}
                >
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{o.days}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>
                    {Math.round(o.program.total_days / (o.program.total_months || 36))} sessions / month
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="engine-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Target size={14} style={{ color: 'var(--accent)' }} /> What are you after, and what else is in your week?
            </span>
            <textarea
              className="lift-input"
              rows={3}
              maxLength={500}
              placeholder={'e.g. "Gas for MMA rounds. Two strength days, seven hours on the mat."\n"Keep up in class without dying in the metcon."\n"Faster 5k, running three days plus this."'}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', textAlign: 'left', fontSize: 14 }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
              The more you tell it, the better it sequences. This is your training goal across the app — you can update it
              anytime from your profile or the Engine dashboard.
            </div>
          </div>

          {error && <div style={{ fontSize: 13, color: 'var(--accent)' }}>{error}</div>}

          <button
            className="engine-btn engine-btn-primary"
            onClick={goToBriefing}
            disabled={!chosen || summaryLoading}
            style={{ width: '100%' }}
          >
            {summaryLoading ? <Loader2 size={18} className="spin" /> : <>Continue <ChevronRight size={18} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
