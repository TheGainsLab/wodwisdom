/**
 * CompetitionMap — the "All"-scope grid: every competition workout ever,
 * filled cells = ones the athlete has a result for (gold, tappable into the
 * workout detail), unfilled = the rest (faint/dashed, tappable into a "you
 * haven't done this" card). The collect-them-all map.
 *
 * Seasons collapse: each year header is a ▾/▸ toggle; collapsed seasons show a
 * one-line, per-stage summary (`2020 · Open 5/5 · 99 · QF 3/3 · 88 · Games
 * 8/14 · 31` — done / stage-total + the avg cohort pct within that stage;
 * stages with zero done are skipped, percentiles aren't averaged across stages
 * since the fields aren't comparable). Every season starts collapsed; tapping a
 * year header expands it, and an "Expand all / Collapse all" link is offered.
 * While a filter is active the collapse machinery steps aside and every
 * matching season renders open.
 */

import { useState } from 'react';
import type {
  NormalizedCatalog,
  CatalogSeasonGroup,
  CatalogWorkoutSummary,
  CompetitionWorkoutEntry,
} from '../../lib/competitionHistory';
import { avgCohortPercentile, initialCollapsedSeasons, STAGE_ABBR } from '../../lib/competitionHistory';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

function Cell({
  w,
  filled,
  onClick,
}: {
  w: CatalogWorkoutSummary;
  filled: boolean;
  onClick: () => void;
}) {
  const isGames = w.stage === 'games';
  const numbered = w.ordinal != null;
  const label = numbered ? String(w.ordinal) : w.workout_name;
  const moves = w.movements.join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${w.workout_name}${moves ? ` — ${moves}` : ''}${filled ? '' : ' (not done)'}`}
      style={{
        height: 38,
        ...(numbered ? { width: 38, padding: 0 } : { padding: '0 10px', maxWidth: 180 }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: numbered ? 14 : 12,
        fontWeight: 600,
        background: 'var(--surface2)',
        border: `1px ${filled ? 'solid' : 'dashed'} ${filled && isGames ? 'rgba(212,175,55,0.5)' : 'var(--border)'}`,
        borderRadius: 6,
        color: 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity: filled ? 1 : 0.4,
        boxShadow: filled && isGames ? 'inset 0 2px 0 rgba(212,175,55,0.55)' : undefined,
      }}
    >
      {label}
    </button>
  );
}

// Per-stage breakout: `Open 5/5 · 99 · QF 3/3 · 88 · Games 8/14 · 31` — done /
// stage-total + the avg cohort percentile *within that stage*. Stages the
// athlete has zero of are skipped (no point telling someone they did 0/14
// Games events when they never made the Quarterfinals). Averaging the
// percentile across stages would be meaningless (an Open workout's field is
// ~300k, a Games event's is ~40), hence the per-stage split. Falls back to
// `0/<seasonTotal>` for a season with nothing done.
function seasonSummary(
  season: CatalogSeasonGroup,
  filledIds: Set<string>,
  entryById?: Record<string, CompetitionWorkoutEntry>,
): string {
  const parts: string[] = [];
  let seasonTotal = 0;
  for (const st of season.stages) {
    seasonTotal += st.workouts.length;
    const filled = st.workouts.filter((w) => filledIds.has(w.competition_workout_id));
    if (filled.length === 0) continue;
    const label = STAGE_ABBR[st.stage] ?? st.stage;
    const avg = avgCohortPercentile(filled.map((w) => entryById?.[w.competition_workout_id]));
    parts.push(`${label} ${filled.length}/${st.workouts.length}${avg != null ? ` · ${Math.round(avg)}` : ''}`);
  }
  return parts.length > 0 ? parts.join(' · ') : `0/${seasonTotal}`;
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

export default function CompetitionMap({
  catalog,
  filledIds,
  entryById,
  onSelectFilled,
  onSelectUnfilled,
  matchWorkout,
}: {
  catalog: NormalizedCatalog;
  filledIds: Set<string>;
  /** The athlete's normalized entries by competition_workout_id — used only
   *  for the collapsed per-season avg-percentile summary (the catalog rows
   *  themselves carry no result data). */
  entryById?: Record<string, CompetitionWorkoutEntry>;
  onSelectFilled: (id: string) => void;
  onSelectUnfilled: (w: CatalogWorkoutSummary) => void;
  matchWorkout?: (w: CatalogWorkoutSummary) => boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => initialCollapsedSeasons(catalog.seasons.map((s) => s.season)),
  );

  if (catalog.total === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Couldn't load the workout catalog.</div>;
  }

  const filledCount = catalog.seasons
    .flatMap((s) => s.stages)
    .flatMap((st) => st.workouts)
    .filter((w) => filledIds.has(w.competition_workout_id)).length;

  const seasons = matchWorkout
    ? catalog.seasons
        .map((s) => ({
          ...s,
          stages: s.stages
            .map((st) => ({ ...st, workouts: st.workouts.filter(matchWorkout) }))
            .filter((st) => st.workouts.length > 0),
        }))
        .filter((s) => s.stages.length > 0)
    : catalog.seasons;

  const collapsible = !matchWorkout && seasons.length > 1;
  const allCollapsed = seasons.every((s) => collapsed.has(s.season));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        {/* Progress tracker — only once there's progress. At zero we show nothing
            here; the section subtitle already invites the user to browse + try, so
            a second "browse" line would be redundant (and avoids a deflating 0%). */}
        {filledCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {filledCount} of {catalog.total} workouts done · {Math.round((filledCount / catalog.total) * 100)}%
          </span>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(seasons.map((s) => s.season)))}
            style={{ fontSize: 12, color: 'var(--text-dim)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {seasons.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No workouts match that filter.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {seasons.map((season) => {
            const isCollapsed = collapsible && collapsed.has(season.season);
            return (
              <div key={season.season}>
                <SeasonHeader
                  year={season.season}
                  collapsed={isCollapsed}
                  collapsible={collapsible}
                  summary={seasonSummary(season, filledIds, entryById)}
                  onToggle={() => setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(season.season)) next.delete(season.season);
                    else next.add(season.season);
                    return next;
                  })}
                />
                {!isCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {season.stages.map((stage) => (
                      <div key={stage.stage} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
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
                          {stage.workouts.map((w) => {
                            const filled = filledIds.has(w.competition_workout_id);
                            return (
                              <Cell
                                key={w.competition_workout_id}
                                w={w}
                                filled={filled}
                                onClick={() => (filled ? onSelectFilled(w.competition_workout_id) : onSelectUnfilled(w))}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
