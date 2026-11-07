/**
 * Power chart pieces shared by the Metcons tab (program training) and
 * Athlete Data's Power tab (competition history): the W/kg bar chart, the
 * time-domain color key, and the stat block. One implementation so the two
 * power views read the same.
 */

import { BUCKET_COLOR, BUCKET_LABEL, BUCKET_ORDER, SELECTED_COLOR } from '../lib/powerBuckets';

/** Vertical bar chart with date/label axis. Hover/title tooltips show value.
 *  When onSelect is provided, the whole column is a click target; the selected
 *  bar keeps full color + a ring while the rest dim. */
export function WkgBarChart({
  items, valueLabel = 'W/kg', onSelect, selectedKey, referenceValue,
}: {
  items: Array<{ key: string; label: string; subLabel?: string; value: number; bucket?: string }>;
  valueLabel?: string;
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
  /** Athlete's average — drawn as a dashed reference line so every bar
   *  reads as above/below their own baseline (no axis chrome needed). */
  referenceValue?: number | null;
}) {
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
        No data yet.
      </div>
    );
  }
  const maxVal = items.reduce((m, it) => Math.max(m, it.value), 0);
  const first = items[0];
  const last = items[items.length - 1];
  const clickable = !!onSelect;
  const ref = referenceValue != null && referenceValue > 0 && maxVal > 0 && referenceValue <= maxVal
    ? referenceValue : null;
  return (
    <div>
      {/* Magnitude anchors: your average on the left, the peak on the right. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
        <span>{ref != null ? `avg ${ref.toFixed(2)} ${valueLabel}` : ''}</span>
        <span>{maxVal > 0 ? `peak ${maxVal.toFixed(2)} ${valueLabel}` : ''}</span>
      </div>
      <div style={{ position: 'relative' }}>
      {ref != null && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          bottom: `${(ref / maxVal) * 100}%`,
          borderTop: '1px dashed rgba(255,255,255,0.45)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
        {items.map((it, i) => {
          const isSel = selectedKey != null && selectedKey === it.key;
          const dim = selectedKey != null && !isSel;
          return (
            <button
              key={`${it.key}-${i}`}
              type="button"
              onClick={clickable ? () => onSelect!(it.key) : undefined}
              title={`${it.label}: ${it.value.toFixed(2)} ${valueLabel}${it.subLabel ? ` · ${it.subLabel}` : ''}`}
              style={{
                flex: 1, minWidth: 4, height: '100%', padding: 0, border: 'none',
                background: 'transparent', cursor: clickable ? 'pointer' : 'default',
                display: 'flex', alignItems: 'flex-end',
              }}
            >
              <div style={{
                width: '100%',
                height: `${maxVal > 0 ? Math.max((it.value / maxVal) * 100, 4) : 4}%`,
                // Tapped bar fills brand red; otherwise the slate bucket color.
                background: isSel ? SELECTED_COLOR : ((it.bucket && BUCKET_COLOR[it.bucket]) || 'var(--accent)'),
                borderRadius: 2,
                // Hairline red outline on every bar.
                border: `1px solid ${SELECTED_COLOR}`,
                boxSizing: 'border-box',
                opacity: dim ? 0.4 : 1,
              }} />
            </button>
          );
        })}
      </div>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 4,
        fontSize: 10, color: 'var(--text-muted)',
      }}>
        <span>{first.label}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

/** Color key for the time-domain bucket palette shared by the bars + breakdown. */
export function BucketLegend() {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0 2px' }}>
      {BUCKET_ORDER.map(b => (
        <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: BUCKET_COLOR[b] }} />
          {BUCKET_LABEL[b]}
        </span>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: 'JetBrains Mono' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
