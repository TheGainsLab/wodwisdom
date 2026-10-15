import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  loadKnowledgeEntry, knowledgeIndexRow, topicLabel,
  type KnowledgeEntry, type KnowledgeChart,
} from '../lib/knowledgeLibrary';
import { QAHeader } from '../components/QAShared';
import { KnowledgeBadge, linkifyGlossary } from '../components/KnowledgeShared';
import '../features.css';
import '../qa.css';

const NOT_PRINTED = 'not printed in source';

const td: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid var(--border)',
  fontSize: 12.5, lineHeight: 1.45, verticalAlign: 'top', textAlign: 'left',
};
const th: React.CSSProperties = {
  ...td, fontWeight: 700, color: 'var(--text-dim)', fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', margin: '28px 0 10px' }}>
      {children}
    </h2>
  );
}

function FactsTable({ columns, rows }: { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, React.ReactNode>> }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 14 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={th}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={r.__muted ? { opacity: 0.55 } : undefined}>
              {columns.map((c) => <td key={c.key} style={td}>{r[c.key] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "approx." / "from Fig" values get a read-from-figure marker (honesty rule 3). */
function val(v: string | undefined): React.ReactNode {
  if (!v) return '';
  if (/approx\.|from fig/i.test(v)) {
    return <span>≈ {v.replace(/^approx\.\s*/i, '')}</span>;
  }
  return v;
}

// ── Layer-1 shape renderers ─────────────────────────────────────────────

function InterventionFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['intervention']> }) {
  return (
    <>
      <FactsTable
        columns={[
          { key: 'name', label: 'Group' }, { key: 'protocol', label: 'Protocol' },
          { key: 'per_week', label: 'Per week' }, { key: 'n', label: 'n' },
          { key: 'age', label: 'Age' }, { key: 'sex', label: 'Sex' },
          { key: 'training_status', label: 'Status' }, { key: 'other', label: 'Other' },
        ]}
        rows={l.groups.map((g) => ({
          name: g.name, protocol: g.protocol, per_week: g.per_week,
          n: g.n_enrolled === g.n_analysed ? g.n_enrolled : `${g.n_enrolled} enrolled / ${g.n_analysed} analysed`,
          age: g.age, sex: g.sex, training_status: g.training_status, other: g.other,
        }))}
      />
      {l.design_notes && <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 14px' }}>{l.design_notes}</p>}
      <FactsTable
        columns={[
          { key: 'outcome', label: 'Outcome' }, { key: 'unit', label: 'Unit' },
          { key: 'group', label: 'Group' }, { key: 'before', label: 'Before' },
          { key: 'after', label: 'After' }, { key: 'change', label: 'Change' },
          { key: 'significant', label: 'Significant' }, { key: 'note', label: 'Note' },
        ]}
        rows={l.measured.map((m) => ({
          outcome: m.outcome, unit: m.unit, group: m.group,
          before: val(m.before), after: val(m.after), change: val(m.change),
          significant: m.significant, note: m.note,
          __muted: m.significant === 'no',
        }))}
      />
    </>
  );
}

/**
 * FactsTable split on the `charted` flag: rows a chart already draws
 * collapse behind a disclosure instead of printing twice. The disclosure
 * sits where the charted rows sat (before the table when they led).
 */
function SplitFactsTable({ columns, rows, charted }: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, React.ReactNode>>;
  charted: boolean[];
}) {
  const shown = rows.filter((_, i) => !charted[i]);
  const hidden = rows.filter((_, i) => charted[i]);
  if (hidden.length === 0) return <FactsTable columns={columns} rows={rows} />;
  const disclosure = (
    <details style={{ margin: '0 0 14px' }}>
      <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
        {hidden.length === 1 ? '1 row' : `${hidden.length} rows`} drawn in the chart below — view as table
      </summary>
      <FactsTable columns={columns} rows={hidden} />
    </details>
  );
  const chartedFirst = charted[0] === true;
  return (
    <>
      {chartedFirst && disclosure}
      {shown.length > 0 && <FactsTable columns={columns} rows={shown} />}
      {!chartedFirst && disclosure}
    </>
  );
}

function ComparisonFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['comparison']> }) {
  const conditionKeys = Array.from(new Set(l.measured.flatMap((m) => Object.keys(m.values_by_condition))));
  return (
    <>
      <FactsTable
        columns={[
          { key: 'name', label: 'Who' }, { key: 'n', label: 'n' }, { key: 'age', label: 'Age' },
          { key: 'sex', label: 'Sex' }, { key: 'training_status', label: 'Status' }, { key: 'other', label: 'Other' },
        ]}
        rows={l.who.map((w) => ({ ...w }))}
      />
      <FactsTable
        columns={[
          { key: 'name', label: 'Condition' }, { key: 'description', label: 'Description' },
          { key: 'intensity', label: 'Intensity' }, { key: 'duration', label: 'Duration' }, { key: 'other', label: 'Other' },
        ]}
        rows={l.conditions.map((c) => ({ ...c }))}
      />
      {l.design_notes && <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 14px' }}>{l.design_notes}</p>}
      <SplitFactsTable
        columns={[
          { key: 'outcome', label: 'Outcome' }, { key: 'unit', label: 'Unit' },
          ...conditionKeys.map((k) => ({ key: `c_${k}`, label: k })),
          { key: 'differed', label: 'Differed' }, { key: 'note', label: 'Note' },
        ]}
        rows={l.measured.map((m) => ({
          outcome: m.outcome, unit: m.unit,
          ...Object.fromEntries(conditionKeys.map((k) => [`c_${k}`, val(m.values_by_condition[k])])),
          differed: m.differed, note: m.note,
        }))}
        charted={l.measured.map((m) => !!m.charted)}
      />
    </>
  );
}

function ReviewFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['review']> }) {
  return (
    <>
      <div style={{ padding: '12px 14px', borderLeft: '3px solid var(--accent)', background: 'var(--surface)', borderRadius: 8, fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>
        {l.claim}
      </div>
      {l.definitions_used.length > 0 && (
        <FactsTable
          columns={[{ key: 'term', label: 'Term' }, { key: 'definition', label: 'As the authors define it' }]}
          rows={l.definitions_used.map((d) => ({ ...d }))}
        />
      )}
      <SplitFactsTable
        columns={[
          { key: 'finding', label: 'Finding' }, { key: 'source', label: 'Source' },
          { key: 'numbers', label: 'Numbers' }, { key: 'note', label: 'Note' },
        ]}
        rows={l.evidence_cited.map((e) => ({ ...e, numbers: val(e.numbers) }))}
        charted={l.evidence_cited.map((e) => !!e.charted)}
      />
      {l.recommendations_made.length > 0 && (
        <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          {l.recommendations_made.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {l.untested_or_contested && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>Untested or contested: </strong>{l.untested_or_contested}
        </p>
      )}
    </>
  );
}

function ReferenceFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['reference']> }) {
  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 14px' }}>{l.what_it_explains}</p>
      <FactsTable
        columns={[{ key: 'quantity', label: 'Quantity' }, { key: 'value', label: 'Value' }, { key: 'note', label: 'Note' }]}
        rows={l.key_numbers.map((k) => ({ ...k, value: val(k.value) }))}
      />
      <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
        <strong style={{ color: 'var(--text)' }}>Scope limits: </strong>{l.scope_limits}
      </p>
    </>
  );
}

// ── Charts (v0: honest data tables; SVG templates arrive in the next PR) ──

function chartRows(c: KnowledgeChart): { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, React.ReactNode>> } {
  const s = c.series as Array<Record<string, any>>;
  switch (c.template) {
    case 'before_after_bars':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'before', label: 'Before' }, { key: 'after', label: 'After' }],
        rows: s.map((x) => ({ label: x.label, before: String(x.before), after: String(x.after) })),
      };
    case 'grouped_change_bars':
      return {
        columns: [{ key: 'group', label: 'Group' }, { key: 'values', label: 'Change' }],
        rows: s.map((x) => ({
          group: x.group,
          values: (x.values as Array<{ label: string; value: number }>)
            .map((v) => `${v.label}: ${v.value > 0 ? '+' : ''}${v.value}%`).join(' · '),
        })),
      };
    case 'values_by_condition':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'values', label: 'By condition' }],
        rows: s.map((x) => ({
          label: x.label,
          values: (x.values as Array<{ condition: string; value: number }>)
            .map((v) => `${v.condition}: ${v.value}`).join(' · '),
        })),
      };
    case 'stacked_share':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'parts', label: 'Share' }],
        rows: s.map((x) => ({
          label: x.label,
          parts: (x.parts as Array<{ name: string; value: number }>)
            .map((p) => `${p.name} ${p.value}%`).join(' · '),
        })),
      };
    case 'timeline':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'span', label: `Span (${c.units})` }, { key: 'note', label: 'Note' }],
        rows: s.map((x) => ({ label: x.label, span: `${x.start} → ${x.end}`, note: x.note ?? '' })),
      };
    case 'population_card':
      return {
        columns: [
          { key: 'n', label: 'n' }, { key: 'sex_split', label: 'Sex' },
          { key: 'age', label: 'Age' }, { key: 'status', label: 'Status' }, { key: 'other', label: 'Other' },
        ],
        rows: s.map((x) => ({ n: x.n, sex_split: x.sex_split, age: x.age, status: x.status, other: x.other })),
      };
    case 'concept_curve':
      // A schematic has no honest table form; the note carries the meaning.
      return { columns: [], rows: [] };
  }
}

