import { DAY_TYPE_SPECTRUM, spectrumCaption } from '../../lib/dayTypeSpectrum';

/**
 * Slow→fast muscle-fiber / energy-system spectrum for an Engine day type.
 * Decodes cryptic names (devour, infinity, towers…) into an at-a-glance "where
 * does today sit." Position comes from the prescription's paceRange, not a guess.
 */
export default function FiberSpectrum({ dayType }: { dayType?: string | null }) {
  const s = dayType ? DAY_TYPE_SPECTRUM[dayType] : undefined;
  if (!s) return null;

  const left = Math.max(0, Math.min(100, s.lo));
  const width = Math.max(3, Math.min(100 - left, s.hi - s.lo));

  return (
    <div style={{ margin: '4px 0 8px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'var(--text-muted)', marginBottom: 6,
      }}>
        <span>Slow · Endurance</span>
        <span>Fast · Power</span>
      </div>

      <div style={{
        position: 'relative', height: 10, borderRadius: 5,
        background: 'var(--surface2)', overflow: 'hidden',
      }}>
        {/* tick marks at the quartiles for orientation */}
        {[25, 50, 75].map((t) => (
          <div key={t} style={{
            position: 'absolute', left: `${t}%`, top: 0, bottom: 0, width: 1,
            background: 'var(--border)',
          }} />
        ))}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`,
          borderRadius: 5,
          background: s.gradient
            ? 'linear-gradient(90deg, var(--accent), rgba(229,72,77,0.18))'
            : 'var(--accent)',
        }} />
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
        {spectrumCaption(s)}
      </div>
    </div>
  );
}
