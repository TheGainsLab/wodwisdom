// Renders a cohort Engine Class workout's blocks (Rx form) for F5 (member view) and
// F4 TV mode. Structured, self-contained — no dependency on the retail program schema.

export interface ClassMovement {
  movement: string;
  sets?: number;
  reps?: number;
  rep_scheme?: number[];
  weight?: number;
  weight_unit?: 'lbs' | 'kg';
  time_seconds?: number;
  distance?: number;
  distance_unit?: 'ft' | 'm';
  calories?: number;
  scaling_note?: string;
}

export interface ClassBlock {
  block_type: string;
  block_label?: string;
  block_scheme?: string;
  time_cap_seconds?: number;
  block_notes?: string;
  cardio_modality?: string;
  movements: ClassMovement[];
}

function movementLine(m: ClassMovement): string {
  const parts: string[] = [];
  const reps = m.rep_scheme && m.rep_scheme.length > 0 ? m.rep_scheme.join('-') : (m.reps != null ? String(m.reps) : '');
  if (m.sets != null && reps) parts.push(`${m.sets}×${reps}`);
  else if (reps) parts.push(reps);
  parts.push(m.movement);
  const detail: string[] = [];
  if (m.weight != null) detail.push(`${m.weight}${m.weight_unit ?? 'lb'}`);
  if (m.calories != null) detail.push(`${m.calories} cal`);
  if (m.distance != null) detail.push(`${m.distance}${m.distance_unit ?? 'm'}`);
  if (m.time_seconds != null) detail.push(`${Math.round(m.time_seconds / 60)} min`);
  let line = parts.join(' ');
  if (detail.length) line += ` — ${detail.join(', ')}`;
  return line;
}

export default function EngineClassBlocks({ blocks, large = false }: { blocks: ClassBlock[]; large?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: large ? '1.25rem' : '1rem' }}>
      {blocks.map((b, i) => (
        <div key={i} style={{
          border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10,
          padding: large ? '1.1rem 1.3rem' : '0.85rem 1rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: large ? 22 : 15 }}>
              {b.block_label || titleCase(b.block_type)}
            </div>
            <div style={{ fontSize: large ? 15 : 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.55 }}>
              {b.cardio_modality || b.block_type}
            </div>
          </div>
          {b.block_scheme && (
            <div style={{ fontSize: large ? 18 : 13, opacity: 0.85, margin: '0.2rem 0 0.5rem' }}>{b.block_scheme}</div>
          )}
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {b.movements.map((m, j) => (
              <li key={j} style={{ fontSize: large ? 20 : 14 }}>
                {movementLine(m)}
                {m.scaling_note && <span style={{ opacity: 0.6, fontSize: large ? 15 : 12 }}> — {m.scaling_note}</span>}
              </li>
            ))}
          </ul>
          {b.block_notes && <div style={{ fontSize: large ? 15 : 12, opacity: 0.6, marginTop: 6 }}>{b.block_notes}</div>}
        </div>
      ))}
    </div>
  );
}

function titleCase(s: string): string {
  return s.split(/[-_ ]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
