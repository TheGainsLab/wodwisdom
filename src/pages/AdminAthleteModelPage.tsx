import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

/**
 * Athlete Model inspector (coaching-state Step 1 debug surface).
 *
 * The first place to look when Strategy / a workout / a bug report looks
 * strange. Shows the LIVE recompute (current profile, never persisted) and the
 * persisted version history side-by-side, and flags drift between them.
 *
 * Deliberately a thin debug view: raw sections + a JSON dump, no styling
 * investment.
 */

// ── Types (loose; this is a debug view) ──────────────────────────────

interface ModelLike {
  version?: number;
  profile_version?: number;
  created_at?: string;
  thresholds_version?: string;
  model_builder_version?: string;
  recovery_class?: string;
  capabilities?: Record<string, { value: number | null; source: string; confidence: string; as_of: string | null }>;
  strength_ratios?: Record<string, number | null>;
  normative?: Record<string, { value: number; threshold: number; gap: number; position: string }>;
  derived_metrics?: Record<string, unknown>;
  ranked_by_position?: string[];
  competition_movements?: Record<string, {
    movement: string; percentile: number; threshold: number; gap: number;
    position: string; sample_size: number; confidence: string;
  }>;
}

interface CoachStateLike {
  version: number;
  athlete_model_version: number;
  cycle_pointer?: { month: number } | null;
  headline?: string;
  summary?: string;
  priorities?: Array<{
    focus: string; rank: number; confidence: string; reasons: string[];
    evidence: string[]; athlete_facing_rationale: string; recommended_action: string;
  }>;
  maintain?: Array<{ focus: string; reasons: string[]; athlete_facing_rationale: string }>;
  deprioritize?: Array<{ focus: string; reasons: string[] }>;
  recovery_posture?: { stance: string; confidence: string; reasons: string[] };
  strength_emphasis?: { value: string; confidence: string; reasons: string[] };
}

interface InspectResponse {
  user_id: string;
  builder: { thresholds_version: string; model_builder_version: string };
  profile_exists: boolean;
  competition_linked: boolean;
  live: { model: ModelLike; profile_static: unknown } | null;
  coach_state: {
    version: number; athlete_model_version: number;
    coach_state_builder_version: string; coach_state: CoachStateLike; created_at: string;
  } | null;
  diffs: {
    training: {
      lift_changes: Array<{ lift: string; from_est_1rm: number | null; to_est_1rm: number; from_sessions: number; to_sessions: number }>;
      new_movements: string[];
      sessions_logged_from: number; sessions_logged_to: number;
    } | null;
    belief: {
      capability_changes: Array<{ lift: string; from: number | null; to: number | null; from_source: string; to_source: string }>;
      position_changes: Array<{ key: string; from: string; to: string }>;
    } | null;
    decisions: {
      priorities_added: string[]; priorities_removed: string[];
      rank_changes: Array<{ focus: string; from: number; to: number }>;
      recovery_change: { from: string; to: string } | null;
      strength_emphasis_change: { from: string; to: string } | null;
    } | null;
  } | null;
  persisted: {
    latest: (ModelLike & { model: ModelLike }) | null;
    versions: Array<{ version: number; profile_version: number; created_at: string; model_hash: string }>;
    full_models: Array<{ version: number; model: ModelLike; model_hash: string; created_at: string }>;
  };
}

// ── Reusable bits (mirrors AdminAthleteProfilePage) ──────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{
        fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 10,
      }}>{title}</h3>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 16,
      }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: React.ReactNode; dim?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{
        fontWeight: 500, fontFamily: "'JetBrains Mono', monospace",
        color: dim ? 'var(--text-muted)' : undefined,
      }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

const POSITION_COLORS: Record<string, string> = {
  well_below: '#e5484d',
  below: '#f5a623',
  at_or_near: 'var(--text-dim)',
  above: '#46a758',
  well_above: '#30a46c',
};

