import { useState } from 'react';

interface WriterPayloadDetailsProps {
  payload: unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function size(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isObj(v)) return `{${Object.keys(v).length}}`;
  return '';
}

const PRE_STYLE: React.CSSProperties = {
  margin: '6px 0 0 0',
  padding: 8,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.4,
  maxHeight: 360,
  overflow: 'auto',
  whiteSpace: 'pre',
};

function jsonBlock(label: string, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)' }}>
        {label} <span style={{ opacity: 0.6 }}>{size(value)}</span>
      </summary>
      <pre style={PRE_STYLE}>{json}</pre>
    </details>
  );
}

export function WriterPayloadDetails({ payload }: WriterPayloadDetailsProps) {
  const [open, setOpen] = useState(false);
  if (!isObj(payload)) return null;

  const competition = payload.competition;
  const competitionLinked = competition != null;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        marginTop: 12,
        padding: 8,
        background: 'var(--bg)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>
        Show writer payload
        <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-dim)' }}>
          (admin · {competitionLinked ? 'Tier 4 linked' : 'unlinked'})
        </span>
      </summary>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
        Exactly what the writer LLM received. Use this to verify Tier 4 data,
        canonical-key hydration, and that the numbers in the output map back to
        real fields.
      </div>

      {jsonBlock('competition (Tier 4 slice)', competition)}
      {jsonBlock('basics', payload.basics)}
      {jsonBlock('lifts', payload.lifts)}
      {jsonBlock('skills', payload.skills)}
      {jsonBlock('conditioning', payload.conditioning)}
      {jsonBlock('equipment', payload.equipment)}
      {jsonBlock('training_context', payload.training_context)}
      {jsonBlock('vocabulary', payload.vocabulary)}
      {jsonBlock('rag (reference context)', payload.rag)}
    </details>
  );
}
