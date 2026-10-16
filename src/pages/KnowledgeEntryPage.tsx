import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  loadKnowledgeEntry, ensureGlossary, topicLabel,
  type KnowledgeEntry, type KnowledgeChart,
} from '../lib/knowledgeLibrary';
import { QAHeader } from '../components/QAShared';
import { KnowledgeBadge, linkifyGlossary } from '../components/KnowledgeShared';
import '../features.css';
import '../qa.css';
import { logKnowledgeEvent } from '../lib/knowledgeEvents';

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
  // Glossary terms link once per table (the table is the "section");
  // definitions expand inline so the scroll container can't clip them.
  const seen = new Set<string>();
  const cell = (v: React.ReactNode) => (typeof v === 'string' ? linkifyGlossary(v, { inline: true, seen }) : v ?? '');
  return (
    <div style={{ overflowX: 'auto', marginBottom: 14 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={th}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={r.__muted ? { opacity: 0.55 } : undefined}>
              {columns.map((c) => <td key={c.key} style={td}>{cell(r[c.key])}</td>)}
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

// ── Setup narrative (the "what this is" lede for study shapes) ─────────
//
// Who was studied and what they did reads as prose, not a table — the
// fields are descriptions, and a one-row table of sentences is noise.
// Assembled verbatim from the entry's own fields; nothing is written.

function usable(v?: string): boolean {
  return !!v && !/^n\/a/i.test(v.trim()) && !/^not stated/i.test(v.trim());
}

export function setupNarrative(entry: KnowledgeEntry): string[] {
  const out: string[] = [];
  const iv = entry.layer1.intervention;
  const cp = entry.layer1.comparison;
  if (iv) {
    for (const g of iv.groups) {
      const n = g.n_enrolled === g.n_analysed ? `n ${g.n_enrolled}` : `${g.n_enrolled} enrolled / ${g.n_analysed} analysed`;
      const demo = [usable(g.age) && `age ${g.age}`, usable(g.sex) && g.sex, usable(g.training_status) && g.training_status]
        .filter(Boolean).join(', ');
      const bits = [[n, demo].filter(Boolean).join(', '), g.protocol, g.per_week, g.other]
        .filter((s) => usable(s as string));
      out.push(`${g.name} — ${bits.join('. ').replace(/\.\./g, '.')}.`);
    }
    if (iv.design_notes) out.push(iv.design_notes);
  }
  if (cp) {
    for (const w of cp.who) {
      const demo = [usable(w.n) && `n ${w.n}`, usable(w.age) && `age ${w.age}`, usable(w.sex) && w.sex, usable(w.training_status) && w.training_status]
        .filter(Boolean).join(', ');
      const bits = [demo, w.other].filter((s) => usable(s as string));
      out.push(`${w.name} — ${bits.join('. ').replace(/\.\./g, '.')}.`);
    }
    for (const c of cp.conditions) {
      const bits = [c.description, [usable(c.intensity) && c.intensity, usable(c.duration) && c.duration].filter(Boolean).join(', '), c.other]
        .filter((s) => usable(s as string));
      out.push(`${c.name} — ${bits.join('. ').replace(/\.\./g, '.')}.`);
    }
    if (cp.design_notes) out.push(cp.design_notes);
  }
  return out;
}

function InterventionFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['intervention']> }) {
  // Groups and design notes render as the page's setup narrative, not here.
  return (
    <>
      <SplitFactsTable
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
        charted={l.measured.map((m) => !!m.charted)}
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
  // Who, conditions and design notes render as the page's setup narrative.
  return (
    <>
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
  // The claim renders at the top of the page, not here.
  return (
    <>
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
      {/* untested_or_contested renders in About this paper, not here. */}
    </>
  );
}

function ReferenceFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['reference']> }) {
  // what_it_explains renders at the top of the page, not here.
  return (
    <>
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
  const s = (c.series ?? []) as Array<Record<string, any>>;
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
  const series = (c.series ?? []) as Array<{ label: string; parts: Array<{ name: string; value: number }> }>;
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

// Two shades of one hue for before→after (palette ramp steps on the dark surface).
const BEFORE_HUE = '#86b6ef';
const AFTER_HUE = '#3987e5';

/** before_after_bars: paired horizontal bars per item; null → table fallback. */
function renderBeforeAfterBars(c: KnowledgeChart): React.ReactNode | null {
  const series = (c.series ?? []) as Array<{ label: string; before: number; after: number }>;
  if (!series.length || series.some((r) => typeof r.before !== 'number' || typeof r.after !== 'number')) return null;
  // "mixed" units (e.g. m, s, kg in one chart) can't share a scale: each row
  // scales to itself and only the within-pair change is comparable.
  const mixed = c.units.trim().toLowerCase().startsWith('mixed');
  const sharedMax = Math.max(...series.flatMap((r) => [r.before, r.after]));
  const fmt = (v: number) => String(v);
  const bar = (v: number, max: number, color: string, cap: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 40, flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'right' }}>{cap}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: `${Math.max((v / max) * 86, 0.5)}%`, minWidth: 2, height: 14, background: color, borderRadius: '0 4px 4px 0' }} />
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{fmt(v)}</span>
      </div>
    </div>
  );
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
        {[['Before', BEFORE_HUE], ['After', AFTER_HUE]].map(([n, col]) => (
          <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-dim)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: col, flexShrink: 0 }} />{n}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {series.map((r) => {
          const max = mixed ? Math.max(r.before, r.after) : sharedMax;
          return (
            <div key={r.label}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{r.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {bar(r.before, max, BEFORE_HUE, 'before')}
                {bar(r.after, max, AFTER_HUE, 'after')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** grouped_change_bars: signed change bars per outcome, one color per group. */
function renderGroupedChangeBars(c: KnowledgeChart): React.ReactNode | null {
  const series = (c.series ?? []) as Array<{ group: string; values: Array<{ label: string; value: number | null }> }>;
  if (!series.length || series.length > SHARE_SLOTS.length) return null;
  if (series.some((s) => !Array.isArray(s.values))) return null;
  const outcomes: string[] = [];
  for (const s of series) for (const v of s.values) if (!outcomes.includes(v.label)) outcomes.push(v.label);
  const all = series.flatMap((s) => s.values.map((v) => v.value)).filter((v): v is number => typeof v === 'number');
  if (!all.length) return null;
  const minV = Math.min(0, ...all);
  const maxV = Math.max(0, ...all);
  const span = maxV - minV || 1;
  const pct = (v: number) => ((v - minV) / span) * 86; // leave room for tip labels
  const zero = pct(0);
  const suffix = c.units.includes('%') ? '%' : '';
  const color = (g: string) => SHARE_SLOTS[series.findIndex((s) => s.group === g)];
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
        {series.map((s) => (
          <span key={s.group} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-dim)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color(s.group), flexShrink: 0 }} />{s.group}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {outcomes.map((o) => (
          <div key={o}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{o}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {series.map((s) => {
                const v = s.values.find((x) => x.label === o)?.value;
                if (v === undefined) return null;
                if (v === null) {
                  return (
                    <div key={s.group} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 14 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: color(s.group), flexShrink: 0, opacity: 0.5 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>not reported</span>
                    </div>
                  );
                }
                const left = Math.min(zero, pct(v));
                const width = Math.abs(pct(v) - zero);
                return (
                  <div key={s.group} style={{ position: 'relative', height: 14 }}>
                    {minV < 0 && (
                      <div style={{ position: 'absolute', left: `${zero}%`, top: -1, bottom: -1, width: 1, background: 'var(--border)' }} />
                    )}
                    <div style={{
                      position: 'absolute', left: `${left}%`, width: `${Math.max(width, 0.4)}%`, minWidth: 2, top: 1, height: 12,
                      background: color(s.group),
                      borderRadius: v >= 0 ? '0 4px 4px 0' : '4px 0 0 4px',
                    }} />
                    <span style={{
                      position: 'absolute', top: 0, fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap',
                      ...(v >= 0
                        ? { left: `${zero + width}%`, paddingLeft: 6 }
                        : { right: `${100 - left}%`, paddingRight: 6 }),
                    }}>
                      {v > 0 ? '+' : ''}{v}{suffix}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartBlock({ c }: { c: KnowledgeChart }) {
  const { columns, rows } = chartRows(c);
  const drawn =
    c.template === 'stacked_share' ? renderStackedShare(c)
    : c.template === 'before_after_bars' ? renderBeforeAfterBars(c)
    : c.template === 'grouped_change_bars' ? renderGroupedChangeBars(c)
    : null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 12, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>
        {c.title}{c.units ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {c.units}</span> : null}
      </div>
      {drawn}
      {drawn && columns.length > 0 && (
        <details style={{ margin: '0 0 6px' }} onToggle={(e) => (e.target as HTMLDetailsElement).open && logKnowledgeEvent('chart_table_view', undefined, { chart: c.title })}>
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
    // Glossary loads alongside the entry so tap-to-define terms are linkable
    // on first paint.
    Promise.all([loadKnowledgeEntry(slug), ensureGlossary()]).then(([e]) => {
      if (cancelled) return;
      if (e) { setEntry(e); logKnowledgeEvent('entry_view', slug); } else setMissing(true);
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
        <KnowledgeEntryView entry={entry} signedIn={signedIn} />
      </div>
    </div>
  );
}

/** The full article body — shared by the public page and the admin review screen. */
export function KnowledgeEntryView({ entry, signedIn = false }: { entry: KnowledgeEntry; signedIn?: boolean }) {
  const h = entry.header;
  const cite = h.citation;
  const showStance = h.author_stance && !/^none apparent/i.test(h.author_stance);

  return (
    <>
        {/* Receipt first, eyes on the finding: paper title (modest) → byline →
            headline (the visual lead) → the argument, then the trust section. */}
        {!!cite.title && cite.title !== NOT_PRINTED && (
          <div style={{ fontSize: 16, fontWeight: 650, lineHeight: 1.4, margin: '14px 0 3px', color: 'var(--text)' }}>
            {cite.title}
          </div>
        )}
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          {cite.authors !== NOT_PRINTED && <>{cite.authors}</>}
          {cite.year !== NOT_PRINTED && <> · {cite.year}</>}
          {cite.journal !== NOT_PRINTED && <> · {cite.journal}</>}
          {cite.volume_issue_pages !== NOT_PRINTED && <> {cite.volume_issue_pages}</>}
          {cite.doi !== NOT_PRINTED && (
            <>
              {' · '}
              <a href={`https://doi.org/${cite.doi}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                doi:{cite.doi}
              </a>
            </>
          )}
        </p>

        <h1 style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.3, margin: '0 0 12px' }}>{h.title_plain}</h1>

        {/* The lede — every shape gets one, same slot, same style:
            reviews state the authors' claim, references what the source
            explains, studies who was studied and what they did. */}
        {(() => {
          const paras = entry.layer1.review?.claim ? [entry.layer1.review.claim]
            : entry.layer1.reference?.what_it_explains ? [entry.layer1.reference.what_it_explains]
            : h.setup_plain ? [h.setup_plain]
            : setupNarrative(entry);
          if (!paras.length) return null;
          return (
            <div style={{ padding: '12px 14px', borderLeft: '3px solid var(--accent)', background: 'var(--surface)', borderRadius: 8, marginBottom: 14 }}>
              {paras.map((p, i) => (
                <p key={i} style={{ fontSize: 13.5, lineHeight: 1.6, margin: i === paras.length - 1 ? 0 : '0 0 8px' }}>{p}</p>
              ))}
            </div>
          );
        })()}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <KnowledgeBadge kind="shape" value={entry.shape} />
          <KnowledgeBadge kind="confidence" value={h.confidence.level} why={h.confidence.why} />
          <KnowledgeBadge kind="relevance" value={h.practical_relevance.level} why={h.practical_relevance.why} />
        </div>

        {/* One results section for every shape: charts lead, receipts
            follow. population_card no longer renders — the setup lede
            carries who was studied; the data stays in the entry. */}
        {/* Fixed format, every entry: key-finding bullets → one chart →
            everything else behind All the data. Entries without
            key_findings fall back to the full layout until populated. */}
        <SectionTitle>What they found</SectionTitle>
        {(() => {
          const charts = entry.charts.filter((c) => c.template !== 'population_card');
          const facts = (
            <>
              {entry.layer1.intervention && <InterventionFacts l={entry.layer1.intervention} />}
              {entry.layer1.comparison && <ComparisonFacts l={entry.layer1.comparison} />}
              {entry.layer1.review && <ReviewFacts l={entry.layer1.review} />}
              {entry.layer1.reference && <ReferenceFacts l={entry.layer1.reference} />}
            </>
          );
          if (!entry.key_findings?.length) {
            return <>{charts.map((c, i) => <ChartBlock key={i} c={c} />)}{facts}</>;
          }
          return (
            <>
              <ul style={{ margin: '0 0 16px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {entry.key_findings.map((f, i) => (
                  <li key={i} style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text)' }}>
                    {linkifyGlossary(f)}
                  </li>
                ))}
              </ul>
              {charts.length > 0 && <ChartBlock c={charts[0]} />}
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  All the data — every number from the paper
                </summary>
                <div style={{ marginTop: 12 }}>
                  {charts.slice(1).map((c, i) => <ChartBlock key={i} c={c} />)}
                  {facts}
                </div>
              </details>
            </>
          );
        })()}

        <SectionTitle>What it means</SectionTitle>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)', margin: 0 }}>
          {linkifyGlossary(entry.layer2.what_it_means)}
        </p>

        <SectionTitle>What it doesn&apos;t mean</SectionTitle>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)', margin: 0 }}>
          {linkifyGlossary(entry.layer2.what_it_doesnt_mean)}
        </p>

        {/* Always rendered — the spine is identical on every page. A paper
            with no gym-floor line says so instead of hiding the section. */}
        <SectionTitle>Say it to a member</SectionTitle>
        {entry.translation.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entry.translation.map((t, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                {linkifyGlossary(t)}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
            Nothing to repeat on the gym floor — this one is background that makes the other papers make sense.
          </p>
        )}

        {/* The trust block in full: badges in the header give the glance,
            this section gives the depth, out of the reading flow. */}
        <SectionTitle>About this paper</SectionTitle>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 10px' }}>
          {linkifyGlossary(h.evidence_type)}
        </p>
        {(entry.layer1.intervention || entry.layer1.comparison) && setupNarrative(entry).map((p, i) => (
          <p key={i} style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 8px' }}>{p}</p>
        ))}
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: '0 0 6px' }}>
          <strong style={{ color: 'var(--text)' }}>Confidence: {h.confidence.level}</strong>
          {h.confidence.why && <> — {h.confidence.why}</>}
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>Relevance: {h.practical_relevance.level}</strong>
          {h.practical_relevance.why && <> — {h.practical_relevance.why}</>}
        </p>
        {entry.layer1.review?.untested_or_contested && (
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: '6px 0 0' }}>
            <strong style={{ color: 'var(--text)' }}>Untested or contested</strong> — {entry.layer1.review.untested_or_contested}
          </p>
        )}
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

        {h.topics.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 24 }}>
            {h.topics.map((t) => (
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
            onClick={() => logKnowledgeEvent('discuss_click', entry.slug, { signedIn })}
          >
            Discuss this paper with the AI Coach
          </Link>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '10px 0 0', lineHeight: 1.5 }}>
            {signedIn
              ? 'Research chat is coming soon — you’ll be able to ask this paper questions right here.'
              : 'Research chat is coming. Create a free account and you’re on the list — we’ll email you when your papers can talk back.'}
          </p>
        </div>
    </>
  );
}