function PositionTag({ position }: { position: string }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600,
      color: POSITION_COLORS[position] ?? 'var(--text-muted)',
      background: 'var(--border)',
    }}>
      {position}
    </span>
  );
}

// Order-independent stringify. Postgres stores jsonb with NORMALIZED key order,
// so a persisted model's object keys come back in a different order than a
// freshly-computed live model — plain JSON.stringify would see identical data as
// different. Sort keys recursively so the comparison is by content, not order.
function stableStr(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStr(o[k])).join(',') + '}';
}

// Drift comparison = PROFILE-controlled facts only: capability values, strength
// ratios, recovery class. Everything competition-derived (derived_metrics,
// competition_movements, the competition normatives + their ranking) comes from
// a live external feed that legitimately moves between snapshots — including it
// would make the banner cry wolf for every linked athlete. `as_of` is dropped
// too (a no-op profile re-save bumps it without changing a fact). Drift should
// mean "the athlete's self-reported profile changed."
function semantic(m: ModelLike | undefined | null): string {
  if (!m) return '';
  const caps: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(m.capabilities ?? {})) {
    caps[k] = { value: c.value, source: c.source };
  }
  return stableStr({ caps, strength_ratios: m.strength_ratios ?? {}, recovery_class: m.recovery_class ?? null });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminAthleteModelPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<InspectResponse | null>(null);
  const [selected, setSelected] = useState<string>('live'); // 'live' | version number
  const [showJson, setShowJson] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    if (!id) return;
    const { data: result, error: err } = await supabase.functions.invoke('athlete-model-inspect', {
      body: { user_id: id },
    });
    if (err) setError(err.message);
    else setData(result as InspectResponse);
  }

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError('');
      await load();
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runCoachState() {
    if (!id) return;
    setRunning(true);
    setError('');
    // force: bypass reuse-if-current so the admin always gets a fresh roll.
    const { error: err } = await supabase.functions.invoke('profile-analysis-v2', {
      body: { user_id: id, force: true },
    });
    if (err) setError(err.message);
    else await load();
    setRunning(false);
  }

  const liveModel = data?.live?.model ?? null;
  const latestPersisted = data?.persisted?.latest?.model ?? null;
  const drift = useMemo(() => {
    if (!liveModel || !latestPersisted) return false;
    return semantic(liveModel) !== semantic(latestPersisted);
  }, [liveModel, latestPersisted]);

  const selectedModel: ModelLike | null = useMemo(() => {
    if (!data) return null;
    if (selected === 'live') return liveModel;
    const v = data.persisted.full_models.find((m) => String(m.version) === selected);
    return v?.model ?? null;
  }, [data, selected, liveModel]);

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Athlete Model">
      {loading && <div className="page-loading"><div className="loading-pulse" /></div>}

      {error && (
        <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>
      )}

      {!loading && data && !data.profile_exists && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)',
        }}>
          No athlete profile yet — nothing to model.
        </div>
      )}

      {data && data.profile_exists && (
        <>
          {/* Drift banner */}
          {drift && (
            <div style={{
              background: 'rgba(245,166,35,0.12)', border: '1px solid #f5a623',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13,
            }}>
              ⚠️ <strong>Drift:</strong> the live recompute differs from the latest persisted version
              (v{data.persisted.latest?.model.version}). The profile changed since the last generation;
              in-flight programs still reference the pinned version.
            </div>
          )}
          {!drift && latestPersisted && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              ✓ Live recompute matches latest persisted version (v{data.persisted.latest?.model.version}).
            </div>
          )}
          {!latestPersisted && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              No persisted versions yet — showing the live recompute only.
            </div>
          )}

          {/* Version picker */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            <button
              onClick={() => setSelected('live')}
              style={chipStyle(selected === 'live')}
            >
              Live (current profile)
            </button>
            {data.persisted.versions.map((v) => (
              <button
                key={v.version}
                onClick={() => setSelected(String(v.version))}
                style={chipStyle(selected === String(v.version))}
              >
                v{v.version}
              </button>
            ))}
          </div>

          {/* The three diffs — what changed in training / belief / decisions (Step 4) */}
          <DiffsBlock diffs={data.diffs} />

          {/* CoachState — the judgment layer (Step 2) */}
          <CoachStateBlock
            cs={data.coach_state}
            latestModelVersion={data.persisted.latest?.model.version ?? null}
            onRun={runCoachState}
            running={running}
          />

          {selectedModel && (
            <>
              <Section title="Provenance">
                <Row label="Model version" value={selected === 'live' ? 'live (unpersisted)' : `v${selectedModel.version}`} />
                <Row label="Profile version" value={selectedModel.profile_version ?? '—'} />
                <Row label="Recovery class" value={selectedModel.recovery_class} />
                <Row label="Thresholds version" value={selectedModel.thresholds_version ?? data.builder.thresholds_version} />
                <Row label="Builder version" value={selectedModel.model_builder_version ?? data.builder.model_builder_version} />
                <Row label="Created" value={selectedModel.created_at ?? '—'} dim />
                <Row label="Competition linked" value={data.competition_linked ? 'yes' : 'no'} />
              </Section>

              <Section title="Capabilities (1RMs)">
                {Object.entries(selectedModel.capabilities ?? {}).map(([k, c]) => (
                  <Row
                    key={k}
                    label={k}
                    value={c.value == null
                      ? <span style={{ color: 'var(--text-muted)' }}>missing</span>
                      : `${c.value} · ${c.source}/${c.confidence}`}
                    dim={c.value == null}
                  />
                ))}
              </Section>

              <Section title="Strength Ratios">
                {Object.entries(selectedModel.strength_ratios ?? {}).map(([k, v]) => (
                  <Row key={k} label={k} value={v == null ? <span style={{ color: 'var(--text-muted)' }}>null</span> : v} dim={v == null} />
                ))}
              </Section>

              <Section title="Normative (vs thresholds — facts, not priorities)">
                {Object.keys(selectedModel.normative ?? {}).length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>None computable (missing inputs).</div>
                )}
                {Object.entries(selectedModel.normative ?? {}).map(([k, n]) => (
                  <div key={k} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
                  }}>
                    <span style={{ color: 'var(--text-dim)' }}>{k}</span>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
                      <span>{n.value} / {n.threshold} ({n.gap >= 0 ? '+' : ''}{n.gap})</span>
                      <PositionTag position={n.position} />
                    </span>
                  </div>
                ))}
              </Section>

              <Section title="Ranked by Position (factual ordering — most below first; NOT a priority list)">
                {(selectedModel.ranked_by_position ?? []).length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</div>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                    {(selectedModel.ranked_by_position ?? []).map((k) => {
                      const n = selectedModel.normative?.[k];
                      return (
                        <li key={k} style={{ padding: '3px 0' }}>
                          {k} {n && <PositionTag position={n.position} />}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>

              <Section title="Derived Metrics">
                {Object.keys(selectedModel.derived_metrics ?? {}).length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>None (no competition data).</div>
                ) : (
                  Object.entries(selectedModel.derived_metrics ?? {}).map(([k, v]) => (
                    <Row key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                  ))
                )}
              </Section>

              <Section title="Competition Movements (Step 1.5 — typed facts; percentile vs population median)">
                {Object.keys(selectedModel.competition_movements ?? {}).length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>None (unlinked or no competition movement data).</div>
                ) : (
                  Object.entries(selectedModel.competition_movements ?? {})
                    .sort((a, b) => a[1].percentile - b[1].percentile)
                    .map(([k, mv]) => (
                      <div key={k} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
                      }}>
                        <span style={{ color: 'var(--text-dim)' }}>
                          {mv.movement}
                          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6, fontFamily: "'JetBrains Mono', monospace" }}>{k}</span>
                        </span>
                        <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
                          <span>p{mv.percentile} · n={mv.sample_size}/{mv.confidence}</span>
                          <PositionTag position={mv.position} />
                        </span>
                      </div>
                    ))
                )}
              </Section>

              <button
                onClick={() => setShowJson((s) => !s)}
                style={{ ...chipStyle(false), marginBottom: 12 }}
              >
                {showJson ? 'Hide' : 'Show'} raw JSON
              </button>
              {showJson && (
                <pre style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: 16, fontSize: 11.5, overflow: 'auto', maxHeight: 480,
                  fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5,
                }}>
                  {JSON.stringify(selectedModel, null, 2)}
                </pre>
              )}
            </>
          )}
        </>
      )}
    </AdminSubPageLayout>
  );
}

