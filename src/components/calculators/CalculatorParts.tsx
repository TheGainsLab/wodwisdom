import type { ReactNode } from 'react';
import type { Band } from '../../lib/calculators/bands';

/** Shared building blocks for the calculators on /calculators. */

export function CalcCard({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="calc-card" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="calc-card-title" id={`${id}-title`}>{title}</h2>
      <p className="calc-card-blurb">{blurb}</p>
      {children}
    </section>
  );
}

export function NumberField({ id, label, value, onChange, suffix, placeholder, inputMode = 'decimal' }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
  /** 'text' for a time (m:ss needs the colon key). */
  inputMode?: 'decimal' | 'text';
}) {
  return (
    <label className="calc-field" htmlFor={id}>
      <span className="calc-field-label">{label}</span>
      <span className="calc-input-wrap">
        <input
          id={id}
          className="calc-input"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="calc-input-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function SelectField({ id, label, value, onChange, options }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="calc-field" htmlFor={id}>
      <span className="calc-field-label">{label}</span>
      <select id={id} className="calc-input calc-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const BAND_ORDER: Band[] = ['well_below', 'below', 'on_target', 'above', 'well_above'];

/** Marker position across the five-band scale, 0–100. The scale spans ±15%
 *  of target with band edges at ±5% and ±10%, so the segments are drawn
 *  1 : 1 : 2 : 1 : 1 (see .calc-scale-seg in calculators.css). */
function markerPct(deviation: number): number {
  const clamped = Math.max(-0.15, Math.min(0.15, deviation));
  return ((clamped + 0.15) / 0.30) * 100;
}

export function ResultPanel({ title, ratio, target, deviation, band, label, detail, lowLabel, highLabel, children }: {
  /** Shown above the number when several results share one card. */
  title?: string;
  ratio: number;
  target: number;
  deviation: number;
  band: Band;
  label: string;
  detail: string;
  /** What the left / right ends of the scale mean. */
  lowLabel: string;
  highLabel: string;
  children?: ReactNode;
}) {
  const pct = Math.round(Math.abs(deviation) * 100);
  const vsTarget = pct === 0 ? 'on target' : `${pct}% ${deviation < 0 ? 'below' : 'above'} target`;
  return (
    <div className="calc-result" role="status" aria-live="polite">
      {title && <div className="calc-result-title">{title}</div>}
      <div className="calc-result-top">
        <div>
          <div className="calc-result-ratio">{ratio.toFixed(2)}</div>
          <div className="calc-result-target">Target {target.toFixed(2)} · {vsTarget}</div>
        </div>
        <div className={`calc-result-label calc-band-${band}`}>{label}</div>
      </div>
      <div className="calc-scale" aria-hidden="true">
        {BAND_ORDER.map((b) => <span key={b} className={`calc-scale-seg${b === band ? ' is-active' : ''}`} />)}
        <span className="calc-scale-marker" style={{ left: `${markerPct(deviation)}%` }} />
      </div>
      <div className="calc-scale-ends" aria-hidden="true"><span>{lowLabel}</span><span>{highLabel}</span></div>
      {children}
      <p className="calc-result-detail">{detail}</p>
    </div>
  );
}

/** Two-or-more-way switch (men / women, lb / kg). */
export function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="calc-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`calc-seg-btn${o.value === value ? ' is-active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
