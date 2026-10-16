import { useState } from 'react';
import { getGlossaryTerms, type GlossaryTerm } from '../lib/knowledgeLibrary';
import { logKnowledgeEvent } from '../lib/knowledgeEvents';

/** Shape / confidence / relevance badges for the research library. */
export function KnowledgeBadge({ kind, value, why }: { kind: 'shape' | 'confidence' | 'relevance'; value: string; why?: string }) {
  const palette: Record<string, string> = {
    shape: 'rgba(129,140,248,.15)',
    confidence: 'rgba(34,197,94,.12)',
    relevance: 'rgba(251,146,60,.12)',
  };
  const text: Record<string, string> = {
    shape: '#a5b4fc',
    confidence: '#4ade80',
    relevance: '#fdba74',
  };
  const label = kind === 'shape' ? value : `${kind === 'confidence' ? 'confidence' : 'relevance'}: ${value}`;
  return (
    <span
      title={why}
      style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        background: palette[kind], color: text[kind], whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ── Glossary auto-linking ───────────────────────────────────────────────
//
// Terms get a dotted underline; tap/click toggles the definition inline
// (works on mobile where hover doesn't exist). First occurrence per
// section only — a linkify() call is one section.

// Resolved at call time (pages await ensureGlossary() first), with the sort
// and compiled patterns cached per glossary load — linkify runs per prose
// block and table cell, and in the admin editor on every keystroke.
let termsCache: GlossaryTerm[] | null = null;
let termsCacheSrc: GlossaryTerm[] | null = null;
const reCache = new Map<string, RegExp>();

// Safari before 16.4 throws on lookbehind at construction time; fall back to
// a word-boundary approximation there rather than crash the page.
const [WB_BEFORE, WB_AFTER] = (() => {
  try {
    new RegExp('(?<![\\w-])x(?![\\w-])');
    return ['(?<![\\w-])', '(?![\\w-])'];
  } catch {
    return ['\\b', '\\b'];
  }
})();

function TERMS() {
  const src = getGlossaryTerms();
  if (src !== termsCacheSrc) {
    termsCacheSrc = src;
    termsCache = [...src].sort((a, b) => b.term.length - a.term.length);
    reCache.clear();
  }
  return termsCache!;
}

function termRegExp(term: string): RegExp {
  let re = reCache.get(term);
  if (!re) {
    re = new RegExp(`${WB_BEFORE}${escapeRegExp(term)}${WB_AFTER}`, 'i');
    reCache.set(term, re);
  }
  return re;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function GlossarySpan({ text, definition, inline = false }: { text: string; definition: string; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={inline ? undefined : { position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) logKnowledgeEvent('glossary_tap', undefined, { term: text }); }}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
          font: 'inherit', color: 'inherit',
          borderBottom: '1px dotted var(--text-muted)',
        }}
      >
        {text}
      </button>
      {open && (
        <span
          role="note"
          style={inline ? {
            // Inline mode for table cells: the definition expands in the flow
            // (a floating box would be clipped by the table's scroll container).
            display: 'block', margin: '6px 0 4px', padding: '8px 10px', borderRadius: 6,
            background: 'var(--surface2, #222)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12, lineHeight: 1.5, fontWeight: 400,
            textAlign: 'left',
          } : {
            position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 30,
            minWidth: 220, maxWidth: 300, padding: '10px 12px', borderRadius: 8,
            background: 'var(--surface2, #222)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, fontWeight: 400,
            textAlign: 'left', display: 'block',
          }}
        >
          {definition}
        </span>
      )}
    </span>
  );
}

/**
 * Linkify one section of prose: first occurrence of each glossary term.
 * `seen` widens "section" beyond one string — pass a shared Set to link each
 * term only once across many strings (e.g. every cell of one table).
 * `inline` renders definitions in the flow instead of a floating box
 * (required inside scroll containers like the facts tables).
 */
export function linkifyGlossary(
  text: string,
  opts?: { inline?: boolean; seen?: Set<string> },
): React.ReactNode[] {
  if (typeof text !== 'string' || !text) return [text ?? ''];
  // Collect first-occurrence matches, longest terms first so "VO2peak"
  // beats "VO2"; overlapping later matches are discarded.
  const matches: Array<{ start: number; end: number; term: string; definition: string }> = [];
  for (const t of TERMS()) {
    const key = t.term.toLowerCase();
    if (opts?.seen?.has(key)) continue;
    const m = termRegExp(t.term).exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (matches.some((x) => start < x.end && end > x.start)) continue;
    matches.push({ start, end, term: m[0], definition: t.definition });
    opts?.seen?.add(key);
  }
  matches.sort((a, b) => a.start - b.start);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) out.push(text.slice(cursor, m.start));
    out.push(<GlossarySpan key={i} text={m.term} definition={m.definition} inline={opts?.inline} />);
    cursor = m.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
