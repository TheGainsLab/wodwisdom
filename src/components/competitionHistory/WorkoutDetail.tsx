/**
 * WorkoutDetail — the universal leaf, shown when a grid cell is tapped.
 *
 * v1 = "you have a score" (Version A), thin-but-real: header (name + metadata
 * badges) + prescription + your score + the two-cut ranking (vs your age
 * cohort, vs all of your gender). No field-level stats (cohort averages /
 * percentile curves) — that's the catalog endpoint (#8). No projection / "try
 * it" — that needs the throwback log + catalog. (Browsing by movement lives on
 * the Movements tab, so there are no movement chips here — the prescription
 * already lists every movement.)
 *
 * Rendered as a modal overlay so it doesn't shift the page underneath.
 */

import { useState } from 'react';
import type { CompetitionWorkoutEntry } from '../../lib/competitionHistory';
import { personalizedPower } from '../../lib/competitionHistory';
import { buildShareCardData, formatScore } from '../../lib/shareCard';
import ShareCardModal from './ShareCardModal';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

function nf(n: number): string {
  return n.toLocaleString();
}

export default function WorkoutDetail({
  entry,
  userKg,
  athleteName,
  onClose,
  onLogAgain,
}: {
  entry: CompetitionWorkoutEntry;
  userKg?: number | null;
  athleteName?: string | null;
  onClose: () => void;
  onLogAgain?: (entry: CompetitionWorkoutEntry) => void;
}) {
  const [showShare, setShowShare] = useState(false);
  const w = entry.workout;
  const r = entry.result;
  const stageLabel = STAGE_LABEL[entry.stage] ?? entry.stage;
  const isLogged = entry.source === 'logged';
  const hasCohort = Number.isFinite(r.cohort_percentile);
  const hasWorldwide = Number.isFinite(r.worldwide_percentile);
  const power = personalizedPower(entry, userKg);
  const scoreStr = formatScore(r.scoring_unit, r.raw_score, r.raw_score_text);
  const capStatus = w.is_dual_scoring
    ? entry.finished_under_cap
      ? 'finished under the cap'
      : 'capped out'
    : null;
  const beatCohort = Math.max(0, r.cohort_n - r.workout_rank);
  const descLines = (w.description ?? '').split('\n');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '24px 16px',
        overflowY: 'auto',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          maxWidth: 560,
          width: '100%',
          padding: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {entry.year} {stageLabel} {entry.workout_name}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {isLogged && (
                <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--accent)', fontWeight: 700 }}>Logged</span>
              )}
              {w.time_domain?.bucket && <Badge>{w.time_domain.bucket} time domain</Badge>}
              <Badge>{w.scoring_unit === 'load_lbs' ? 'for load' : `for ${w.scoring_unit}`}</Badge>
              {w.is_dual_scoring && <Badge>dual-scoring</Badge>}
              {w.time_cap_seconds != null && <Badge>{Math.round(w.time_cap_seconds / 60)} min cap</Badge>}
              {entry.scaled_tier && entry.scaled_tier !== 'rx' && <Badge>{entry.scaled_tier}</Badge>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Prescription */}
        {w.description && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: 'var(--surface2)',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {descLines.map((line, i) =>
              line.trim() === '' ? <div key={i} style={{ height: 6 }} /> : <div key={i}>{line}</div>,
            )}
          </div>
        )}

        {/* Your result */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Your score
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{scoreStr}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            {isLogged ? 'Logged' : 'Real competition'} · {entry.year}
            {capStatus ? ` · ${capStatus}` : ''}
          </div>
        </div>

        {/* Power — personalized to the athlete's body mass (rescaled for
            competed results; computed at real mass for logged throwbacks).
            When the movements have no power model, show a placeholder note
            rather than silently hiding the section. */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Power{power?.estimated ? ' (est.)' : ''}
          </div>
          {power ? (
            <div style={{ fontSize: 13, marginTop: 2 }}>
              {Math.round(power.watts).toLocaleString()} W
              {power.wPerKg != null && <span style={{ color: 'var(--text-dim)' }}> · {power.wPerKg.toFixed(1)} W/kg</span>}
            </div>
          ) : (
            <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text-dim)' }}>
              Not yet available for these movements
            </div>
          )}
        </div>

        {/* Where it puts you — guarded: a logged throwback without a stored
            placement has no percentile, so the section only shows real reads. */}
        {(hasCohort || hasWorldwide) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Where that puts you
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 13 }}>
            {hasCohort && <>
              <div style={{ color: 'var(--text-dim)' }}>vs your age group</div>
              <div>
                {r.cohort_percentile.toFixed(1)}th pct
                <span style={{ color: 'var(--text-dim)' }}> · beat ~{nf(beatCohort)} of {nf(r.cohort_n)}</span>
              </div>
            </>}
            {hasWorldwide && <>
              <div style={{ color: 'var(--text-dim)' }}>vs the whole field</div>
              <div>
                {r.worldwide_percentile.toFixed(1)}th pct
                <span style={{ color: 'var(--text-dim)' }}> · rank {nf(r.workout_rank)} of {nf(r.worldwide_n)}</span>
              </div>
            </>}
          </div>
        </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="auth-btn"
            style={{ padding: '8px 16px', fontSize: 13, fontFamily: 'inherit' }}
            onClick={() => setShowShare(true)}
          >
            Share
          </button>
          {onLogAgain && (
            <button
              type="button"
              className="auth-btn"
              style={{ padding: '8px 16px', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', fontFamily: 'inherit' }}
              onClick={() => onLogAgain(entry)}
            >
              Log this again
            </button>
          )}
        </div>
      </div>

      {showShare && (
        <ShareCardModal
          data={buildShareCardData(entry, userKg, athleteName)}
          cacheId={`${entry.competition_workout_id}:${userKg ?? 'na'}`}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 7px',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        color: 'var(--text-dim)',
      }}
    >
      {children}
    </span>
  );
}
