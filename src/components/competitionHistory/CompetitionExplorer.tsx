/**
 * CompetitionExplorer — the interactive layer over the competition map:
 * a scope toggle ("your workouts" vs "all competition workouts"), a filter
 * bar (movement / time domain / year), the (filtered) grid, and the detail
 * modals. Scope + filter are owned by the parent (the /competition-history
 * "Map" tab) so the Movements tab can drill in with a pre-applied filter.
 * (A by-frequency "your movements" view lives on that Movements tab — the
 * movement dropdown here is alphabetical.)
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  NormalizedCompetitionHistory,
  CompetitionWorkoutEntry,
  NormalizedCatalog,
  CatalogWorkoutSummary,
} from '../../lib/competitionHistory';
import { movementExposure, normalizeCatalog, ageBandFor } from '../../lib/competitionHistory';
import CompetitionGrid from './CompetitionGrid';
import CompetitionMap from './CompetitionMap';
import WorkoutDetail from './WorkoutDetail';
import CatalogWorkoutCard from './CatalogWorkoutCard';
import LogResultForm from './LogResultForm';
import type { LogResultWorkout } from './LogResultForm';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open', quarterfinals: 'Quarterfinals', semifinals: 'Semifinals', regional: 'Regionals', games: 'Games',
};

export type TimeDomain = 'short' | 'medium' | 'long';
export type Scope = 'mine' | 'all';

export interface Filter {
  movement?: string;
  timeDomain?: TimeDomain;
  year?: number;
}

const TIME_DOMAINS: TimeDomain[] = ['short', 'medium', 'long'];

// Bundle time_domain.bucket values are short/medium/long — upstream normalized
// away the legacy 'mid' literal in bundle 1.9.0. The filter chips show a
// compact label ('mid') while filtering on the real value ('medium').
const TIME_DOMAIN_LABEL: Record<TimeDomain, string> = {
  short: 'short',
  medium: 'mid',
  long: 'long',
};

// Small × button shown next to a filter dropdown when it has a value — resets
// just that field, without touching the others.
const fieldClearBtnStyle = {
  flexShrink: 0,
  padding: '0 10px',
  fontSize: 16,
  lineHeight: 1,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'none',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontFamily: 'inherit' as const,
};

export default function CompetitionExplorer({
  history,
  userAge,
  canLog,
  scope,
  setScope,
  filter,
  setFilter,
}: {
  history: NormalizedCompetitionHistory;
  userAge: number | null;
  canLog: boolean;
  scope: Scope;
  setScope: Dispatch<SetStateAction<Scope>>;
  filter: Filter;
  setFilter: Dispatch<SetStateAction<Filter>>;
}) {
  const ageBand = ageBandFor(userAge);
  const [selectedWorkout, setSelectedWorkout] = useState<CompetitionWorkoutEntry | null>(null);
  const [selectedCatalogWorkout, setSelectedCatalogWorkout] = useState<CatalogWorkoutSummary | null>(null);
  // "Try it" — the workout being logged + ids logged this session (optimistic
  // grid fill; full read-back of competition_workout_results on load is a
  // follow-up, so for now a just-logged throwback shows green in the "All" map
  // but not yet in the "Mine" grid).
  const [logTarget, setLogTarget] = useState<LogResultWorkout | null>(null);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());
  // Shown when a non-competition_log user taps Try-It.
  const [paywall, setPaywall] = useState(false);

  // Try-It is competition_log-gated. Non-paid users get the paywall prompt
  // instead of the log form (log-throwback would 403 them anyway — this turns
  // a failing button into a clean upgrade prompt).
  const openLogForEntry = (e: CompetitionWorkoutEntry) => {
    if (!canLog) { setPaywall(true); return; }
    setLogTarget({
      competition_workout_id: e.competition_workout_id,
      label: `${e.year} ${STAGE_LABEL[e.stage] ?? e.stage} ${e.workout_name}`,
      scoring_unit: e.workout.scoring_unit,
      is_dual_scoring: e.workout.is_dual_scoring,
      time_cap_seconds: e.workout.time_cap_seconds,
    });
  };
  const openLogForCatalog = (w: CatalogWorkoutSummary) => {
    if (!canLog) { setPaywall(true); return; }
    setLogTarget({
      competition_workout_id: w.competition_workout_id,
      label: `${w.season} ${STAGE_LABEL[w.stage] ?? w.stage} ${w.workout_name}`,
      scoring_unit: w.scoring?.scoring_unit ?? 'time',
      is_dual_scoring: w.scoring?.is_dual_scoring ?? false,
      time_cap_seconds: w.scoring?.time_cap_seconds ?? null,
    });
  };
  const onLogged = (id: string) => {
    // Mark the grid filled — but do NOT close the log form here. LogResultForm
    // stays mounted to show its post-submit panel (score · power · placement);
    // it closes on its own "Done" button (onClose). Closing it here would
    // unmount the form before that panel can render.
    setLoggedIds((s) => { const n = new Set(s); n.add(id); return n; });
    setSelectedCatalogWorkout(null);
    setSelectedWorkout(null);
  };

  // Catalog (the full list of competition workouts) — fetched lazily the
  // first time the "all" scope is opened; the raw rows are cached for the
  // component's life and re-normalized (dedup keyed by the athlete's ids)
  // whenever filledIds changes.
  const [catalogRaw, setCatalogRaw] = useState<CatalogWorkoutSummary[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const movements = useMemo(() => movementExposure(history), [history]);
  // Alphabetical for the filter dropdown (movementExposure returns by-frequency).
  const movementsByName = useMemo(
    () => movements.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [movements],
  );
  const filledIds = useMemo(() => new Set(Object.keys(history.byId)), [history]);
  // Filled = real competition results (from the bundle) + throwbacks logged this session.
  const effectiveFilledIds = useMemo(() => {
    if (loggedIds.size === 0) return filledIds;
    const s = new Set(filledIds);
    for (const id of loggedIds) s.add(id);
    return s;
  }, [filledIds, loggedIds]);
  // The athlete's competition division (1 = Men, 2 = Women) — the mode of their
  // own results' division (constant in practice); used to filter the catalog.
  const athleteDivision = useMemo(() => {
    const counts = new Map<number, number>();
    for (const e of Object.values(history.byId)) {
      if (typeof e.division === 'number') counts.set(e.division, (counts.get(e.division) ?? 0) + 1);
    }
    let best: number | undefined;
    let bestN = 0;
    for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n; }
    return best;
  }, [history]);
  const catalog: NormalizedCatalog | null = useMemo(
    () => (catalogRaw ? normalizeCatalog(catalogRaw, filledIds, athleteDivision) : null),
    [catalogRaw, filledIds, athleteDivision],
  );

  // Lazy-load the catalog the first time the "all" scope is opened. Deps are
  // [scope, catalogRaw] only — NOT catalogLoading: a loading-flag dep would
  // make setCatalogLoading(true) re-run this effect, whose cleanup would
  // cancel its own in-flight fetch (→ stuck on "Loading…" forever).
  useEffect(() => {
    if (scope !== 'all' || catalogRaw) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    (async () => {
      const { data, error } = await supabase.functions.invoke<{ workouts?: CatalogWorkoutSummary[]; error?: string }>(
        'competition-catalog',
        { body: {} },
      );
      setCatalogLoading(false);
      if (cancelled) return;
      if (error || data?.error || !Array.isArray(data?.workouts)) {
        setCatalogError('Could not load the workout catalog.');
        return;
      }
      setCatalogRaw(data.workouts);
    })();
    return () => { cancelled = true; };
  }, [scope, catalogRaw]);

  const isFiltered = !!(filter.movement || filter.timeDomain || filter.year != null);

  const matchEntry = useMemo(() => {
    if (!isFiltered) return undefined;
    return (e: CompetitionWorkoutEntry): boolean => {
      if (filter.year != null && e.year !== filter.year) return false;
      if (filter.timeDomain && e.workout.time_domain?.bucket !== filter.timeDomain) return false;
      if (filter.movement && !e.workout.movements.some((m) => m.name === filter.movement)) return false;
      return true;
    };
  }, [isFiltered, filter.year, filter.timeDomain, filter.movement]);

  const matchWorkout = useMemo(() => {
    if (!isFiltered) return undefined;
    return (w: CatalogWorkoutSummary): boolean => {
      if (filter.year != null && w.season !== filter.year) return false;
      if (filter.timeDomain && w.time_domain?.bucket !== filter.timeDomain) return false;
      if (filter.movement && !w.movements.includes(filter.movement)) return false;
      return true;
    };
  }, [isFiltered, filter.year, filter.timeDomain, filter.movement]);

  const matchedCount = useMemo(() => {
    if (!matchEntry) return history.total;
    let n = 0;
    for (const s of history.seasons) for (const st of s.stages) for (const e of st.entries) if (matchEntry(e)) n++;
    return n;
  }, [matchEntry, history]);

  const scopeBtn = (s: Scope, label: string) => {
    const active = scope === s;
    return (
      <button
        type="button"
        onClick={() => setScope(s)}
        style={{
          padding: '6px 12px', fontSize: 12, borderRadius: 6,
          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          background: active ? 'var(--accent)' : 'var(--surface2)',
          color: active ? '#fff' : 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      {/* Scope toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {scopeBtn('mine', 'Your workouts')}
        {scopeBtn('all', 'All competition workouts')}
      </div>

      {/* Filter bar — on mobile the two dropdowns get their own row, then the
          time-domain buttons + clear + count below. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, flex: '1 1 150px', minWidth: 0 }}>
            <select
              className="lift-input"
              value={filter.movement ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, movement: e.target.value || undefined }))}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">All movements</option>
              {movementsByName.map((m) => (
                <option key={m.name} value={m.name}>{m.name} ({m.workoutCount})</option>
              ))}
            </select>
            {filter.movement && (
              <button
                type="button"
                aria-label="Clear movement filter"
                title="Clear movement filter"
                onClick={() => setFilter((f) => ({ ...f, movement: undefined }))}
                style={fieldClearBtnStyle}
              >
                ×
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 4, flex: '1 1 110px', minWidth: 0 }}>
            <select
              className="lift-input"
              value={filter.year ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">All years</option>
              {(scope === 'all' && catalog
                ? catalog.seasons.map((s) => s.season)
                : history.yearsCompeted
              ).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {filter.year != null && (
              <button
                type="button"
                aria-label="Clear year filter"
                title="Clear year filter"
                onClick={() => setFilter((f) => ({ ...f, year: undefined }))}
                style={fieldClearBtnStyle}
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['', ...TIME_DOMAINS] as Array<'' | TimeDomain>).map((td) => {
              const active = (filter.timeDomain ?? '') === td;
              return (
                <button
                  key={td || 'all'}
                  type="button"
                  onClick={() => setFilter((f) => ({ ...f, timeDomain: td || undefined }))}
                  style={{
                    padding: '6px 10px', fontSize: 12, borderRadius: 6,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent)' : 'var(--surface2)',
                    color: active ? '#fff' : 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {td === '' ? 'Any time' : TIME_DOMAIN_LABEL[td]}
                </button>
              );
            })}
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={() => setFilter({})}
              style={{
                padding: '6px 10px', fontSize: 12, borderRadius: 6,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Clear
            </button>
          )}

          {scope === 'mine' && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto' }}>
              {isFiltered ? `showing ${matchedCount} of ${history.total}` : `${history.total} workouts`}
            </span>
          )}
        </div>
      </div>

      {/* The grid / map */}
      {scope === 'mine' ? (
        <CompetitionGrid history={history} onSelectWorkout={setSelectedWorkout} matchEntry={matchEntry} />
      ) : catalogLoading ? (
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading the workout catalog…</div>
      ) : catalogError ? (
        <div style={{ fontSize: 13, color: 'var(--danger, #d33)' }}>{catalogError}</div>
      ) : catalog ? (
        <CompetitionMap
          catalog={catalog}
          filledIds={effectiveFilledIds}
          entryById={history.byId}
          onSelectFilled={(id) => {
            const e = history.byId[id];
            if (e) setSelectedWorkout(e);
            else { const w = catalog.byId[id]; if (w) setSelectedCatalogWorkout(w); }  // a throwback we don't have full data for yet
          }}
          onSelectUnfilled={setSelectedCatalogWorkout}
          matchWorkout={matchWorkout}
        />
      ) : null}

      {selectedWorkout && (
        <WorkoutDetail
          entry={selectedWorkout}
          onClose={() => setSelectedWorkout(null)}
          onLogAgain={openLogForEntry}
        />
      )}
      {selectedCatalogWorkout && (
        <CatalogWorkoutCard
          workout={selectedCatalogWorkout}
          onClose={() => setSelectedCatalogWorkout(null)}
          onTryIt={openLogForCatalog}
        />
      )}
      {logTarget && (
        <LogResultForm workout={logTarget} ageBand={ageBand} onLogged={onLogged} onClose={() => setLogTarget(null)} />
      )}
      {paywall && (
        <div
          onClick={() => setPaywall(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px 16px', zIndex: 1100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 380, width: '100%', padding: 20 }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>Logging results is a paid feature</div>
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-dim)' }}>
              Recording your own attempts at competition workouts — with your power numbers and placement — is part of the Competition Log plan. Browsing and viewing stay free.
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="auth-btn" style={{ padding: '8px 16px', fontSize: 13 }} onClick={() => setPaywall(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
