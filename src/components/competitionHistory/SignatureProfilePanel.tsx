/**
 * SignatureProfilePanel — the "Profile" tab of the competition-history
 * surface: the athlete's fitted capability profile, rendered under the
 * display rulings of 2026-11-02:
 *
 *   - 92/8 hierarchy: level leads, the shape dials sit inside it
 *   - TWO LENSES on every dial: absolute percentile AND relative-to-self
 *   - TWO CARDS: evidence-backed limiters vs width-driven unknowns —
 *     not-knowing is never presented as a finding
 *   - story sentences from the templated narrator (lib/signatureProfile),
 *     which sees only the structured profile
 *   - concordance capture ("does this match?") → signature_fit_log,
 *     the known-athlete validation accumulating in production
 */

import { useMemo, useState } from 'react';
import { useSignatureProfile } from '../../hooks/useSignatureProfile';
import { readProfile } from '../../lib/signatureProfile';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
      {children}
    </div>
  );
}

export default function SignatureProfilePanel({ userId }: { userId: string | undefined }) {
  const { profile, loading, refreshing, error, refresh, sendConcordance, concordanceSent, canConcord } =
    useSignatureProfile(userId);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  const read = useMemo(() => (profile ? readProfile(profile) : null), [profile]);

  if (loading) {
    return <div style={{ color: 'var(--text-dim)', padding: '24px 0' }}>Loading your profile…</div>;
  }

  // zero-state: no fit persisted yet
  if (!profile || !read) {
    return (
      <div style={{ padding: '18px 0' }}>
        <div style={{ fontSize: 14, color: 'var(--text)', maxWidth: 520, lineHeight: 1.5 }}>
          Your capability profile is built from scored workouts — link your Open history or log
          scored metcons, then fit it here.
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            marginTop: 14, padding: '8px 16px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13,
            cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.7 : 1,
          }}
        >
          {refreshing ? 'Fitting…' : 'Build my profile'}
        </button>
        {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      </div>
    );
  }

  // elite-cohort fits carry the z-native dials; bars and numbers both use
  // that ruler (the pct conversion is compressed at elite levels — showing
  // it geometrically would undo the upgrade). One fit = one ruler, so the
  // mix is never per-dial.
  const isZ = read.dials.some((d) => d.relativeZ !== undefined);
  const relOf = (d: (typeof read.dials)[number]) => (isZ ? d.relativeZ ?? 0 : d.relative);
  const sdOf = (d: (typeof read.dials)[number]) => (isZ ? d.sdZ ?? 0 : d.sd);
  const maxAbs = Math.max(isZ ? 0.8 : 8, ...read.dials.map((d) => Math.abs(relOf(d)) + sdOf(d)));

  return (
    <div style={{ paddingTop: 4 }}>
      {/* ---- story ---- */}
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)', maxWidth: 640 }}>
        {read.story.map((s, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '8px 0 0' }}>{s}</p>
        ))}
      </div>

      {/* ---- the two cards ---- */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        {read.limiters.length > 0 && (
          <div style={{ flex: '1 1 240px', background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
            <SectionLabel>Likeliest limiters</SectionLabel>
            {read.limiters.map((l) => (
              <div key={l.axis} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                <span>{l.label}</span>
                <span style={{ color: 'var(--text-dim)' }}>{Math.min(95, Math.round(l.p * 100))}%</span>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
              Relative to your own level — a ranked read, not a verdict.
            </div>
          </div>
        )}
        {read.unknowns.length > 0 && (
          <div style={{ flex: '1 1 240px', background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
            <SectionLabel>What we can't see yet</SectionLabel>
            {read.unknowns.map((u) => (
              <div key={u.axis} style={{ fontSize: 13, padding: '3px 0' }}>
                <span>{u.label}</span>
                <span style={{ color: 'var(--text-dim)' }}> — {u.probe} would tell us</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- the twelve dials ---- */}
      <div style={{ marginTop: 22 }}>
        <SectionLabel>Your shape — each quality vs your own level</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {read.dials.map((d) => {
            const rel = relOf(d);
            const sd = sdOf(d);
            const center = 50; // % position of zero
            const scale = 50 / maxAbs; // % per unit (pct point, or σ on z fits)
            const left = center + Math.min(0, rel) * scale;
            const width = Math.abs(rel) * scale;
            const sdLeft = center + (rel - sd) * scale;
            const sdWidth = 2 * sd * scale;
            return (
              <div key={d.axis} title={d.definition}
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <div style={{ flex: '0 0 130px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.label}
                </div>
                <div style={{ flex: '1 1 120px', position: 'relative', height: 14 }}>
                  {/* zero line */}
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--text-dim)', opacity: 0.4 }} />
                  {/* uncertainty band */}
                  <div style={{
                    position: 'absolute', left: `${Math.max(0, sdLeft)}%`,
                    width: `${Math.min(100 - Math.max(0, sdLeft), sdWidth)}%`,
                    top: 4, height: 6, background: 'var(--surface2)', borderRadius: 3,
                  }} />
                  {/* the dial */}
                  <div style={{
                    position: 'absolute', left: `${left}%`, width: `${Math.max(width, 0.8)}%`,
                    top: 3, height: 8, borderRadius: 4,
                    // color is copy (review item 4): below-your-own-line is
                    // not danger — a neutral slate keeps red off this panel
                    background: rel >= 0 ? 'var(--accent)' : '#7a8699',
                    opacity: 0.4 + 0.6 * d.resolution,
                  }} />
                </div>
                <div style={{ flex: '0 0 52px', textAlign: 'right', color: 'var(--text)' }}>
                  {d.relativeZ !== undefined
                    // elite-cohort fit: the z-native dial, the un-compressed
                    // ruler (percentile points stop resolving above ~p95)
                    ? `${d.relativeZ >= 0 ? '+' : ''}${d.relativeZ.toFixed(2)}σ`
                    : `${d.relative >= 0 ? '+' : ''}${d.relative.toFixed(1)}`}
                </div>
                <div style={{ flex: '0 0 46px', textAlign: 'right', color: 'var(--text-dim)', fontSize: 12 }}>
                  ~p{Math.round(d.absolute)}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8 }}>
          Bars are relative to your own level (p{Math.round(profile.level.mean)}); the right column is
          the absolute read. Faded bars are less certain. A below-line quality can still be far above
          the field.
          {read.dials.some((d) => d.relativeZ !== undefined) &&
            ' At your level percentile points stop resolving differences, so dials are in σ — standard deviations of the field, the scale your profile was actually fitted on.'}
        </div>
      </div>

      {/* ---- concordance + refresh ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {!concordanceSent ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Does this match how you see yourself?
              {!canConcord && ' (refresh first so your answer attaches to this read)'}
            </span>
            {(['match', 'partial', 'miss'] as const).map((v) => (
              <button key={v}
                disabled={!canConcord}
                onClick={() => { if (v === 'match') void sendConcordance('match'); else setShowNote(true); }}
                data-verdict={v}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 12.5,
                  cursor: canConcord ? 'pointer' : 'not-allowed', opacity: canConcord ? 1 : 0.45,
                  border: '1px solid var(--surface2)', background: 'transparent', color: 'var(--text)',
                }}>
                {v === 'match' ? 'Yes' : v === 'partial' ? 'Partly' : 'No'}
              </button>
            ))}
          </>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Thanks — noted against this read.</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={refresh} disabled={refreshing}
          style={{
            padding: '5px 12px', borderRadius: 7, fontSize: 12.5,
            border: '1px solid var(--surface2)', background: 'transparent',
            color: 'var(--text-dim)', cursor: refreshing ? 'wait' : 'pointer',
          }}>
          {refreshing ? 'Refitting…' : 'Refresh from latest results'}
        </button>
      </div>
      {showNote && !concordanceSent && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, maxWidth: 520 }}>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What's off? (optional)"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 13,
              border: '1px solid var(--surface2)', background: 'var(--surface, transparent)', color: 'var(--text)',
            }} />
          <button
            onClick={() => void sendConcordance(note.trim() ? 'partial' : 'miss', note.trim() || undefined)}
            style={{
              padding: '7px 14px', borderRadius: 7, fontSize: 12.5, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
            }}>
            Send
          </button>
        </div>
      )}
      {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
