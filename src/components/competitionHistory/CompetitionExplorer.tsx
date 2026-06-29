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
import { movementExposure, normalizeCatalog, ageBandFor, prettyMovementName } from '../../lib/competitionHistory';
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
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

// The bundle ("My workouts") was normalized to short/medium/long in 1.9.0, but
// the CATALOG ("All competition workouts") endpoint still emits the legacy 'mid'
// literal — so a raw `bucket === 'medium'` check matched zero of the 339 catalog
// workouts. Fold legacy aliases to the canonical value before comparing.
function normalizeTimeDomain(bucket: string | null | undefined): string {
  const b = (bucket ?? '').trim().toLowerCase();
  if (b === 'mid' || b === 'moderate') return 'medium';
  return b;
}

export default function CompetitionExplorer({
  history,
  userAge,
  userBodyMassKg,
  athleteName,
  canLog,
  onThrowbackLogged,
  scope,
  setScope,
  filter,
  setFilter,
}: {
  history: NormalizedCompetitionHistory;
  userAge: number | null;
  userBodyMassKg: number | null;
  athleteName?: string | null;
  canLog: boolean;
  /** Called after a throwback is logged + its form closed, so the parent can
   *  refetch and merge it into "Your workouts". */
  onThrowbackLogged?: () => void;
  scope: Scope;
  setScope: Dispatch<SetStateAction<Scope>>;
  filter: Filter;
  setFilter: Dispatch<SetStateAction<Filter>>;
}) {
  const ageBand = ageBandFor(userAge);
  const [selectedWorkout, setSelectedWorkout] = useState<CompetitionWorkoutEntry | null>(null);
  const [selectedCatalogWorkout, setSelectedCatalogWorkout] = useState<CatalogWorkoutSummary | null>(null);
  // "Try it" — the workout being logged + ids logged this session. loggedIds
  // gives the "All" map an optimistic green immediately; the "Mine" grid updates
  // when the log form closes (onThrowbackLogged → parent refetch + merge).
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
      if (filter.timeDomain && normalizeTimeDomain(e.workout.time_domain?.bucket) !== filter.timeDomain) return false;
      if (filter.movement && !e.workout.movements.some((m) => m.name === filter.movement)) return false;
      return true;
    };
  }, [isFiltered, filter.year, filter.timeDomain, filter.movement]);

  const matchWorkout = useMemo(() => {
    if (!isFiltered) return undefined;
    return (w: CatalogWorkoutSummary): boolean => {
      if (filter.year != null && w.season !== filter.year) return false;
      if (filter.timeDomain && normalizeTimeDomain(w.time_domain?.bucket) !== filter.timeDomain) return false;
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
      {/* Scope — which dataset (a mode, distinct from the filters below). */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', marginRight: 2 }}>Showing:</span>
        {scopeBtn('mine', 'My workouts')}
        {scopeBtn('all', 'All competition workouts')}
      </div>

      {/* Duration — tappable buttons (a small fixed set reads better as pills
          than a dropdown). "Any" clears it. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', marginRight: 2 }}>Duration:</span>
        {([...TIME_DOMAINS, null] as Array<TimeDomain | null>).map((td) => {
          const active = (filter.timeDomain ?? null) === td;
          return (
            <button
              key={td ?? 'any'}
              type="button"
              onClick={() => setFilter((f) => ({ ...f, timeDomain: td ?? undefined }))}
              style={{
                padding: '6px 12px', fontSize: 12, borderRadius: 6,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent)' : 'var(--surface2)',
                color: active ? '#fff' : 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {td ? TIME_DOMAIN_LABEL[td] : 'Any'}
            </button>
          );
        })}
      </div>

      {/* Movement + year filters (dropdowns; each "All …" option is its own clear). */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select
          className="cw-select"
          value={filter.movement ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, movement: e.target.value || undefined }))}
          style={{ flex: '1 1 150px', minWidth: 0 }}
        >
          <option value="">All movements</option>
          {movementsByName.map((m) => (
            <option key={m.name} value={m.name}>{prettyMovementName(m.name)} ({m.workoutCount})</option>
          ))}
        </select>

        <select
          className="cw-select"
          value={filter.year ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : undefined }))}
          style={{ flex: '1 1 110px', minWidth: 0 }}
        >
          <option value="">All years</option>
          {(scope === 'all' && catalog ? catalog.seasons.map((s) => s.season) : history.yearsCompeted).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {scope === 'mine' && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto' }}>
            {isFiltered ? `showing ${matchedCount} of ${history.total}` : `${history.total} workouts`}
          </span>
        )}
      </div>

      {/* Discoverability nudge — a sparse history (0–2 workouts) gives no hint
          that the full catalog is one toggle away and that any workout, at any
          level, can be logged as a throwback. Surface that bridge here. */}
      {scope === 'mine' && !isFiltered && history.total <= 2 && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: 'var(--text)' }}>
            {history.total === 0
              ? "You haven't logged any competition workouts yet."
              : 'Want to try more?'}{' '}
            Browse every competition workout — Open through the Games, all the way back to 2011 — and log any one
            as a throwback (even levels you've never competed at).
          </div>
          <button
            type="button"
            onClick={() => setScope('all')}
            style={{
              marginTop: 10,
              padding: '6px 12px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Browse all competition workouts →
          </button>
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
          userKg={userBodyMassKg}
          athleteName={athleteName}
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
        <LogResultForm
          workout={logTarget}
          ageBand={ageBand}
          onLogged={onLogged}
          onClose={() => {
            // If this workout was logged, its placement is now persisted —
            // tell the parent to refetch so it merges into "Your workouts".
            const loggedThis = loggedIds.has(logTarget.competition_workout_id);
            setLogTarget(null);
            if (loggedThis) onThrowbackLogged?.();
          }}
        />
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