// Categorical slots validated (dataviz six checks) against the site surface
// #111114: CVD ΔE 26.8, normal 31.8, all ≥3:1 contrast. Assignment is by
// first appearance in the chart's own data, never cycled.
const SHARE_SLOTS = ['#3987e5', '#d95926', '#199e70'];

/** stacked_share as horizontal 100%-stacked bars; null → caller falls back to the table. */
function renderStackedShare(c: KnowledgeChart): React.ReactNode | null {
  const series = c.series as Array<{ label: string; parts: Array<{ name: string; value: number }> }>;
  if (!series.length || series.some((r) => !Array.isArray(r.parts))) return null;
  const names: string[] = [];
  for (const row of series) {
    for (const p of row.parts) {
      if (!names.some((n) => n.toLowerCase() === p.name.toLowerCase())) names.push(p.name);
    }
  }
  if (names.length < 2 || names.length > SHARE_SLOTS.length) return null;
  const color = (name: string) => SHARE_SLOTS[names.findIndex((n) => n.toLowerCase() === name.toLowerCase())];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const suffix = c.units.trim().startsWith('%') ? '%' : '';
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
        {names.map((n) => (
          <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-dim)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color(n), flexShrink: 0 }} />
            {cap(n)}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {series.map((row) => {
          const total = row.parts.reduce((a, p) => a + p.value, 0) || 1;
          return (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 56, flexShrink: 0, fontSize: 11.5, color: 'var(--text-dim)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {row.label}
              </div>
              <div style={{ flex: 1, display: 'flex', gap: 2, height: 20 }}>
                {row.parts.map((p, i) => {
                  const pct = (p.value / total) * 100;
                  return (
                    <div
                      key={p.name}
                      title={`${cap(p.name)}: ${p.value}${suffix} (${row.label})`}
                      style={{
                        width: `${pct}%`, background: color(p.name), minWidth: 2,
                        borderRadius: i === 0 ? '4px 0 0 4px' : i === row.parts.length - 1 ? '0 4px 4px 0' : 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {pct >= 12 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#111114', whiteSpace: 'nowrap' }}>
                          {p.value}{suffix}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartBlock({ c }: { c: KnowledgeChart }) {
  const { columns, rows } = chartRows(c);
  const drawn = c.template === 'stacked_share' ? renderStackedShare(c) : null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 12, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>
        {c.title}{c.units ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {c.units}</span> : null}
      </div>
      {drawn}
      {drawn && columns.length > 0 && (
        <details style={{ margin: '0 0 6px' }}>
          <summary style={{ fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>View as table</summary>
          <FactsTable columns={columns} rows={rows} />
        </details>
      )}
      {!drawn && columns.length > 0 && <FactsTable columns={columns} rows={rows} />}
      {c.approximate && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>
          approximate — values read from a figure
        </div>
      )}
      {c.note && <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{c.note}</div>}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────

export default function KnowledgeEntryPage({ signedIn = false }: { signedIn?: boolean }) {
  const { slug } = useParams<{ slug: string }>();
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntry(null); setMissing(false);
    if (!slug) { setMissing(true); return; }
    loadKnowledgeEntry(slug).then((e) => {
      if (cancelled) return;
      if (e) setEntry(e); else setMissing(true);
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    document.body.classList.add('feature-body');
    if (entry) document.title = `${entry.header.title_plain} | The Gains Lab`;
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, [entry]);

  if (missing) {
    return (
      <div className="feature-page">
        <QAHeader signedIn={signedIn} />
        <div className="qa-entry-container" style={{ paddingTop: 36 }}>
          <p style={{ color: 'var(--text-dim)' }}>That entry doesn&apos;t exist.</p>
          <Link to="/knowledge" style={{ color: 'var(--accent)' }}>Back to the library</Link>
        </div>
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="feature-page">
        <QAHeader signedIn={signedIn} />
        <div className="qa-entry-container" style={{ paddingTop: 36, color: 'var(--text-dim)', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  const h = entry.header;
  const cite = h.citation;
  const idx = knowledgeIndexRow(entry.slug);
  const showStance = h.author_stance && !/^none apparent/i.test(h.author_stance);

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <div className="qa-entry-container" style={{ paddingTop: 36, paddingBottom: 60 }}>
        <Link to="/knowledge" className="feature-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Research Library
        </Link>

        <h1 style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.3, margin: '12px 0 10px' }}>{h.title_plain}</h1>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
          {cite.authors !== NOT_PRINTED && <>{cite.authors} </>}
          {cite.year !== NOT_PRINTED && <>({cite.year}). </>}
          {!!cite.title && cite.title !== NOT_PRINTED && <>&ldquo;{cite.title}.&rdquo; </>}
          {cite.journal !== NOT_PRINTED && <>{cite.journal} </>}
          {cite.volume_issue_pages !== NOT_PRINTED && <>{cite.volume_issue_pages}. </>}
          {cite.doi !== NOT_PRINTED && (
            <a href={`https://doi.org/${cite.doi}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              doi:{cite.doi}
            </a>
          )}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <KnowledgeBadge kind="shape" value={entry.shape} />
          <KnowledgeBadge kind="confidence" value={h.confidence.level} why={h.confidence.why} />
          <KnowledgeBadge kind="relevance" value={h.practical_relevance.level} why={h.practical_relevance.why} />
        </div>

        <SectionTitle>What kind of evidence this is</SectionTitle>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 10px' }}>
          {linkifyGlossary(h.evidence_type)}
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: '0 0 6px' }}>
          <strong style={{ color: 'var(--text)' }}>Confidence: {h.confidence.level}</strong>
          {h.confidence.why && <> — {h.confidence.why}</>}
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>Relevance: {h.practical_relevance.level}</strong>
          {h.practical_relevance.why && <> — {h.practical_relevance.why}</>}
        </p>
        {showStance && (
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: '6px 0 0' }}>
            <strong style={{ color: 'var(--text)' }}>Author stance</strong> — {h.author_stance}
          </p>
        )}
        {h.funding_and_conflicts && (
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: '6px 0 0' }}>
            <strong style={{ color: 'var(--text)' }}>Funding &amp; conflicts</strong> — {h.funding_and_conflicts}
          </p>
        )}

        <SectionTitle>The facts</SectionTitle>
        {entry.layer1.intervention && <InterventionFacts l={entry.layer1.intervention} />}
        {entry.layer1.comparison && <ComparisonFacts l={entry.layer1.comparison} />}
        {entry.layer1.review && <ReviewFacts l={entry.layer1.review} />}
        {entry.layer1.reference && <ReferenceFacts l={entry.layer1.reference} />}

        {entry.charts.length > 0 && (
          <>
            <SectionTitle>At a glance</SectionTitle>
            {entry.charts.map((c, i) => <ChartBlock key={i} c={c} />)}
          </>
        )}

        <SectionTitle>What it means</SectionTitle>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)', margin: 0 }}>
          {linkifyGlossary(entry.layer2.what_it_means)}
        </p>

        <SectionTitle>What it doesn&apos;t mean</SectionTitle>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)', margin: 0 }}>
          {linkifyGlossary(entry.layer2.what_it_doesnt_mean)}
        </p>

        {entry.translation.length > 0 && (
          <>
            <SectionTitle>Say it to a member</SectionTitle>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entry.translation.map((t, i) => (
                <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                  {linkifyGlossary(t)}
                </li>
              ))}
            </ul>
          </>
        )}

        {idx && idx.topics.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 24 }}>
            {idx.topics.map((t) => (
              <span key={t} style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11.5, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {topicLabel(t)}
              </span>
            ))}
          </div>
        )}

        {/* Discuss this paper — the one gated action. Chat ships later; the
            button exists from day one as the demand signal (design handoff),
            and the sub-line keeps the promise honest. */}
        <div style={{ marginTop: 28, padding: '16px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--surface)' }}>
          <Link
            to={signedIn ? '/knowledge' : `/auth?signup=1&next=/knowledge/${entry.slug}`}
            className="feature-cta"
            style={{ display: 'inline-block' }}
          >
            Discuss this paper with the AI Coach
          </Link>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '10px 0 0', lineHeight: 1.5 }}>
            {signedIn
              ? 'Research chat is coming soon — you’ll be able to ask this paper questions right here.'
              : 'Research chat is coming. Create a free account and you’re on the list — we’ll email you when your papers can talk back.'}
          </p>
        </div>
      </div>
    </div>
  );
}
