/**
 * CompetitionHistoryExperience — the full Tier 4 competition-history surface,
 * extracted from the old collapsible CompetitionHistorySection so it can live
 * on its own `/competition-history` route inside page chrome.
 *
 * Three states:
 *   - Unlinked          → name search → results list → pick one;
 *                         plus a paste-ID fallback for direct entry
 *   - Pending-confirm   → identity card + permanence warning + checkbox + Link
 *   - Linked            → when the rich `all_results` bundle is present: a
 *                         Summary / Map / Movements tab strip (Summary = the
 *                         identity line — name · seasons · workout count;
 *                         Map = CompetitionExplorer; Movements = the fingerprint
 *                         list, drilling into a pre-filtered Map). Otherwise the
 *                         recent-results fallback. Plus an admin-only "clear
 *                         linkage" override.
 *
 * Self-contained: owns its own state, talks to search-competition-athletes +
 * verify-competition-athlete, and writes the linkage to athlete_profiles
 * directly. The host page only feeds it the initial linkage (so a deep-link
 * load renders without a flash) and the user's age.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AllResultsEntry, ThrowbackRow, CatalogWorkoutSummary } from '../../lib/competitionHistory';
import { normalizeWithThrowbacks, throwbacksToEntries, normalizeCatalog } from '../../lib/competitionHistory';
import CompetitionExplorer, { type Scope, type Filter } from './CompetitionExplorer';
import MovementsPanel from './MovementsPanel';
import SummaryPanel, { type SignatureLite } from './SummaryPanel';

type ExperienceTab = 'summary' | 'map' | 'movements';

interface BundleIdentity {
  name: string;
  profile_url: string | null;
  competitor_id: string;
}

interface BundleTrend {
  direction: 'improving' | 'plateau' | 'declining' | 'new';
  percentile_points_per_year: number | null;
}

interface BundleSummary {
  overall_competitive_tier: 'open_only' | 'qualifier' | 'regionals' | 'games_athlete';
  seasons_competed: number;
  latest_percentile: number;
  trend: BundleTrend;
  consistency: number | null;
}

interface BundleRecentResult {
  rank: number;
  movements: string[];
  raw_score: number;
  percentile: number;
  time_domain: 'short' | 'medium' | 'long' | null;
  scoring_unit: 'time' | 'reps' | 'load_lbs' | 'distance';
  workout_label: string;
  // Added in profile bundle 1.3.0 (additive).
  competition_workout_id?: string;
  worldwide_percentile?: number;
  cohort_n?: number;
  worldwide_n?: number;
}

interface Tier4Bundle {
  identity: BundleIdentity;
  competition_summary: BundleSummary;
  recent_raw_results: BundleRecentResult[];
  // Present only when fetched with include:['all_results'] (bundle 1.3.0).
  all_results?: AllResultsEntry[];
  // Present only when fetched with include:['signature'] (bundle 1.5.0). Only
  // the bits the Summary uses are typed here (the full shape lives in the edge
  // fn's Tier4FitnessSignature).
  fitness_signature?: SignatureLite;
}

interface SearchResult {
  competitor_id: string;
  name: string;
  affiliate: string | null;
  region: string | null;
  division: string;
  seasons_competed: number;
  highest_stage_reached: string;
  most_recent_season: number;
  best_finish: string;
  profile_url: string | null;
  photo_url: string | null;
}

// The competition-service returns its own placeholder key (not null) when an
// athlete has no profile photo. Treat that as "no photo".
const PLACEHOLDER_PHOTO_SUFFIX = '/athlete-avatar.jpg';

interface Props {
  userId: string;
  userAge: number | null;
  /** Athlete body mass (kg) — used to personalize competed-workout power. */
  userBodyMassKg: number | null;
  /** Gates the "clear linkage" override (and the admin note). */
  isAdmin: boolean;
  /** Try-It (logging results) — the paid competition_log capability. */
  canLog: boolean;
  initialLinkedId: string | null;
  initialLinkedLabel: string | null;
  /** Called after a successful link/unlink so the host page can refresh. */
  onLinkageChange?: (next: { id: string | null; label: string | null }) => void;
}

type Mode = 'unlinked' | 'pending-confirm' | 'linked';

