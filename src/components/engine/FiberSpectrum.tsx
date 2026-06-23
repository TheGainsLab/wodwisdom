import { DAY_TYPE_SPECTRUM, spectrumCaption } from '../../lib/dayTypeSpectrum';

// Cool (slow/easy) → hot (fast/powerful). Routed through the saturated magenta
// side of the wheel (blue→violet→magenta→red) so it stays vivid the whole way
// and never crosses the olive/gray that a blue→amber ramp drags through.
const SPECTRUM_GRADIENT = 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 40%, #ec4899 72%, #ef4444 100%)';

/**
 * Slow→fast energy-system spectrum for an Engine day type. Decodes cryptic names
 * (devour, infinity, towers…) into an at-a-glance "where does today sit." The
 * day's zone is the full-color gradient; the rest of the scale is dimmed.
 * Position comes from the prescription's paceRange, not a guess.
 */
export default function FiberSpectrum({ dayType }: { dayType?: string | null }) {
  const s = dayType ? DAY_TYPE_SPECTRUM[dayType] : undefined;
  if (!s) return null;

  const left = Math.max(0, Math.min(100, s.lo));
  const width = Math.max(3, Math.min(100 - left, s.hi - s.lo));
  // "Base + surge" days (flux, polarized, full-spectrum) fade from their anchor
  // toward the reach so they don't read as a flat band.
  const fade = s.gradient
    ? 'linear-gradient(90deg, #000 0%, rgba(0,0,0,0.3) 100%)'
    : undefined;

  return (
    <div style={{
      margin: '12px 0',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 16px',
      background: 'var(--surface)',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'var(--text)', marginBottom: 12,
      }}>
        What this session trains
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'var(--text-muted)', marginBottom: 6,
      }}>
        <span>Slow · Endurance</span>
        <span>Fast · Power</span>
      </div>

      <div style={{ position: 'relative', height: 14, borderRadius: 7, overflow: 'hidden' }}>
        {/* dimmed full cool→hot scale */}
        <div style={{ position: 'absolute', inset: 0, background: SPECTRUM_GRADIENT, opacity: 0.2 }} />
        {/* the day's lit zone — full-color gradient clipped to the lo–hi window */}
        <div style={{
          position: 'absolute', inset: 0,
          background: SPECTRUM_GRADIENT,
          clipPath: `inset(0 ${100 - (left + width)}% 0 ${left}%)`,
          maskImage: fade,
          WebkitMaskImage: fade,
        }} />
        {/* outline around the lit zone */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`,
          border: '1px solid rgba(255,255,255,0.55)', borderRadius: 4,
        }} />
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
        {spectrumCaption(s)}
      </div>
    </div>
  );
}
