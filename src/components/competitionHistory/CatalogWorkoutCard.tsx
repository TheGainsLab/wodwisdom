/**
 * CatalogWorkoutCard — the modal for an UNFILLED grid cell (a workout the
 * athlete hasn't done). v1 = thin: name / year / stage / movements (names) /
 * scoring badges / field size, plus a disabled "Try it" placeholder. The
 * rich detail (prescription text, cohort/age-band stats, the gap bar, a real
 * "Try it" log flow) is v2 — it'll fetch /workouts/{id}.
 */

import type { CatalogWorkoutSummary } from '../../lib/competitionHistory';

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
}: {
  workout: CatalogWorkoutSummary;
  onClose: () => void;
}) {
  const stageLabel = STAGE_LABEL[workout.stage] ?? workout.stage;
  const s = workout.scoring;
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
              }}>{m}</span>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-dim)' }}>
          You haven't done this one.
          {workout.field_size != null && ` ${workout.field_size.toLocaleString()} athletes have a score for it.`}
        </div>

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            disabled
            title="Coming soon"
            style={{
              padding: '8px 16px', fontSize: 13, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface2)',
              color: 'var(--text-muted)', cursor: 'not-allowed', fontFamily: 'inherit',
            }}
          >
            Try it — coming soon
          </button>
        </div>
      </div>
    </div>
  );
}
