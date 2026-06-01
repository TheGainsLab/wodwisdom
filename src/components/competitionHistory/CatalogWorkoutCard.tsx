/**
 * CatalogWorkoutCard — the modal for an UNFILLED grid cell (a workout the
 * athlete hasn't done): name / year / stage / movements (names) / scoring
 * badges / field size / prescription, plus the "Try it" log flow.
 *
 * Prescription renders only when `workout.description` is present. That field
 * is the Option-1 upstream ask: add `description` to GET /workouts so not-done
 * workouts show instructions (done workouts already get it from the results
 * bundle). Until the catalog exposes it, the block simply doesn't render.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { CatalogWorkoutSummary } from '../../lib/competitionHistory';
import { prettyMovementName } from '../../lib/competitionHistory';

// Phase 1 of the /workouts/{id} detail consume — we only read `description`
// here (byte-identical to the done-path source). field_size / cap_completion_rate
// / top_performance / stats{} (the cohort gap bar) are Phase 2.
interface WorkoutDetailResponse {
  workout?: { description?: string | null };
  description?: string | null;
  error?: string;
}

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 7px', background: 'var(--surface2)',
      border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)',
    }}>{children}</span>
  );
}

export default function CatalogWorkoutCard({
  workout,
  onClose,
  onTryIt,
}: {
  workout: CatalogWorkoutSummary;
  onClose: () => void;
  onTryIt: (w: CatalogWorkoutSummary) => void;
}) {
  const stageLabel = STAGE_LABEL[workout.stage] ?? workout.stage;
  const s = workout.scoring;

  // Fetch the full detail on open (Option B). Phase 1: surface `description`
  // (the prescription). Falls back to any description already on the summary;
  // renders nothing if the endpoint 404s (e.g. not yet redeployed) or errors.
  const [description, setDescription] = useState<string | null>(workout.description ?? null);
  const [descLoading, setDescLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke<WorkoutDetailResponse>('competition-workout-detail', {
        body: { competition_workout_id: workout.competition_workout_id },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        setDescLoading(false);
        if (error || !data || data.error) return;
        const d = data.workout?.description ?? data.description ?? null;
        if (d) setDescription(d);
      });
    return () => { cancelled = true; };
  }, [workout.competition_workout_id]);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '24px 16px', overflowY: 'auto', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10,
          maxWidth: 520, width: '100%', padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {workout.season} {stageLabel} {workout.workout_name}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {workout.time_domain?.bucket && <Badge>{workout.time_domain.bucket} time domain</Badge>}
              {s && <Badge>{s.scoring_unit === 'load_lbs' ? 'for load' : `for ${s.scoring_unit}`}</Badge>}
              {s?.is_dual_scoring && <Badge>dual-scoring</Badge>}
              {s?.time_cap_seconds != null && <Badge>{Math.round(s.time_cap_seconds / 60)} min cap</Badge>}
              {workout.scaled_tier && workout.scaled_tier !== 'rx' && <Badge>{workout.scaled_tier}</Badge>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4 }}
          >
            ×
          </button>
        </div>

        {workout.movements.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {workout.movements.map((m, i) => (
              <span key={`${i}-${m}`} style={{
                fontSize: 12, padding: '3px 8px', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 999, color: 'var(--text-dim)',
              }}>{prettyMovementName(m)}</span>
            ))}
          </div>
        )}

        {description ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text-muted)', marginBottom: 6 }}>Prescription</div>
            <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {description}
            </div>
          </div>
        ) : descLoading ? (
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>Loading prescription…</div>
        ) : null}

        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-dim)' }}>
          You haven't done this one.
          {workout.field_size != null && ` ${workout.field_size.toLocaleString()} athletes have a score for it.`}
        </div>

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="auth-btn"
            style={{ padding: '8px 16px', fontSize: 13, fontFamily: 'inherit' }}
            onClick={() => onTryIt(workout)}
          >
            Try it — log a result
          </button>
        </div>
      </div>
    </div>
  );
}
