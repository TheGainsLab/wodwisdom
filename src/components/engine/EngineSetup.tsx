import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Target } from 'lucide-react';
import {
  enableAiSequencing,
  loadPrograms,
  loadSharedGoal,
  saveEngineGoal,
  saveProgramVersion,
  type EngineProgram,
} from '../../lib/engineService';

/**
 * EngineSetup — the first-visit flow for a new Engine subscriber, replacing
 * the eight-track picker (founder decisions, 2026-11-10; see
 * docs/engine_self_sequencing_plan.md "New-subscriber sequence").
 *
 *  ONE screen, two answers: days per week (3 / 4 / 5 → the main_* program
 *  of that cadence) and ONE free-text goal. The goal is shared with AI
 *  Programming (saveEngineGoal writes both columns); for an All Access
 *  athlete who set up Programming first it is pre-filled. Start Day 1
 *  persists the program (position 1), turns the sequencer on, saves the
 *  goal, and hands off to the Day 1 screen.
 *
 *  There is deliberately NO briefing about the assessment month (founder,
 *  2026-11-12: "they see month 1 and then they see month 2 — this is just
 *  confusion"). Pace targets adapt from day one; the curated-vs-sequenced
 *  distinction is ours, not theirs. The Coach explains it if asked.
 *
 * Existing subscribers keep the old picker behind Switch Program until the
 * tracks → settings migration.
 */

const MAIN_BY_CADENCE: Record<number, string> = { 3: 'main_3day', 4: 'main_4day', 5: 'main_5day' };

interface Props {
  /** Called after the program + goal are saved; receives the program id. */
  onDone: (programId: string) => void;
}

export default function EngineSetup({ onDone }: Props) {
  const [programs, setPrograms] = useState<EngineProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [cadence, setCadence] = useState<number | null>(null);
  const [goal, setGoal] = useState('');
  // True when the goal arrived from the profile (an All Access athlete who
  // set it there first) — the step reads as a confirmation, not a question.
  const [goalFromProfile, setGoalFromProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      loadPrograms().then(setPrograms),
      loadSharedGoal().then((g) => { setGoal(g); setGoalFromProfile(g.trim().length > 0); }).catch(() => {}),
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

  const start = async () => {
    if (!chosen) return;
    setError('');
    setSaving(true);
    try {
      await saveProgramVersion(chosen.id);
      // New subscribers get the sequencer on (founder decision 2026-11-11);
      // Settings is the opt-out. Explicit here, never inside the program save.
      await enableAiSequencing();
      // Best-effort: the goal must never block the start (blank is a no-op).
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

  return (
    <div className="engine-page" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div className="engine-card" style={{ maxWidth: 560, width: '100%' }}>
        <div className="engine-section">
          <h2 className="engine-header">Set up your Engine</h2>
          <p className="engine-subheader">Two answers, then Day 1.</p>

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
              {goalFromProfile
                ? 'Set on your profile — the Engine uses the same goal. Edit it here if you like; the latest edit anywhere is the one that counts.'
                : 'The more you tell it, the better it sequences. This is your training goal across the app — you can update it anytime from your profile or the Engine dashboard.'}
            </div>
          </div>

          {error && <div style={{ fontSize: 13, color: 'var(--accent)' }}>{error}</div>}

          <button
            className="engine-btn engine-btn-primary"
            onClick={start}
            disabled={!chosen || saving}
            style={{ width: '100%' }}
          >
            {saving ? <Loader2 size={18} className="spin" /> : <><Play size={18} /> Start Day 1</>}
          </button>
        </div>
      </div>
    </div>
  );
}
