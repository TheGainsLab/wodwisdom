import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  loadKnowledgeEntry, ensureGlossary,
  type KnowledgeEntry, type KnowledgeChart,
} from '../lib/knowledgeLibrary';
import { QAHeader } from '../components/QAShared';
import { KnowledgeBadge, linkifyGlossary } from '../components/KnowledgeShared';
import KnowledgeDiscuss from '../components/KnowledgeDiscuss';
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
  // A header row over zero rows is furniture, not information — a draft
  // with an empty (or foreign) section renders nothing here.
  if (rows.length === 0) return null;
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
function val(v: string | number | undefined): React.ReactNode {
  if (v === undefined || v === null || v === '') return '';
  v = String(v);
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
    for (const g of iv.groups ?? []) {
      const n = !usable(g.n_enrolled) ? ''
        : g.n_enrolled === g.n_analysed ? `n ${g.n_enrolled}`
        : `${g.n_enrolled} enrolled / ${g.n_analysed} analysed`;
      const demo = [usable(g.age) && `age ${g.age}`, usable(g.sex) && g.sex, usable(g.training_status) && g.training_status]
        .filter(Boolean).join(', ');
      // per_week is a bare count in most entries ("3"); spelled out so the
      // narrative doesn't read "…over 2 weeks. 3. Weight 78 kg".
      const perWeek = usable(g.per_week) && /^\d+(\.\d+)?$/.test(g.per_week.trim())
        ? `${g.per_week.trim()} sessions/week` : g.per_week;
      const bits = [[n, demo].filter(Boolean).join(', '), g.protocol, perWeek, g.other]
        .filter((s) => usable(s as string));
      out.push(`${g.name} — ${bits.join('. ').replace(/\.\./g, '.')}.`);
    }
    if (iv.design_notes) out.push(iv.design_notes);
  }
  if (cp) {
    for (const w of cp.who ?? []) {
      const demo = [usable(w.n) && `n ${w.n}`, usable(w.age) && `age ${w.age}`, usable(w.sex) && w.sex, usable(w.training_status) && w.training_status]
        .filter(Boolean).join(', ');
      const bits = [demo, w.other].filter((s) => usable(s as string));
      out.push(`${w.name} — ${bits.join('. ').replace(/\.\./g, '.')}.`);
    }
    for (const c of cp.conditions ?? []) {
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
        rows={(l.measured ?? []).map((m) => ({
          outcome: m.outcome, unit: m.unit, group: m.group,
          before: val(m.before), after: val(m.after), change: val(m.change),
          significant: m.significant, note: m.note,
          __muted: m.significant === 'no',
        }))}
        charted={(l.measured ?? []).map((m) => !!m.charted)}
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
        {hidden.length === 1 ? '1 row' : `${hidden.length} rows`} already drawn in the charts above — view as table
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
  // Who, conditions and design notes render as the page's setup narrative.
  // Rows group by the condition set they actually use — one compact table
  // per set, in order of first appearance. A union of every condition
  // across all rows renders as a sparse grid of mostly empty cells the
  // moment a paper mixes test conditions with subgroups or correlations.
  const measured = l.measured ?? [];
  const sig = (m: (typeof measured)[number]) => Object.keys(m.values_by_condition ?? {}).sort().join('\u0000');
  const groups: Array<{ keys: string[]; rows: typeof measured }> = [];
  for (const m of measured) {
    const g = groups.find((x) => [...x.keys].sort().join('\u0000') === sig(m));
    if (g) g.rows.push(m);
    else groups.push({ keys: Object.keys(m.values_by_condition ?? {}), rows: [m] });
  }
  return (
    <>
      {groups.map((g, gi) => (
        <SplitFactsTable
          key={gi}
          columns={[
            { key: 'outcome', label: 'Outcome' }, { key: 'unit', label: 'Unit' },
            ...g.keys.map((k) => ({ key: `c_${k}`, label: k })),
            { key: 'differed', label: 'Differed' }, { key: 'note', label: 'Note' },
          ]}
          rows={g.rows.map((m) => ({
            outcome: m.outcome, unit: m.unit,
            ...Object.fromEntries(g.keys.map((k) => [`c_${k}`, val(m.values_by_condition[k])])),
            differed: m.differed, note: m.note,
          }))}
          charted={g.rows.map((m) => !!m.charted)}
        />
      ))}
    </>
  );
}

function ReviewFacts({ l }: { l: NonNullable<KnowledgeEntry['layer1']['review']> }) {
  // The claim renders at the top of the page, not here.
  return (
    <>
      {(l.definitions_used ?? []).length > 0 && (
        <FactsTable
          columns={[{ key: 'term', label: 'Term' }, { key: 'definition', label: 'As the authors define it' }]}
          rows={(l.definitions_used ?? []).map((d) => ({ ...d }))}
        />
      )}
      <SplitFactsTable
        columns={[
          { key: 'finding', label: 'Finding' }, { key: 'source', label: 'Source' },
          { key: 'numbers', label: 'Numbers' }, { key: 'note', label: 'Note' },
        ]}
        rows={(l.evidence_cited ?? []).map((e) => ({ ...e, numbers: val(e.numbers) }))}
        charted={(l.evidence_cited ?? []).map((e) => !!e.charted)}
      />
      {(l.recommendations_made ?? []).length > 0 && (
        <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          {(l.recommendations_made ?? []).map((r, i) => <li key={i}>{r}</li>)}
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
        rows={(l.key_numbers ?? []).map((k) => ({ ...k, value: val(k.value) }))}
      />
      {!!l.scope_limits && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>Scope limits: </strong>{l.scope_limits}
        </p>
      )}
    </>
  );
}

// ── Charts (v0: honest data tables; SVG templates arrive in the next PR) ──

/**
 * grouped_change_bars series in canonical form. Drafts made before the
 * per-template shape contract emitted flat `{label, value}` items for
 * single-group studies; that shape is unambiguous, so it's adapted into
 * one unnamed group instead of rendering an empty chart.
 */
function groupedChangeSeries(c: KnowledgeChart): Array<{ group: string; values: Array<{ label: string; value: number | null }> }> {
  const raw = (c.series ?? []) as Array<Record<string, any>>;
  const flat = raw.length > 0 && raw.every((s) => s && typeof s === 'object' && typeof s.label === 'string' && !('values' in s) && 'value' in s);
  const nested = flat ? [{ group: '', values: raw }] : raw;
  return (nested as Array<{ group: string; values: Array<{ label: string; value: number | null }> }>)
    .filter((s) => !!s && typeof s.group === 'string' && Array.isArray(s.values))
    .map((s) => ({ ...s, values: s.values.filter((v) => !!v && typeof v.label === 'string') }));
}

function chartRows(c: KnowledgeChart): { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, React.ReactNode>> } {
  const s = (c.series ?? []) as Array<Record<string, any>>;
  switch (c.template) {
    case 'before_after_bars':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'before', label: 'Before' }, { key: 'after', label: 'After' }],
        rows: s.map((x) => ({
          label: x.label,
          before: x.before === undefined || x.before === null || x.before === '' ? 'not reported' : String(x.before),
          after: x.after === undefined || x.after === null || x.after === '' ? 'not reported' : String(x.after),
        })),
      };
    case 'grouped_change_bars':
      return {
        columns: [{ key: 'group', label: 'Group' }, { key: 'values', label: 'Change' }],
        rows: groupedChangeSeries(c).map((x) => ({
          group: x.group || '—',
          values: x.values
            .map((v) => {
              if (v.value === null) return `${v.label}: not reported`;
              const plus = (c.units.includes('%') || c.units.toLowerCase().includes('change')) && typeof v.value === 'number' && v.value > 0 ? '+' : '';
              return `${v.label}: ${plus}${v.value}${c.units.includes('%') ? '%' : ''}`;
            }).join(' · '),
        })),
      };
    case 'values_by_condition':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'values', label: 'By condition' }],
        rows: s.map((x) => ({
          label: x.label,
          values: ((x.values ?? []) as Array<{ condition: string; value: number }>).filter(Boolean)
            .map((v) => `${v.condition}: ${v.value}`).join(' · '),
        })),
      };
    case 'stacked_share':
      return {
        columns: [{ key: 'label', label: '' }, { key: 'parts', label: 'Share' }],
        rows: s.map((x) => ({
          label: x.label,
          parts: ((x.parts ?? []) as Array<{ name: string; value: number }>).filter(Boolean)
            .map((p) => `${p.name} ${p.value}%`).join(' · '),
        })),
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
    default:
      // Unknown template (deviant draft): render nothing rather than crash;
      // the validator report names the problem.
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
  const series = groupedChangeSeries(c);
  if (!series.length || series.length > SHARE_SLOTS.length) return null;
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
  // "+186 minutes" misreads an absolute value as a gain: the + prefix only
  // belongs on values whose units declare them changes.
  const signed = c.units.includes('%') || c.units.toLowerCase().includes('change');
  const color = (g: string) => SHARE_SLOTS[series.findIndex((s) => s.group === g)];
  return (
    <div style={{ margin: '2px 0 10px' }}>
      {series.some((s) => s.group) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
          {series.map((s) => (
            <span key={s.group} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-dim)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: color(s.group), flexShrink: 0 }} />{s.group}
            </span>
          ))}
        </div>
      )}
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
                      {signed && v > 0 ? '+' : ''}{v}{suffix}
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

