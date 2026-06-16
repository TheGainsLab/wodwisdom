/**
 * ShareCard — the pure, presentational score card that gets snapshotted to PNG.
 *
 * CRITICAL: this renders at LITERAL output pixels (1080×1920 story / 1080×1080
 * square). Every dimension is absolute px — no %, vw, rem, or transform/scale —
 * so html-to-image (pixelRatio:1) produces an identically-sized image on every
 * device. It's mounted off-screen by ShareCardModal; never shown directly.
 *
 * Two layout variants by data:
 *   - power variant: W/kg is the hero, score + output are supporting stats.
 *   - score variant: the score is the hero, power stats omitted entirely.
 * The "Top X% worldwide" line appears only when data.placementTopX != null.
 */

import {
  CARD_DIMENSIONS,
  isPowerVariant,
  type CompetitionShareCardData,
  type EngineShareCardData,
  type ShareCardData,
  type ShareCardFormat,
} from '../../lib/shareCard';

const BG = '#111113';
const WHITE = '#FFFFFF';
const LABEL = '#8a8a92';
const SECONDARY = '#c9c9cf';
const ACCENT = '#ff3a3a'; // app brand red (--accent)

const FONT = "'Outfit', system-ui, -apple-system, sans-serif";

function Logo({ size }: { size: number }) {
  return (
    <span style={{ fontFamily: FONT, fontWeight: 500, fontSize: size, letterSpacing: size * 0.02, color: WHITE, lineHeight: 1 }}>
      G<span style={{ color: ACCENT }}>AI</span>NS
    </span>
  );
}

function fmtWatts(w: number): string {
  return Math.round(w).toLocaleString();
}