function DiffsBlock({ diffs }: { diffs: InspectResponse['diffs'] }) {
  if (!diffs) return null;
  const { training, belief, decisions } = diffs;
  const nothing =
    (!training || (training.lift_changes.length === 0 && training.new_movements.length === 0)) &&
    (!belief || (belief.capability_changes.length === 0 && belief.position_changes.length === 0)) &&
    (!decisions || (decisions.priorities_added.length === 0 && decisions.priorities_removed.length === 0 && decisions.rank_changes.length === 0 && !decisions.recovery_change && !decisions.strength_emphasis_change));

  return (
    <Section title="What changed (training → belief → decisions)">
      {nothing && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No prior version to compare against yet (first snapshot).</div>}

      {/* 1. Training */}
      {training && (training.lift_changes.length > 0 || training.new_movements.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>What you did (training)</div>
          {training.sessions_logged_from !== training.sessions_logged_to && (
            <div style={{ fontSize: 12.5, marginBottom: 3 }}>Logged sessions: {training.sessions_logged_from} → {training.sessions_logged_to}</div>
          )}
          {training.lift_changes.map((c) => (
            <div key={c.lift} style={{ fontSize: 12.5 }}>
              {c.lift}: est 1RM {c.from_est_1rm ?? '—'} → <strong>{c.to_est_1rm}</strong> ({c.from_sessions}→{c.to_sessions} sessions)
            </div>
          ))}
          {training.new_movements.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>new: {training.new_movements.join(', ')}</div>
          )}
        </div>
      )}

      {/* 2. Belief */}
      {belief && (belief.capability_changes.length > 0 || belief.position_changes.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>What we learned (belief)</div>
          {belief.capability_changes.map((c) => (
            <div key={c.lift} style={{ fontSize: 12.5 }}>
              {c.lift}: {c.from ?? '—'} → <strong>{c.to ?? '—'}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({c.from_source}→{c.to_source})</span>
            </div>
          ))}
          {belief.position_changes.map((c) => (
            <div key={c.key} style={{ fontSize: 12.5 }}>{c.key}: <Tag text={c.from} /> → <Tag text={c.to} tone="accent" /></div>
          ))}
        </div>
      )}

      {/* 3. Decisions */}
      {decisions && (decisions.priorities_added.length > 0 || decisions.priorities_removed.length > 0 || decisions.rank_changes.length > 0 || decisions.recovery_change || decisions.strength_emphasis_change) && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>What we're changing (decisions)</div>
          {decisions.priorities_added.length > 0 && <div style={{ fontSize: 12.5 }}>+ now developing: {decisions.priorities_added.join(', ')}</div>}
          {decisions.priorities_removed.length > 0 && <div style={{ fontSize: 12.5 }}>− no longer developing: {decisions.priorities_removed.join(', ')}</div>}
          {decisions.rank_changes.map((c) => (
            <div key={c.focus} style={{ fontSize: 12.5 }}>{c.focus}: priority #{c.from} → #{c.to}</div>
          ))}
          {decisions.recovery_change && <div style={{ fontSize: 12.5 }}>recovery: {decisions.recovery_change.from} → {decisions.recovery_change.to}</div>}
          {decisions.strength_emphasis_change && <div style={{ fontSize: 12.5 }}>strength emphasis: {decisions.strength_emphasis_change.from} → {decisions.strength_emphasis_change.to}</div>}
        </div>
      )}
    </Section>
  );
}

