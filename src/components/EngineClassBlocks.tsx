// Renders a cohort Engine Class workout's blocks (Rx form) for F5 (member view) and
// F4 TV mode. Uses the shared movement formatter (src/lib/formatMovement) so the
// prescription typography matches retail and can't drift (distance-precedence, rep
// scheme collapsing, etc.).
import { formatMovementLine, type DisplayMovement } from '../lib/formatMovement';

export type ClassMovement = DisplayMovement;

export interface ClassBlock {
  block_type: string;
  block_label?: string;
  block_scheme?: string;
  time_cap_seconds?: number;
  block_notes?: string;
  cardio_modality?: string;
  movements: ClassMovement[];
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
                {formatMovementLine(m)}
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