export default function ShareCard({ data, format }: { data: ShareCardData; format: ShareCardFormat }) {
  const { width, height } = CARD_DIMENSIONS[format];

  const root: React.CSSProperties = {
    width,
    height,
    boxSizing: 'border-box',
    background: BG,
    color: WHITE,
    fontFamily: FONT,
    fontWeight: 400,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  if (data.kind === 'engine') {
    return format === 'story'
      ? <EngineStoryCard data={data} root={root} />
      : <EngineSquareCard data={data} root={root} />;
  }

  const powerVariant = isPowerVariant(data);
  if (format === 'story') return <StoryCard data={data} powerVariant={powerVariant} root={root} />;
  return <SquareCard data={data} powerVariant={powerVariant} root={root} />;
}

/* ---------------------------------------------------------------- story (9:16) */

function StoryCard({ data, powerVariant, root }: { data: CompetitionShareCardData; powerVariant: boolean; root: React.CSSProperties }) {
  return (
    <div style={{ ...root, padding: 96, justifyContent: 'space-between' }}>
      {/* 1 — header */}
      <div>
        <Logo size={56} />
      </div>

      {/* 2 — event + workout */}
      <div style={{ marginTop: -120 }}>
        <div style={{ fontSize: 38, color: LABEL, fontWeight: 400 }}>{data.eventLabel}</div>
        <div style={{ fontSize: 80, color: WHITE, fontWeight: 500, lineHeight: 1.05, marginTop: 10 }}>
          {data.workoutName}
        </div>
      </div>

      {/* 3 — hero */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {powerVariant ? (
          <>
            <div style={{ fontSize: 300, fontWeight: 500, lineHeight: 0.95, color: WHITE }}>
              {data.power!.wPerKg!.toFixed(1)}
            </div>
            <div style={{ fontSize: 44, color: LABEL, marginTop: 12 }}>watts per kilogram</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 200, fontWeight: 500, lineHeight: 0.95, color: WHITE }}>{data.score}</div>
            <div style={{ fontSize: 44, color: LABEL, marginTop: 12 }}>final score</div>
          </>
        )}
        {data.placementTopX != null && (
          <div style={{ fontSize: 58, fontWeight: 500, color: ACCENT, marginTop: 36 }}>
            Top {data.placementTopX}% worldwide
          </div>
        )}
      </div>

      {/* 4 — supporting stats (power variant only) */}
      {powerVariant ? (
        <div style={{ display: 'flex', gap: 96 }}>
          <Stat label="Score" value={data.score} />
          {data.power!.watts != null && <Stat label="Output" value={`${fmtWatts(data.power!.watts)} W`} />}
        </div>
      ) : (
        <div />
      )}

      {/* 5 — footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 38, color: SECONDARY }}>{data.athleteName}</div>
        <div style={{ fontSize: 38, color: ACCENT, fontWeight: 500 }}>{data.brandUrl}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 30, color: LABEL }}>{label}</div>
      <div style={{ fontSize: 60, fontWeight: 500, color: WHITE, marginTop: 6 }}>{value}</div>
    </div>
  );
}

/* --------------------------------------------------------------- square (1:1) */

function SquareCard({ data, powerVariant, root }: { data: CompetitionShareCardData; powerVariant: boolean; root: React.CSSProperties }) {
  return (
    <div style={{ ...root, padding: 80, justifyContent: 'space-between' }}>
      {/* header: brand left, athlete right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Logo size={44} />
        <div style={{ fontSize: 34, color: SECONDARY }}>{data.athleteName}</div>
      </div>

      {/* event + workout */}
      <div>
        <div style={{ fontSize: 32, color: LABEL }}>{data.eventLabel}</div>
        <div style={{ fontSize: 60, color: WHITE, fontWeight: 500, lineHeight: 1.05, marginTop: 8 }}>
          {data.workoutName}
        </div>
      </div>

      {/* hero (inline unit) + placement */}
      <div>
        {powerVariant ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
            <span style={{ fontSize: 200, fontWeight: 500, lineHeight: 0.95, color: WHITE }}>
              {data.power!.wPerKg!.toFixed(1)}
            </span>
            <span style={{ fontSize: 44, color: LABEL }}>W/kg</span>
          </div>
        ) : (
          <div style={{ fontSize: 150, fontWeight: 500, lineHeight: 0.95, color: WHITE }}>{data.score}</div>
        )}
        {data.placementTopX != null && (
          <div style={{ fontSize: 48, fontWeight: 500, color: ACCENT, marginTop: 24 }}>
            Top {data.placementTopX}% worldwide
          </div>
        )}
      </div>

      {/* footer: stats left (power variant only), URL right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 64 }}>
          {powerVariant && (
            <>
              <Stat label="Score" value={data.score} />
              {data.power!.watts != null && <Stat label="Output" value={`${fmtWatts(data.power!.watts)} W`} />}
            </>
          )}
        </div>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 500 }}>{data.brandUrl}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- engine story (9:16) */

function EngineStoryCard({ data, root }: { data: EngineShareCardData; root: React.CSSProperties }) {
  return (
    <div style={{ ...root, padding: 96, justifyContent: 'space-between' }}>
      {/* header */}
      <div>
        <Logo size={56} />
      </div>

      {/* day / type / modality */}
      <div style={{ marginTop: -120 }}>
        <div style={{ fontSize: 38, color: LABEL, fontWeight: 400 }}>
          {data.dayNumber != null ? `Day ${data.dayNumber}` : 'Year of the Engine'}
        </div>
        <div style={{ fontSize: 80, color: WHITE, fontWeight: 500, lineHeight: 1.05, marginTop: 10 }}>
          {data.dayTypeLabel}
        </div>
        <div style={{ fontSize: 40, color: SECONDARY, marginTop: 8 }}>{data.modalityLabel}</div>
      </div>

      {/* hero: work + pace */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <span style={{ fontSize: 240, fontWeight: 500, lineHeight: 0.95, color: WHITE }}>{data.workValue}</span>
          <span style={{ fontSize: 48, color: LABEL }}>{data.workUnit}</span>
        </div>
        {data.paceValue != null && (
          <div style={{ fontSize: 44, color: SECONDARY, marginTop: 16 }}>
            {data.paceValue} {data.paceUnit}
          </div>
        )}
        {data.accent != null && (
          <div style={{ fontSize: 58, fontWeight: 500, color: ACCENT, marginTop: 36 }}>{data.accent}</div>
        )}
      </div>

      {/* spine */}
      <div style={{ fontSize: 38, color: SECONDARY, lineHeight: 1.4 }}>{data.spine}</div>

      {/* footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 38, color: ACCENT, fontWeight: 500 }}>{data.brandUrl}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ engine square (1:1) */

function EngineSquareCard({ data, root }: { data: EngineShareCardData; root: React.CSSProperties }) {
  return (
    <div style={{ ...root, padding: 80, justifyContent: 'space-between' }}>
      {/* header: brand left, day right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Logo size={44} />
        <div style={{ fontSize: 34, color: SECONDARY }}>
          {data.dayNumber != null ? `Day ${data.dayNumber}` : 'Year of the Engine'}
        </div>
      </div>

      {/* type + modality */}
      <div>
        <div style={{ fontSize: 56, color: WHITE, fontWeight: 500, lineHeight: 1.05 }}>{data.dayTypeLabel}</div>
        <div style={{ fontSize: 32, color: LABEL, marginTop: 8 }}>{data.modalityLabel}</div>
      </div>

      {/* hero: work (inline unit) + pace */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span style={{ fontSize: 170, fontWeight: 500, lineHeight: 0.95, color: WHITE }}>{data.workValue}</span>
          <span style={{ fontSize: 40, color: LABEL }}>{data.workUnit}</span>
        </div>
        {data.paceValue != null && (
          <div style={{ fontSize: 36, color: SECONDARY, marginTop: 12 }}>
            {data.paceValue} {data.paceUnit}
          </div>
        )}
        {data.accent != null && (
          <div style={{ fontSize: 46, fontWeight: 500, color: ACCENT, marginTop: 20 }}>{data.accent}</div>
        )}
      </div>

      {/* footer: spine left, URL right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}>
        <div style={{ fontSize: 30, color: SECONDARY, lineHeight: 1.35, maxWidth: 620 }}>{data.spine}</div>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 500, whiteSpace: 'nowrap' }}>{data.brandUrl}</div>
      </div>
    </div>
  );
}
