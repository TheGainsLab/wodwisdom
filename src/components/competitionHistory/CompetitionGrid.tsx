/**
 * CompetitionGrid — the athlete's full-career competition map. Rows = seasons
 * (newest first); within a season, stages in competition order (Open →
 * Quarterfinals → Semifinals/Regionals → Games); cells = workouts the athlete
 * has a result for. Numbered workouts (Open/QF/Semis) render as small square
 * cells showing the ordinal; named workouts (Games events) render as wider
 * cells with the name. Tap a cell → onSelectWorkout.
 *
 * Seasons collapse: each year header is a ▾/▸ toggle; collapsed seasons show a
 * one-line, per-stage summary (`2020 · Open 5 · 99 · QF 3 · 88 · Games 8 · 31`
 * — count + avg cohort pct within each stage; percentiles aren't averaged
 * across stages since the fields aren't comparable). Every season starts
 * collapsed; tapping a year header expands it, and an "Expand all / Collapse
 * all" link is offered. While a filter is active the collapse machinery steps
 * aside and every matching season renders open.
 *
 * v1: every cell is a real-competition result. Stage is conveyed by a subtle
 * accent (Games cells get a gold top-bar). When throwback logging lands, the
 * cell will also carry a "logged" state — the colour machinery is here for it.
 */

import { useState } from 'react';
import type {
  NormalizedCompetitionHistory,
  CompetitionWorkoutEntry,
  SeasonGroup,
} from '../../lib/competitionHistory';
import { avgCohortPercentile, initialCollapsedSeasons } from '../../lib/competitionHistory';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

// Shorter labels for the collapsed-season summary line.
const STAGE_ABBR: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'QF',
  semifinals: 'Semis',
  regional: 'Regionals',
  games: 'Games',
};

function Cell({ entry, onClick }: { entry: CompetitionWorkoutEntry; onClick: () => void }) {
  const isGames = entry.stage === 'games';
  const numbered = entry.ordinal != null;
  const label = numbered ? String(entry.ordinal) : entry.workout_name;
  const movementSummary = entry.workout.movements.map((m) => m.name).join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${entry.workout_name}${movementSummary ? ` — ${movementSummary}` : ''}`}
      style={{
        height: 38,
        ...(numbered ? { width: 38, padding: 0 } : { padding: '0 10px', maxWidth: 180 }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: numbered ? 14 : 12,
        fontWeight: 600,
        background: 'var(--surface2)',
        border: `1px solid ${isGames ? 'rgba(212,175,55,0.5)' : 'var(--border)'}`,
        borderRadius: 6,
        color: 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: isGames ? 'inset 0 2px 0 rgba(212,175,55,0.55)' : undefined,
      }}
    >
      {label}
    </button>
  );
}

// Per-stage breakout: `Open 5 · 99 · QF 3 · 88 · Games 8 · 31`. (The "Mine"
// grid only carries stages the athlete has entries in — no 0-count stages to
// skip; and no /total since the catalog isn't loaded here.) Averaging the
// cohort percentile *across* stages would be meaningless — an Open workout's
// field is ~300k, a Games event's is ~40 — so each stage gets its own number.
function seasonSummary(season: SeasonGroup): string {
  return season.stages
    .map((st) => {
      const label = STAGE_ABBR[st.stage] ?? st.stage;
      const avg = avgCohortPercentile(st.entries);
      return `${label} ${st.entries.length}${avg != null ? ` · ${Math.round(avg)}` : ''}`;
    })
    .join(' · ');
}

function SeasonHeader({
  year,
  collapsed,
  collapsible,
  summary,
  onToggle,
}: {
  year: number;
  collapsed: boolean;
  collapsible: boolean;
  summary: string;
  onToggle: () => void;
}) {
  const content = (
    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
      {collapsible && <span style={{ display: 'inline-block', width: 14, color: 'var(--text-dim)' }}>{collapsed ? '▸' : '▾'}</span>}
      {year}
      {collapsed && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> · {summary}</span>}
    </span>
  );
  if (!collapsible) return <div style={{ marginBottom: 8 }}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, margin: '0 0 8px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      {content}
    </button>
  );
}

export default function CompetitionGrid({
  history,
  onSelectWorkout,
  matchEntry,
}: {
  history: NormalizedCompetitionHistory;
  onSelectWorkout: (entry: CompetitionWorkoutEntry) => void;
  /** When provided, only entries that pass are rendered; empty stages/seasons are dropped. */
  matchEntry?: (entry: CompetitionWorkoutEntry) => boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => initialCollapsedSeasons(history.yearsCompeted),
  );

  if (history.total === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        No competition workouts found yet — your history will appear here once it's available.
      </div>
    );
  }

  const seasons = matchEntry
    ? history.seasons
        .map((season) => ({
          ...season,
          stages: season.stages
            .map((stage) => ({ ...stage, entries: stage.entries.filter(matchEntry) }))
            .filter((stage) => stage.entries.length > 0),
        }))
        .filter((season) => season.stages.length > 0)
    : history.seasons;

  if (seasons.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No workouts match that filter.</div>;
  }

  // Collapse only when unfiltered and there's more than one season to manage.
  const collapsible = !matchEntry && seasons.length > 1;
  const allCollapsed = seasons.every((s) => collapsed.has(s.year));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {collapsible && (
        <div>
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(seasons.map((s) => s.year)))}
            style={{ fontSize: 12, color: 'var(--text-dim)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      )}
      {seasons.map((season) => {
        const isCollapsed = collapsible && collapsed.has(season.year);
        return (
          <div key={season.year}>
            <SeasonHeader
              year={season.year}
              collapsed={isCollapsed}
              collapsible={collapsible}
              summary={seasonSummary(season)}
              onToggle={() => setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(season.year)) next.delete(season.year);
                else next.add(season.year);
                return next;
              })}
            />
            {!isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {season.stages.map((stage) => (
                  <div
                    key={stage.stage}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-dim)',
                        minWidth: 92,
                        paddingTop: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {STAGE_LABEL[stage.stage] ?? stage.stage}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {stage.entries.map((entry) => (
                        <Cell
                          key={entry.competition_workout_id}
                          entry={entry}
                          onClick={() => onSelectWorkout(entry)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