/** values_by_condition: grouped bars per outcome, one color per condition. */
function renderValuesByCondition(c: KnowledgeChart): React.ReactNode | null {
  const series = ((c.series ?? []) as Array<{ label: string; values: Array<{ condition: string; value: number | null }> }>)
    .filter((s) => !!s && typeof s.label === 'string' && Array.isArray(s.values))
    .map((s) => ({ ...s, values: s.values.filter((v) => !!v && typeof v.condition === 'string') }));
  if (!series.length) return null;
  // Conditions take colors by first appearance in the data, never cycled.
  const conditions: string[] = [];
  for (const s of series) for (const v of s.values) if (!conditions.includes(v.condition)) conditions.push(v.condition);
  if (conditions.length < 2 || conditions.length > SHARE_SLOTS.length) return null;
  const nums = series.flatMap((s) => s.values.map((v) => v.value)).filter((v): v is number => typeof v === 'number');
  // Bars grow from zero, so negative values fall back to the honest table.
  if (!nums.length || nums.some((v) => v < 0) || Math.max(...nums) <= 0) return null;
  const mixed = c.units.trim().toLowerCase().startsWith('mixed');
  const sharedMax = Math.max(...nums);
  const color = (cond: string) => SHARE_SLOTS[conditions.indexOf(cond)];
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
        {conditions.map((cond) => (
          <span key={cond} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-dim)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color(cond), flexShrink: 0 }} />{cond}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {series.map((s) => {
          // "mixed" units can't share a scale: each outcome scales to itself
          // and only the within-outcome comparison is meaningful.
          const rowNums = s.values.map((v) => v.value).filter((v): v is number => typeof v === 'number');
          const max = (mixed ? Math.max(...rowNums, 0) : sharedMax) || 1;
          return (
            <div key={s.label}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {conditions.map((cond) => {
                  const v = s.values.find((x) => x.condition === cond)?.value;
                  if (v === undefined) return null;
                  if (v === null) {
                    return (
                      <div key={cond} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 14 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: color(cond), flexShrink: 0, opacity: 0.5 }} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>not reported</span>
                      </div>
                    );
                  }
                  return (
                    <div key={cond} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 14 }}>
                      <div style={{
                        width: `${Math.max((v / max) * 86, 0.5)}%`, minWidth: 2, height: 12,
                        background: color(cond), borderRadius: '0 4px 4px 0', flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{v}</span>
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
  // A row where every cell is blank carries no information — a mis-shaped
  // series must not render as a skeleton of empty lines.
  const liveRows = rows.filter((r) =>
    columns.some(({ key }) => {
      const v = r[key];
      return typeof v === 'string' ? v.trim() !== '' && v !== 'undefined' : v !== undefined && v !== null;
    }),
  );
  // The chart generates from the data: the declared template gets first try,
  // but when it can't draw this series (or names no drawable form), whichever
  // drawable form the series' own keys satisfy draws it instead. Each
  // renderer validates the data it needs and returns null otherwise, so a
  // wrong guess is impossible — only key-complete data draws.
  const byTemplate =
    c.template === 'stacked_share' ? renderStackedShare(c)
    : c.template === 'before_after_bars' ? renderBeforeAfterBars(c)
    : c.template === 'grouped_change_bars' ? renderGroupedChangeBars(c)
    : c.template === 'values_by_condition' ? renderValuesByCondition(c)
    : null;
  const drawn = byTemplate
    ?? (c.template !== 'population_card' && c.template !== 'concept_curve'
      ? renderBeforeAfterBars(c) ?? renderStackedShare(c) ?? renderValuesByCondition(c) ?? renderGroupedChangeBars(c)
      : null);
  // An empty or broken chart helps no reader: nothing drawable and no table
  // rows means the block doesn't render at all. (concept_curve is note-only
  // by design.) The validator stops such charts at ingest; this covers
  // drafts made before it existed.
  if (!drawn && liveRows.length === 0 && c.template !== 'concept_curve') return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 12, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>
        {c.title}{c.units ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {c.units}</span> : null}
      </div>
      {drawn}
      {drawn && columns.length > 0 && liveRows.length > 0 && (
        <details style={{ margin: '0 0 6px' }} onToggle={(e) => (e.target as HTMLDetailsElement).open && logKnowledgeEvent('chart_table_view', undefined, { chart: c.title })}>
          <summary style={{ fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>View as table</summary>
          <FactsTable columns={columns} rows={liveRows} />
        </details>
      )}
      {!drawn && columns.length > 0 && liveRows.length > 0 && <FactsTable columns={columns} rows={liveRows} />}
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
  const cite = h.citation ?? ({} as KnowledgeEntry['header']['citation']);
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
          {!!cite.authors && cite.authors !== NOT_PRINTED && <>{cite.authors}</>}
          {!!cite.year && cite.year !== NOT_PRINTED && <> · {cite.year}</>}
          {!!cite.journal && cite.journal !== NOT_PRINTED && <> · {cite.journal}</>}
          {!!cite.volume_issue_pages && cite.volume_issue_pages !== NOT_PRINTED && <> {cite.volume_issue_pages}</>}
          {!!cite.doi && cite.doi !== NOT_PRINTED && (
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
          <KnowledgeBadge kind="confidence" value={h.confidence?.level ?? ''} why={h.confidence?.why} />
          <KnowledgeBadge kind="relevance" value={h.practical_relevance?.level ?? ''} why={h.practical_relevance?.why} />
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
        <SectionTitle>Coach's guide</SectionTitle>
        {(entry.translation ?? []).length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(entry.translation ?? []).map((t, i) => (
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

        {/* ALL THE DATA sits BELOW the narrative (founder's call): the
            reader who wants every number is the one who just finished the
            summaries and wants to go deeper — the appendix belongs after
            the story, next to ABOUT THIS PAPER. Collapsed, as always.
            (When a paper has no key findings, its data already rendered
            inline under What they found.) */}
        {(entry.key_findings?.length ?? 0) > 0 && (() => {
          const charts = entry.charts.filter((c) => c.template !== 'population_card');
          return (
            <details style={{ marginTop: 4 }} onToggle={(e) => (e.target as HTMLDetailsElement).open && logKnowledgeEvent('all_data_view', entry.slug)}>
              <summary style={{ cursor: 'pointer', margin: '24px 0 10px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)' }}>
                  All the data
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>— every number from the paper</span>
              </summary>
              <div style={{ marginTop: 12 }}>
                {charts.slice(1).map((c, i) => <ChartBlock key={i} c={c} />)}
                {entry.layer1.intervention && <InterventionFacts l={entry.layer1.intervention} />}
                {entry.layer1.comparison && <ComparisonFacts l={entry.layer1.comparison} />}
                {entry.layer1.review && <ReviewFacts l={entry.layer1.review} />}
                {entry.layer1.reference && <ReferenceFacts l={entry.layer1.reference} />}
              </div>
            </details>
          );
        })()}

        {/* The trust block in full: badges in the header give the glance,
            this section gives the depth. Collapsed like ALL THE DATA — a
            spine section whose detail never interrupts the reading flow. */}
        <details style={{ marginTop: 4 }} onToggle={(e) => (e.target as HTMLDetailsElement).open && logKnowledgeEvent('about_view', entry.slug)}>
          <summary style={{ cursor: 'pointer', margin: '24px 0 10px' }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)' }}>
              About this paper
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>— design, who was studied, confidence, funding</span>
          </summary>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 10px' }}>
          {linkifyGlossary(h.evidence_type)}
        </p>
        {(entry.layer1.intervention || entry.layer1.comparison) && setupNarrative(entry).map((p, i) => (
          <p key={i} style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 8px' }}>{p}</p>
        ))}
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: '0 0 6px' }}>
          <strong style={{ color: 'var(--text)' }}>Confidence: {h.confidence?.level}</strong>
          {h.confidence?.why && <> — {h.confidence.why}</>}
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>Relevance: {h.practical_relevance?.level}</strong>
          {h.practical_relevance?.why && <> — {h.practical_relevance.why}</>}
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
        </details>

        {/* No topic chips on the paper (founder's call, matching the list
            cards): untappable jargon pills added nothing for the reader.
            Topics keep working as data — library search and the
            Ask-the-library router both read them. */}
        <DiscussBlock slug={entry.slug} signedIn={signedIn} />
    </>
  );
}

/**
 * Discuss this paper — presented like the main AI Coach: a spine header
 * and the house chat input, nothing louder. Signed-in members chat right
 * here; signed-out readers are routed to signup on first touch and land
 * back on this page.
 */
function DiscussBlock({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  return (
    <div style={{ marginTop: 8 }}>
      <SectionTitle>Discuss with the AI Coach</SectionTitle>
      <KnowledgeDiscuss slug={slug} signedIn={signedIn} />
    </div>
  );
}