const TIER_LABEL: Record<BundleSummary['overall_competitive_tier'], string> = {
  open_only: 'Open Only',
  qualifier: 'Qualifier',
  regionals: 'Regionals',
  games_athlete: 'Games Athlete',
};

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  const real = !!photoUrl && !photoUrl.endsWith(PLACEHOLDER_PHOTO_SUFFIX) && !broken;
  if (real) {
    return (
      <img
        src={photoUrl!}
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setBroken(true)}
      />
    );
  }
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div style={{
      width: 40,
      height: 40,
      borderRadius: '50%',
      background: 'var(--surface2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: 16,
      color: 'var(--text-dim)',
      flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}

export default function CompetitionHistoryExperience({
  userId,
  userAge,
  userBodyMassKg,
  isAdmin,
  canLog,
  initialLinkedId,
  initialLinkedLabel,
  onLinkageChange,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialLinkedId ? 'linked' : 'unlinked');
  const [linkedId, setLinkedId] = useState<string | null>(initialLinkedId);
  const [linkedLabel, setLinkedLabel] = useState<string | null>(initialLinkedLabel);

  // Search flow (unlinked mode)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDivision, setSearchDivision] = useState<'' | 'men' | 'women'>('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Linking flow (unlinked → pending-confirm → linked)
  const [pasteId, setPasteId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [pendingBundle, setPendingBundle] = useState<Tier4Bundle | null>(null);
  // The search result the user picked (carries photo_url + best_finish, which
  // the bundle doesn't); null on the paste-ID path.
  const [pendingSearchResult, setPendingSearchResult] = useState<SearchResult | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Linked-state bundle (fetched on mount when already linked)
  const [linkedBundle, setLinkedBundle] = useState<Tier4Bundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  // Linked-state view: tab strip + the Map's scope/filter (lifted here so the
  // Movements / Summary tabs can switch to Map with a movement pre-applied).
  const [tab, setTab] = useState<ExperienceTab>('summary');
  const [scope, setScope] = useState<Scope>('mine');
  const [filter, setFilter] = useState<Filter>({});
  const goToMapForMovement = (movement: string) => {
    setScope('mine');
    setFilter({ movement });
    setTab('map');
  };

  // Logged throwbacks (own competition_workout_results) + the catalog to resolve
  // them, merged into "Your workouts" as flagged 'logged' entries.
  const [throwbackRows, setThrowbackRows] = useState<ThrowbackRow[]>([]);
  const [catalogById, setCatalogById] = useState<Record<string, CatalogWorkoutSummary>>({});
  // Bumped when a throwback is logged → refetch the rows so a just-logged one
  // (with its now-persisted placement) merges into "Your workouts".
  const [throwbackToken, setThrowbackToken] = useState(0);

  const competitionHistory = useMemo(
    () => normalizeWithThrowbacks(linkedBundle?.all_results, throwbacksToEntries(throwbackRows, catalogById)),
    [linkedBundle, throwbackRows, catalogById],
  );

  // Fetch the bundle on mount when already linked. Re-fetch when linkedId
  // changes (admin override scenario).
  useEffect(() => {
    if (mode !== 'linked' || !linkedId) {
      setLinkedBundle(null);
      return;
    }
    let cancelled = false;
    setBundleLoading(true);
    setBundleError(null);
    (async () => {
      const { data, error } = await supabase.functions.invoke<{ bundle: Tier4Bundle; error?: string }>(
        'verify-competition-athlete',
        { body: { competition_athlete_id: linkedId, include: ['all_results', 'signature'] } },
      );
      if (cancelled) return;
      setBundleLoading(false);
      if (error || !data?.bundle) {
        setBundleError('Could not load competition history.');
        return;
      }
      setLinkedBundle(data.bundle);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, linkedId]);

  // Catalog (resolves a throwback's season/stage/movements) — once when linked.
  useEffect(() => {
    if (mode !== 'linked' || !linkedId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.functions.invoke<{ workouts?: CatalogWorkoutSummary[]; error?: string }>('competition-catalog', { body: {} });
      if (!cancelled && data?.workouts) setCatalogById(normalizeCatalog(data.workouts).byId);
    })();
    return () => { cancelled = true; };
  }, [mode, linkedId]);

  // The athlete's logged throwbacks — refetched on link change AND after a log
  // (throwbackToken), so a just-logged throwback merges into "Your workouts".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode !== 'linked' || !linkedId) { if (!cancelled) setThrowbackRows([]); return; }
      const { data } = await supabase
        .from('competition_workout_results')
        .select('competition_workout_id, score_type, score_value, finished, cohort_percentile, worldwide_percentile, worldwide_rank, field_size, cohort_size, joules, avg_power_watts, avg_w_per_kg')
        .eq('source', 'throwback');
      if (!cancelled && data) setThrowbackRows(data as ThrowbackRow[]);
    })();
    return () => { cancelled = true; };
  }, [mode, linkedId, throwbackToken]);

  // Verify an athlete and move to the confirm step. `idOverride` is passed
  // when the user picked a search result; otherwise the paste-ID input drives.
  const onVerify = async (idOverride?: string) => {
    const trimmed = (idOverride ?? pasteId).trim();
    if (!trimmed) {
      setVerifyError('Enter a competitor ID.');
      return;
    }
    if (!idOverride) setPendingSearchResult(null); // paste-ID path: no search result
    setVerifying(true);
    setVerifyError(null);
    setPendingBundle(null);

    const { data, error } = await supabase.functions.invoke<{ bundle: Tier4Bundle; error?: string }>(
      'verify-competition-athlete',
      { body: { competition_athlete_id: trimmed, include: ['all_results', 'signature'] } },
    );
    setVerifying(false);

    if (error || !data?.bundle) {
      setVerifyError(idOverride
        ? 'We couldn\'t load competition data for that athlete. They may not have enough history yet.'
        : 'We couldn\'t find that athlete. Double-check the ID and try again.');
      return;
    }
    setPendingBundle(data.bundle);
    setConfirmChecked(false);
    setMode('pending-confirm');
  };

  const onSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSearchError('Enter at least 3 characters.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    const { data, error } = await supabase.functions.invoke<{ results?: SearchResult[]; error?: string }>(
      'search-competition-athletes',
      { body: { q, division: searchDivision || undefined } },
    );
    setSearching(false);
    if (error || data?.error) {
      setSearchError('Search failed. Try again.');
      return;
    }
    const results = data?.results ?? [];
    if (results.length === 0) {
      setSearchError('No athletes found. Try a different spelling.');
      return;
    }
    setSearchResults(results);
  };

  const onSelectResult = (result: SearchResult) => {
    setSearchError(null);
    setPendingSearchResult(result);
    onVerify(result.competitor_id);
  };

  const onCancelPending = () => {
    setPendingBundle(null);
    setPendingSearchResult(null);
    setConfirmChecked(false);
    setMode(linkedId ? 'linked' : 'unlinked');
  };

  const onConfirmLink = async () => {
    if (!pendingBundle || !confirmChecked) return;
    setSaving(true);
    setSaveError(null);
    const id = pendingBundle.identity.competitor_id;
    const label = pendingBundle.identity.name;
    // photo_url / best_finish carry into the DB row for later use (affiliate
    // roster etc.) — the competition-history surface itself no longer shows them.
    const photoUrl = pendingSearchResult?.photo_url ?? null;
    const bestFinish = pendingSearchResult?.best_finish ?? null;
    const { error } = await supabase
      .from('athlete_profiles')
      .upsert(
        {
          user_id: userId,
          competition_athlete_id: id,
          competition_athlete_label: label,
          competition_athlete_photo_url: photoUrl,
          competition_athlete_best_finish: bestFinish,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    setSaving(false);
    if (error) {
      setSaveError(error.message || 'Failed to save the linkage.');
      return;
    }
    setLinkedId(id);
    setLinkedLabel(label);
    setLinkedBundle(pendingBundle);
    setPendingBundle(null);
    setPendingSearchResult(null);
    setConfirmChecked(false);
    setPasteId('');
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setMode('linked');
    onLinkageChange?.({ id, label });
  };

  // Admin-only override — clears the linkage so a different ID can be tested.
  // Production users should not see this.
  const onAdminOverride = async () => {
    if (!confirm('Admin override: clear the current linkage? This is not a normal-user flow.')) return;
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase
      .from('athlete_profiles')
      .upsert(
        {
          user_id: userId,
          competition_athlete_id: null,
          competition_athlete_label: null,
          competition_athlete_photo_url: null,
          competition_athlete_best_finish: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    setSaving(false);
    if (error) {
      setSaveError(error.message || 'Failed to clear the linkage.');
      return;
    }
    setLinkedId(null);
    setLinkedLabel(null);
    setLinkedBundle(null);
    setPendingSearchResult(null);
    setPasteId('');
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setMode('unlinked');
    onLinkageChange?.({ id: null, label: null });
  };

  return (
    <div className="settings-card">
      {mode === 'unlinked' && (
        <div>
          <p className="athlete-card-subtitle" style={{ marginBottom: 12 }}>
            Search for your CrossFit competition profile to link it to your account.
            Once confirmed, this linkage is permanent.
          </p>

          {/* Search */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="lift-input"
              placeholder="Search by name (e.g. Mathew Fraser)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim().length >= 3 && !searching) onSearch(); }}
              style={{ flex: '1 1 220px', minWidth: 0 }}
              disabled={searching}
            />
            <select
              className="lift-input"
              value={searchDivision}
              onChange={e => setSearchDivision(e.target.value as '' | 'men' | 'women')}
              disabled={searching}
              style={{ flex: '0 0 auto' }}
            >
              <option value="">All divisions</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
            </select>
            <button
              type="button"
              className="auth-btn"
              style={{ padding: '8px 16px', fontSize: 13 }}
              onClick={onSearch}
              disabled={searching || searchQuery.trim().length < 3}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--danger, #d33)' }}>{searchError}</div>
          )}

          {/* Results */}
          {searchResults.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {searchResults.map(r => {
                const meta = [
                  r.affiliate,
                  r.region,
                  `${r.seasons_competed} season${r.seasons_competed === 1 ? '' : 's'}`,
                  `best: ${r.best_finish}`,
                ].filter(Boolean).join(' · ');
                return (
                  <button
                    key={r.competitor_id}
                    type="button"
                    onClick={() => onSelectResult(r)}
                    disabled={verifying}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      cursor: verifying ? 'wait' : 'pointer',
                      fontFamily: 'inherit',
                      width: '100%',
                    }}
                  >
                    <Avatar name={r.name} photoUrl={r.photo_url} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name} <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>· {r.division}</span></div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {verifying && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-dim)' }}>Loading that athlete…</div>
          )}

          {/* Paste-ID fallback */}
          <details style={{ marginTop: 14 }}>
            <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>Or enter a competitor ID directly</summary>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <input
                type="text"
                className="lift-input"
                placeholder="Competitor ID (e.g. 153604)"
                value={pasteId}
                onChange={e => setPasteId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && pasteId.trim() && !verifying) onVerify(); }}
                style={{ flex: '1 1 200px', minWidth: 0 }}
                disabled={verifying}
              />
              <button
                type="button"
                className="auth-btn"
                style={{ padding: '8px 16px', fontSize: 13 }}
                onClick={() => onVerify()}
                disabled={verifying || !pasteId.trim()}
              >
                {verifying ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </details>

          {verifyError && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--danger, #d33)' }}>{verifyError}</div>
          )}
        </div>
      )}

      {mode === 'pending-confirm' && pendingBundle && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Is this you?</h3>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{pendingBundle.identity.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              {TIER_LABEL[pendingBundle.competition_summary.overall_competitive_tier]} ·{' '}
              {pendingBundle.competition_summary.seasons_competed} season{pendingBundle.competition_summary.seasons_competed === 1 ? '' : 's'} ·{' '}
              latest {pendingBundle.competition_summary.latest_percentile.toFixed(1)} pct
            </div>
            {pendingBundle.identity.profile_url && (
              <div style={{ fontSize: 12, marginTop: 8 }}>
                <a href={pendingBundle.identity.profile_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                  View profile on games.crossfit.com →
                </a>
              </div>
            )}
          </div>

          <div style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            fontSize: 13,
          }}>
            <strong>Once linked, this connection is permanent.</strong> Your evaluations and
            generated programs will reference this competitor going forward.
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={e => setConfirmChecked(e.target.checked)}
            />
            I confirm this is my competition profile
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="auth-btn"
              style={{ padding: '8px 16px', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)' }}
              onClick={onCancelPending}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="auth-btn"
              style={{ padding: '8px 16px', fontSize: 13 }}
              onClick={onConfirmLink}
              disabled={!confirmChecked || saving}
            >
              {saving ? 'Linking…' : 'Link permanently'}
            </button>
          </div>
          {saveError && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--danger, #d33)' }}>{saveError}</div>
          )}
        </div>
      )}

      {mode === 'linked' && (
        <div>
          {bundleLoading && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Loading competition history{linkedLabel ? ` for ${linkedLabel}` : ''}…
            </div>
          )}
          {bundleError && (
            <div style={{ fontSize: 13, color: 'var(--danger, #d33)' }}>{bundleError}</div>
          )}
          {linkedBundle && (() => {
            const cs = linkedBundle.competition_summary;
            const hasMap = !!(linkedBundle.all_results && linkedBundle.all_results.length > 0);

            const summaryPanel = (
              <SummaryPanel
                name={linkedBundle.identity.name}
                profileUrl={linkedBundle.identity.profile_url}
                seasonsCompeted={cs.seasons_competed}
                history={competitionHistory}
                signature={linkedBundle.fitness_signature}
                onPickMovement={goToMapForMovement}
              />
            );

            if (!hasMap) {
              // No rich all_results bundle — the brief overview + the recent-results fallback, no tabs.
              return (
                <>
                  {summaryPanel}
                  {linkedBundle.recent_raw_results.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Recent results</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {linkedBundle.recent_raw_results.slice(0, 5).map((r, i) => {
                          const movements = Array.from(new Set(r.movements ?? []));
                          const moves = movements.length === 0 ? '—' : movements.slice(0, 4).join(' + ') + (movements.length > 4 ? ' + …' : '');
                          return (
                            <div key={i} style={{ fontSize: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                              <div style={{ fontWeight: 600 }}>{r.workout_label}</div>
                              <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>
                                rank {r.rank} · {r.percentile.toFixed(1)} pct · {r.raw_score} {r.scoring_unit}
                                {r.time_domain ? ` · ${r.time_domain} time` : ''}
                              </div>
                              <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>{moves}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            }

            const tabBtn = (id: ExperienceTab, label: string) => (
              <button
                type="button"
                onClick={() => setTab(id)}
                style={{
                  padding: '8px 4px',
                  marginBottom: -1,
                  fontSize: 13,
                  fontWeight: tab === id ? 700 : 500,
                  color: tab === id ? 'var(--accent)' : 'var(--text-dim)',
                  background: 'none',
                  border: 'none',
                  borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            );

            return (
              <>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
                  {tabBtn('summary', 'Summary')}
                  {tabBtn('map', 'Workouts')}
                  {tabBtn('movements', 'All Movements')}
                </div>

                {tab === 'summary' && summaryPanel}

                {/* The Map stays mounted (display-toggled) so the lazily-fetched
                    catalog and any throwbacks logged this session survive a tab switch. */}
                <div style={{ display: tab === 'map' ? 'block' : 'none' }}>
                  <CompetitionExplorer
                    history={competitionHistory}
                    userAge={userAge}
                    userBodyMassKg={userBodyMassKg}
                    canLog={canLog}
                    onThrowbackLogged={() => setThrowbackToken((t) => t + 1)}
                    scope={scope}
                    setScope={setScope}
                    filter={filter}
                    setFilter={setFilter}
                  />
                </div>

                {tab === 'movements' && (
                  <MovementsPanel history={competitionHistory} onPick={goToMapForMovement} />
                )}
              </>
            );
          })()}

          {isAdmin && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Admin-only — production users will not see this.
              </div>
              <button
                type="button"
                className="auth-btn"
                style={{ padding: '6px 12px', fontSize: 12, background: 'var(--surface2)', color: 'var(--text)' }}
                onClick={onAdminOverride}
                disabled={saving}
              >
                {saving ? 'Working…' : 'Override: clear linkage'}
              </button>
              {saveError && (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--danger, #d33)' }}>{saveError}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
