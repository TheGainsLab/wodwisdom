/**
 * Progress card components + payload types for the analytics RPCs
 * (admin_user_* and their self-scoped my_* wrappers share payload shapes).
 * Extracted from AdminUserDetailPage for reuse on the athlete-facing
 * My Progress page; the admin page keeps its local copies for now —
 * deduping it is a follow-up, not worth destabilizing a working page.
 */

export interface AdherenceRow {
  id: string;
  name: string | null;
  created_at: string;
  program_version: string | null;
  prescribed_workouts: number;
  completed_workouts: number;
  prescribed_blocks: number;
  logged_blocks: number;
  total_entries: number;
  skipped_entries: number;
}

export interface LiftPoint {
  date: string;
  max_weight: number;
  weight_unit: string | null;
}

export interface LiftProgress {
  lift_key: string;
  display_name: string;
  current_1rm: number | null;
  current_1rm_unit: string | null;
  points: LiftPoint[];
}

export interface SkillPoint {
  date: string;
  total_reps: number;
  total_hold_seconds: number;
}

export interface SkillVolume {
  skill_key: string;
  display_name: string;
  self_rating: string | null;
  metric: 'reps' | 'hold_seconds';
  points: SkillPoint[];
}

export function AdherenceMetric({ label, num, den }: { label: string; num: number; den: number }) {
  const pct = den > 0 ? Math.round((num / den) * 100) : null;
  const color =
    pct == null ? 'var(--text-muted)' :
    pct >= 80 ? 'var(--accent)' :
    pct >= 50 ? 'var(--text)' :
    'var(--text-dim)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 88 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color }}>
        {num}/{den}{pct != null && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>{pct}%</span>}
      </div>
    </div>
  );
}

export function AdherenceRowCard({ row }: { row: AdherenceRow }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{row.name || 'Untitled program'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(row.created_at).toLocaleDateString()}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <AdherenceMetric label="Workouts" num={row.completed_workouts} den={row.prescribed_workouts} />
        <AdherenceMetric label="Blocks" num={row.logged_blocks} den={row.prescribed_blocks} />
      </div>
    </div>
  );
}

export function Sparkline({ values, width = 180, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null;
  if (values.length === 1) {
    return (
      <svg width={width} height={height}>
        <circle cx={width / 2} cy={height / 2} r={3} fill="var(--accent)" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const pad = 4;
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;
  const coords = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * innerW;
    const y = pad + (1 - (v - min) / range) * innerH;
    return [x, y] as const;
  });
  const path = coords.map((c, i) => (i === 0 ? `M ${c[0]} ${c[1]}` : `L ${c[0]} ${c[1]}`)).join(' ');
  const lastCoord = coords[coords.length - 1];
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <path d={path} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
      <circle cx={lastCoord[0]} cy={lastCoord[1]} r={3} fill="var(--accent)" />
    </svg>
  );
}

export function LiftProgressCard({ lift }: { lift: LiftProgress }) {
  const latest = lift.points[lift.points.length - 1];
  const unit = lift.current_1rm_unit || 'lbs';
  // A PR marker when the latest logged day is the heaviest in the window.
  const maxWeight = Math.max(...lift.points.map(p => Number(p.max_weight)));
  const latestIsMax = latest != null && Number(latest.max_weight) >= maxWeight;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {lift.display_name}
          {latestIsMax && lift.points.length > 1 && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-glow)', padding: '1px 6px', borderRadius: 4, marginLeft: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Best
            </span>
          )}
        </div>
        {lift.current_1rm != null && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            1RM: {Number(lift.current_1rm)}{unit}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Sparkline values={lift.points.map(p => Number(p.max_weight))} />
        {latest && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {Number(latest.max_weight)}{latest.weight_unit || unit}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {new Date(latest.date).toLocaleDateString()} · {lift.points.length} day{lift.points.length === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SkillVolumeCard({ skill }: { skill: SkillVolume }) {
  const values = skill.points.map(p => skill.metric === 'reps' ? Number(p.total_reps) : Number(p.total_hold_seconds));
  const latest = skill.points[skill.points.length - 1];
  const latestVal = latest ? (skill.metric === 'reps' ? Number(latest.total_reps) : Number(latest.total_hold_seconds)) : 0;
  const unitLabel = skill.metric === 'reps' ? 'reps' : 's';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{skill.display_name}</div>
        {skill.self_rating && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Self-rating: {skill.self_rating}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Sparkline values={values} />
        {latest && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {latestVal}<span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 4 }}>{unitLabel}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {new Date(latest.date).toLocaleDateString()} · {skill.points.length} day{skill.points.length === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
