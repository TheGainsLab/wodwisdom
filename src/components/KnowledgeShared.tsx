import { useState } from 'react';
import { KNOWLEDGE_GLOSSARY } from '../lib/knowledgeLibrary';

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

const TERMS = [...KNOWLEDGE_GLOSSARY].sort((a, b) => b.term.length - a.term.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function GlossarySpan({ text, definition }: { text: string; definition: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
          style={{
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

/** Linkify one section of prose: first occurrence of each glossary term. */
export function linkifyGlossary(text: string): React.ReactNode[] {
  // Collect first-occurrence matches, longest terms first so "VO2peak"
  // beats "VO2"; overlapping later matches are discarded.
  const matches: Array<{ start: number; end: number; term: string; definition: string }> = [];
  for (const t of TERMS) {
    const re = new RegExp(`(?<![\\w-])${escapeRegExp(t.term)}(?![\\w-])`, 'i');
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (matches.some((x) => start < x.end && end > x.start)) continue;
    matches.push({ start, end, term: m[0], definition: t.definition });
  }
  matches.sort((a, b) => a.start - b.start);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) out.push(text.slice(cursor, m.start));
    out.push(<GlossarySpan key={i} text={m.term} definition={m.definition} />);
    cursor = m.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
