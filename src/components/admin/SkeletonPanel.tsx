interface SkeletonPanelProps {
  skeleton: unknown;
}

interface SkeletonDay {
  day_num: number;
  day_intent: string;
  block_types: string[];
  primary_lift?: string;
  strength_scheme?: string;
  metcon_focus?: string;
  skill_focus?: string;
}

interface SkeletonWeek {
  week_num: number;
  weekly_intent: string;
  days: SkeletonDay[];
}

interface SkeletonShape {
  month_plan: {
    weekly_intent: string[];
    strength_progression: string;
    deload_placement: string;
    programming_priorities?: string;
  };
  weeks: SkeletonWeek[];
}

const safeArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const safeStr = (v: unknown): string => (typeof v === 'string' ? v : '');

export function SkeletonPanel({ skeleton }: SkeletonPanelProps) {
  if (!skeleton || typeof skeleton !== 'object') return null;
  const s = skeleton as Partial<SkeletonShape>;
  const weeks = safeArr(s.weeks) as SkeletonWeek[];
  const mp = s.month_plan ?? null;

  const header: React.CSSProperties = { fontWeight: 700, fontSize: 12, color: 'var(--text)', marginTop: 10 };
  const sub: React.CSSProperties = { fontWeight: 600, fontSize: 11, color: 'var(--text-dim)', marginTop: 6 };
  const body: React.CSSProperties = { fontSize: 11, color: 'var(--text)', marginTop: 2, lineHeight: 1.5 };

  return (
    <details
      style={{
        marginTop: 12,
        padding: 10,
        background: 'var(--bg)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>
        Skeleton (structural decisions — pre-fill)
      </summary>

      {mp && (
        <>
          <div style={header}>Month plan</div>
          <div style={body}>
            {Array.isArray(mp.weekly_intent) && (
              <>Weekly intent: {mp.weekly_intent.map((w, i) => `W${i + 1}: ${safeStr(w)}`).join(' · ')}<br /></>
            )}
            {safeStr(mp.strength_progression) && <>Progression: {mp.strength_progression}<br /></>}
            {safeStr(mp.deload_placement) && <>Deload: {mp.deload_placement}<br /></>}
            {safeStr(mp.programming_priorities) && <>Priorities: {mp.programming_priorities}</>}
          </div>
        </>
      )}

      {weeks.map((week) => (
        <div key={week.week_num}>
          <div style={header}>Week {week.week_num} · {safeStr(week.weekly_intent)}</div>
          {safeArr(week.days).map((d) => {
            const day = d as SkeletonDay;
            const blocks = safeArr(day.block_types) as string[];
            return (
              <div key={day.day_num} style={{ marginLeft: 12, marginTop: 6 }}>
                <div style={sub}>Day {day.day_num}: {safeStr(day.day_intent)}</div>
                <div style={body}>
                  Blocks: {blocks.join(' → ')}
                  {day.primary_lift && (
                    <><br />Strength: <strong>{day.primary_lift}</strong> — {safeStr(day.strength_scheme)}</>
                  )}
                  {day.metcon_focus && (
                    <><br />Metcon: {day.metcon_focus}</>
                  )}
                  {day.skill_focus && (
                    <><br />Skill: {day.skill_focus}</>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </details>
  );
}
