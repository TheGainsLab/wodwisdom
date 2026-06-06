import type { CSSProperties } from 'react';

export default function GainsLogo({ className }: { className?: string }) {
  return (
    <span className={className} style={{ fontWeight: 800, letterSpacing: '0.04em' }}>
      G<span style={{ color: 'var(--accent)' }}>AI</span>NS
    </span>
  );
}

/** Render an arbitrary name string with any "GAINS" substring styled like the
 *  logo (accent-colored "AI"). Used for program titles like "My GAINS Program". */
export function GainsName({ name, style }: { name: string; style?: CSSProperties }) {
  const i = name.indexOf('GAINS');
  if (i === -1) return <span style={style}>{name}</span>;
  return (
    <span style={style}>
      {name.slice(0, i)}
      <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>G<span style={{ color: 'var(--accent)' }}>AI</span>NS</span>
      {name.slice(i + 5)}
    </span>
  );
}