function Tag({ text, tone }: { text: string; tone?: 'accent' | 'muted' | 'warn' }) {
  const color = tone === 'accent' ? 'var(--accent)' : tone === 'warn' ? '#f5a623' : 'var(--text-muted)';
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600,
      color, background: 'var(--border)', fontFamily: "'JetBrains Mono', monospace",
    }}>
      {text}
    </span>
  );
}

function RunButton({ onRun, running, label }: { onRun: () => void; running: boolean; label: string }) {
  return (
    <button onClick={onRun} disabled={running} style={{
      ...chipStyle(false), cursor: running ? 'wait' : 'pointer', opacity: running ? 0.6 : 1,
      borderColor: 'var(--accent)', color: 'var(--accent)',
    }}>
      {running ? 'Running…' : label}
    </button>
  );
}

function CoachStateBlock({ cs, latestModelVersion, onRun, running }: {
  cs: InspectResponse['coach_state'];
  latestModelVersion: number | null;
  onRun: () => void;
  running: boolean;
}) {
  if (!cs) {
    return (
      <Section title="CoachState (judgment layer)">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No CoachState yet — generate one from this athlete's current Athlete Model.
          </div>
          <RunButton onRun={onRun} running={running} label="Run CoachState ▸" />
        </div>
      </Section>
    );
  }
  const c = cs.coach_state;
  // Stale = built on an older Athlete Model than the latest persisted one.
  const stale = latestModelVersion != null && cs.athlete_model_version < latestModelVersion;
  const priorities = [...(c.priorities ?? [])].sort((a, b) => a.rank - b.rank);

  return (
    <Section title={`CoachState v${cs.version} — judgment layer`}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>refs Athlete Model v{cs.athlete_model_version}</span>
        <Tag text={cs.coach_state_builder_version} />
        {stale && <Tag text={`stale → latest model is v${latestModelVersion}`} tone="warn" />}
        <span style={{ marginLeft: 'auto' }}>
          <RunButton onRun={onRun} running={running} label="Re-run ▸" />
        </span>
      </div>

      {c.headline && <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{c.headline}</div>}

      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '8px 0 6px' }}>
        Priorities (develop)
      </div>
      {priorities.map((p) => (
        <div key={p.rank} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <Tag text={`#${p.rank}`} tone="accent" />
            <span style={{ fontWeight: 600, fontSize: 13 }}>{p.focus}</span>
            <Tag text={`confidence: ${p.confidence}`} tone={p.confidence === 'low' ? 'warn' : 'muted'} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 4 }}>{p.athlete_facing_rationale}</div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>→ {p.recommended_action}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
            {p.reasons.map((r) => <Tag key={r} text={r} />)}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {p.evidence.length === 0
              ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no normative evidence (soft signal)</span>
              : p.evidence.map((e) => <Tag key={e} text={`◆ ${e}`} tone="accent" />)}
          </div>
        </div>
      ))}

      {(c.maintain ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '12px 0 6px' }}>Maintain</div>
          {(c.maintain ?? []).map((m, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{m.focus}</span> — {m.athlete_facing_rationale}
            </div>
          ))}
        </>
      )}

      {(c.deprioritize ?? []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Deprioritize</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(c.deprioritize ?? []).map((d, i) => <Tag key={i} text={`${d.focus} (${d.reasons.join(', ')})`} />)}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
        {c.recovery_posture && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Recovery</div>
            <Tag text={c.recovery_posture.stance} tone="accent" /> <Tag text={c.recovery_posture.confidence} />
          </div>
        )}
        {c.strength_emphasis && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Strength emphasis</div>
            <Tag text={c.strength_emphasis.value} tone="accent" /> <Tag text={c.strength_emphasis.confidence} />
          </div>
        )}
      </div>

      {c.summary && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {c.summary}
        </div>
      )}
    </Section>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-glow)' : 'var(--surface)',
    color: active ? 'var(--accent)' : 'var(--text-dim)',
  };
}
