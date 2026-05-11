/**
 * CompetitionExplorer — the interactive layer over the competition map:
 * a scope toggle ("your workouts" vs "all competition workouts"), a filter
 * bar (movement / time domain / year), a "your movements" panel, the
 * (filtered) grid, and the detail modals. Self-contained so it can later
 * be lifted to a dedicated /competition-history route.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  NormalizedCompetitionHistory,
  CompetitionWorkoutEntry,
  NormalizedCatalog,
  CatalogWorkoutSummary,
} from '../../lib/competitionHistory';
import { movementExposure, normalizeCatalog } from '../../lib/competitionHistory';
import CompetitionGrid from './CompetitionGrid';
import CompetitionMap from './CompetitionMap';
import WorkoutDetail from './WorkoutDetail';
import CatalogWorkoutCard from './CatalogWorkoutCard';

type TimeDomain = 'short' | 'mid' | 'long';
type Scope = 'mine' | 'all';

interface Filter {
  movement?: string;
  timeDomain?: TimeDomain;
  year?: number;
}

const TIME_DOMAINS: TimeDomain[] = ['short', 'mid', 'long'];

export default function CompetitionExplorer({ history }: { history: NormalizedCompetitionHistory }) {
  const [scope, setScope] = useState<Scope>('mine');
  const [filter, setFilter] = useState<Filter>({});
  const [selectedWorkout, setSelectedWorkout] = useState<CompetitionWorkoutEntry | null>(null);
  const [selectedCatalogWorkout, setSelectedCatalogWorkout] = useState<CatalogWorkoutSummary | null>(null);
  const [showAllMovements, setShowAllMovements] = useState(false);

  // Catalog (the full list of competition workouts) — fetched lazily the
  // first time the "all" scope is opened; the raw rows are cached for the
  // component's life and re-normalized (dedup keyed by the athlete's ids)
  // whenever filledIds changes.
  const [catalogRaw, setCatalogRaw] = useState<CatalogWorkoutSummary[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const movements = useMemo(() => movementExposure(history), [history]);
  const filledIds = useMemo(() => new Set(Object.keys(history.byId)), [history]);
  const catalog: NormalizedCatalog | null = useMemo(
    () => (catalogRaw ? normalizeCatalog(catalogRaw, filledIds) : null),
    [catalogRaw, filledIds],
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

  const visibleMovements = showAllMovements ? movements : movements.slice(0, 12);

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

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select
          className="lift-input"
          value={filter.movement ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, movement: e.target.value || undefined }))}
          style={{ flex: '0 1 auto', maxWidth: 220 }}
        >
          <option value="">All movements</option>
          {movements.map((m) => (
            <option key={m.name} value={m.name}>{m.name} ({m.workoutCount})</option>
          ))}
        </select>

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
                {td === '' ? 'Any time' : td}
              </button>
            );
          })}
        </div>

        <select
          className="lift-input"
          value={filter.year ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : undefined }))}
          style={{ flex: '0 0 auto' }}
        >
          <option value="">All years</option>
          {(scope === 'all' && catalog
            ? catalog.seasons.map((s) => s.season)
            : history.yearsCompeted
          ).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

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

      {/* Your movements */}
      {movements.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Your movements
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {visibleMovements.map((m) => {
              const active = filter.movement === m.name;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => setFilter((f) => ({ ...f, movement: active ? undefined : m.name }))}
                  style={{
                    fontSize: 12, padding: '3px 9px', borderRadius: 999,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent)' : 'var(--surface2)',
                    color: active ? '#fff' : 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {m.name} <span style={{ opacity: 0.7 }}>· {m.workoutCount}</span>
                </button>
              );
            })}
            {movements.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllMovements((v) => !v)}
                style={{
                  fontSize: 12, padding: '3px 9px', borderRadius: 999,
                  border: '1px solid var(--border)', background: 'none',
                  color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {showAllMovements ? 'show fewer' : `+${movements.length - 12} more`}
              </button>
            )}
          </div>
        </div>
      )}

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
          filledIds={filledIds}
          onSelectFilled={(id) => { const e = history.byId[id]; if (e) setSelectedWorkout(e); }}
          onSelectUnfilled={setSelectedCatalogWorkout}
          matchWorkout={matchWorkout}
        />
      ) : null}

      {selectedWorkout && (
        <WorkoutDetail entry={selectedWorkout} onClose={() => setSelectedWorkout(null)} />
      )}
      {selectedCatalogWorkout && (
        <CatalogWorkoutCard workout={selectedCatalogWorkout} onClose={() => setSelectedCatalogWorkout(null)} />
      )}
    </div>
  );
}
