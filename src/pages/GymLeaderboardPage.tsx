// F4 — gym Engine Class leaderboard (member/coach). Per-workout board + season
// standings; divisions by gender (+ modality); W·kg default with a raw toggle. The
// affiliate moderation ledger is applied server-side (drop hide / badge flag /
// substitute adjust).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface BoardRow {
  rnk: number; display_name: string; division: string;
  metric_value: number | null; score_display: string; rx: boolean;
  under_review: boolean; is_viewer: boolean;
}
interface Division { division: string; rows: BoardRow[]; }
interface SeasonRow { rnk: number; display_name: string; division: string; points: number; workouts: number; is_viewer: boolean; }
interface Resp {
  mode: 'workout' | 'season'; metric: 'wkg' | 'raw'; gym_name?: string | null;
  workout?: { week_num: number; day_num: number; modality: string | null } | null;
  divisions?: Division[]; season?: SeasonRow[]; moderation_connected?: boolean;
}

export default function GymLeaderboardPage() {
  const [mode, setMode] = useState<'workout' | 'season'>('workout');
  const [metric, setMetric] = useState<'wkg' | 'raw'>('wkg');
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data-fetch effect: setState lands after the await (post-response) — no synchronous
  // setState in the effect body.
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.functions.invoke('engine-class-leaderboard', { body: { mode, metric } });
      if (!live) return;
      setLoading(false);
      if (error) { setError(error.message || 'Could not load the leaderboard.'); return; }
      setError(null);
      setData(data as Resp);
    })();
    return () => { live = false; };
  }, [mode, metric]);

  const fmtMetric = (v: number | null) => v == null ? '—' : (metric === 'wkg' ? `${v.toFixed(2)} W/kg` : '');

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem 1.25rem 5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Leaderboard</h1>
        <Link to="/gym" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>← Today's class</Link>
      </div>
      {data?.gym_name && <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>{data.gym_name}</div>}

      <div style={{ display: 'flex', gap: 8, margin: '1rem 0' }}>
        <Toggle active={mode === 'workout'} onClick={() => setMode('workout')}>Today</Toggle>
        <Toggle active={mode === 'season'} onClick={() => setMode('season')}>Season</Toggle>
        <div style={{ flex: 1 }} />
        <Toggle active={metric === 'wkg'} onClick={() => setMetric('wkg')}>W/kg</Toggle>
        <Toggle active={metric === 'raw'} onClick={() => setMetric('raw')}>Raw</Toggle>
      </div>

      {data?.moderation_connected === false && (
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8 }}>
          Moderation service offline — showing unmoderated results.
        </div>
      )}

      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}
      {error && <p style={{ color: '#c0392b' }}>{error}</p>}

      {!loading && mode === 'workout' && data?.workout && (
        <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 8 }}>
          Week {data.workout.week_num} · Day {data.workout.day_num}
          {data.workout.modality ? ` · ${data.workout.modality}` : ''}
        </div>
      )}

      {!loading && mode === 'workout' && (data?.divisions ?? []).length === 0 && (
        <p style={{ opacity: 0.6 }}>No results logged yet. Be the first.</p>
      )}

      {!loading && mode === 'workout' && (data?.divisions ?? []).map((d) => (
        <div key={d.division} style={{ marginBottom: '1.25rem' }}>
          <div style={divHead}>{d.division}</div>
          {d.rows.map((r, i) => (
            <Row key={i} rnk={r.rnk} name={r.display_name} viewer={r.is_viewer} flagged={r.under_review}
              right={metric === 'wkg' ? fmtMetric(r.metric_value) : r.score_display} rx={r.rx} />
          ))}
        </div>
      ))}

      {!loading && mode === 'season' && (data?.season ?? []).length === 0 && (
        <p style={{ opacity: 0.6 }}>No season results yet.</p>
      )}
      {!loading && mode === 'season' && groupSeason(data?.season ?? []).map(([division, rows]) => (
        <div key={division} style={{ marginBottom: '1.25rem' }}>
          <div style={divHead}>{division}</div>
          {rows.map((r, i) => (
            <Row key={i} rnk={r.rnk} name={r.display_name} viewer={r.is_viewer} flagged={false}
              right={`${r.points} pts`} sub={`${r.workouts} wod${r.workouts === 1 ? '' : 's'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function groupSeason(rows: SeasonRow[]): Array<[string, SeasonRow[]]> {
  const m = new Map<string, SeasonRow[]>();
  for (const r of rows) { if (!m.has(r.division)) m.set(r.division, []); m.get(r.division)!.push(r); }
  return [...m.entries()];
}

function Row({ rnk, name, right, sub, viewer, flagged, rx }: {
  rnk: number; name: string; right: string; sub?: string; viewer: boolean; flagged: boolean; rx?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.6rem',
      borderRadius: 8, background: viewer ? 'rgba(37,99,235,0.10)' : 'transparent',
      borderBottom: '1px solid rgba(128,128,128,0.12)',
    }}>
      <div style={{ width: 24, textAlign: 'right', fontWeight: 700, opacity: 0.7 }}>{rnk}</div>
      <div style={{ flex: 1 }}>
        {name}{viewer && <span style={{ opacity: 0.5 }}> (you)</span>}
        {flagged && <span style={badge}>under review</span>}
        {sub && <span style={{ opacity: 0.5, fontSize: 12 }}> · {sub}</span>}
      </div>
      <div style={{ fontWeight: 600 }}>{right}{rx === false && <span style={{ opacity: 0.5, fontSize: 11 }}> (scaled)</span>}</div>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '0.35rem 0.7rem', borderRadius: 999, fontSize: 13, cursor: 'pointer',
      border: '1px solid ' + (active ? '#111' : 'rgba(128,128,128,0.35)'),
      background: active ? '#111' : 'transparent', color: active ? '#fff' : 'inherit',
    }}>{children}</button>
  );
}

const divHead: React.CSSProperties = { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.55, margin: '0 0 4px 6px' };
const badge: React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: 'rgba(234,179,8,0.2)', color: '#92660b' };
