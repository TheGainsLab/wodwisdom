interface V2OutputPanelProps {
  output: unknown;
  programId: string | null;
  elapsedMs: number | null;
  safety: { safe: boolean; reasoning: string; errored: boolean } | null;
}

interface V2Movement {
  movement: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weight_unit?: string;
  rpe?: number;
  time_seconds?: number;
  distance?: number;
  distance_unit?: string;
  scaling_note?: string;
}

interface V2Block {
  block_type: string;
  block_label?: string;
  block_scheme?: string;
  time_cap_seconds?: number;
  block_notes?: string;
  movements: V2Movement[];
}

interface V2Day {
  day_num: number;
  blocks: V2Block[];
}

interface V2Week {
  week_num: number;
  days: V2Day[];
}

interface V2Output {
  month_plan: {
    weekly_intent: string[];
    strength_progression: string;
    deload_placement: string;
    programming_priorities?: string;
  };
  weeks: V2Week[];
}

function formatMovementLine(m: V2Movement): string {
  const parts: string[] = [];
  if (m.sets != null && m.reps != null) parts.push(`${m.sets}×${m.reps}`);
  else if (m.sets != null) parts.push(`${m.sets} sets`);
  else if (m.reps != null) parts.push(`${m.reps} reps`);
  if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? ''}`);
  if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
  if (m.time_seconds != null) parts.push(`${m.time_seconds}s`);
  if (m.distance != null) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
  const scheme = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
  const scaling = m.scaling_note ? ` (${m.scaling_note})` : '';
  return `${m.movement}${scheme}${scaling}`;
}

export function V2OutputPanel({ output, programId, elapsedMs, safety }: V2OutputPanelProps) {
  const out = output as V2Output;
  const headerStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, color: 'var(--text)', marginTop: 12 };
  const subHeaderStyle: React.CSSProperties = { fontWeight: 600, fontSize: 12, color: 'var(--text-dim)', marginTop: 8 };
  const bodyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text)', marginTop: 4, whiteSpace: 'pre-wrap' };

  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        textAlign: 'left',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
        {elapsedMs != null && <>Generated in {(elapsedMs / 1000).toFixed(1)}s</>}
        {programId && <> · program_id: {programId.slice(0, 8)}…</>}
        {safety && (
          <>
            {' · '}safety: {safety.safe ? 'OK' : 'UNSAFE'}
            {safety.errored && ' (errored)'}
          </>
        )}
      </div>
      {safety && !safety.safe && (
        <div style={{ marginTop: 4, padding: 8, background: 'rgba(255, 0, 0, 0.06)', borderRadius: 4, fontSize: 11 }}>
          {safety.reasoning}
        </div>
      )}

      <div style={headerStyle}>Month plan</div>
      <div style={bodyStyle}>
        Weekly intent: {out.month_plan.weekly_intent.map((w, i) => `W${i + 1}: ${w}`).join(' · ')}
        {'\n\n'}Progression: {out.month_plan.strength_progression}
        {'\n\n'}Deload: {out.month_plan.deload_placement}
        {out.month_plan.programming_priorities && (
          <>
            {'\n\n'}Priorities: {out.month_plan.programming_priorities}
          </>
        )}
      </div>

      {out.weeks.map((week) => (
        <div key={week.week_num}>
          <div style={headerStyle}>Week {week.week_num}</div>
          {week.days.map((day) => (
            <div key={day.day_num} style={{ marginLeft: 12, marginTop: 8 }}>
              <div style={subHeaderStyle}>Day {day.day_num}</div>
              {day.blocks.map((block, bi) => (
                <div key={bi} style={{ marginLeft: 12, marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                    {block.block_type}
                    {block.block_label && <> — {block.block_label}</>}
                    {block.block_scheme && <> — {block.block_scheme}</>}
                    {block.time_cap_seconds && <> — cap {Math.round(block.time_cap_seconds / 60)} min</>}
                  </div>
                  {block.block_notes && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{block.block_notes}</div>
                  )}
                  <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12 }}>
                    {block.movements.map((m, mi) => (
                      <li key={mi} style={{ marginBottom: 2 }}>{formatMovementLine(m)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
