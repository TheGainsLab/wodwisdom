// F4 TV mode — the gym-wall screen. Public, NO login: the :token in the URL is the
// capability (gym_tv_tokens). Shows today's Engine Class workout (Rx) + a rolling
// leaderboard that auto-refreshes. Dark, full-screen, high-contrast for a wall.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EngineClassBlocks, { type ClassBlock } from '../components/EngineClassBlocks';

interface BoardRow { rnk: number | null; display_name: string; metric_value: number | null; score_display: string; under_review: boolean; }
interface Division { division: string; rows: BoardRow[]; }
interface TVResp {
  gym_name?: string | null; class_name?: string | null; metric?: 'wkg' | 'raw';
  workout?: { week_num: number; day_num: number; modality: string | null; blocks: ClassBlock[] } | null;
  divisions?: Division[]; moderation_connected?: boolean; error?: string;
}

const REFRESH_MS = 30_000;

export default function GymTVPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TVResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch + poll. setState lands only after the await (no synchronous setState in the
  // effect body); the interval re-runs the same fetch for the rolling board.
  useEffect(() => {
    if (!token) return;
    let live = true;
    const run = async () => {
      const { data, error } = await supabase.functions.invoke('engine-class-tv', { body: { token, metric: 'wkg' } });
      if (!live) return;
      if (error) { setError('Screen unavailable.'); return; }
      const resp = data as TVResp;
      if (resp.error) { setError(resp.error === 'invalid_token' ? 'This screen link is invalid or was revoked.' : 'Screen unavailable.'); return; }
      setError(null); setData(resp);
    };
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ fontSize: 15, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.55 }}>Engine Class</div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{data?.gym_name ?? 'The Gains Lab'}</div>
        </div>
        {data?.workout && (
          <div style={{ textAlign: 'right', opacity: 0.7, fontSize: 18 }}>
            Week {data.workout.week_num} · Day {data.workout.day_num}
            {data.workout.modality ? ` · ${data.workout.modality}` : ''}
          </div>
        )}
      </div>

      {error && <div style={{ fontSize: 22, opacity: 0.7 }}>{error}</div>}

      {!error && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '2rem', alignItems: 'start' }}>
          <div>
            <SectionTitle>Today's Workout (Rx)</SectionTitle>
            {data?.workout ? <EngineClassBlocks blocks={data.workout.blocks} large /> : <Dim>No workout scheduled.</Dim>}
          </div>
          <div>
            <SectionTitle>Leaderboard · {data?.metric === 'raw' ? 'Score' : 'W/kg'}</SectionTitle>
            {data?.moderation_connected === false && (
              <div style={{ fontSize: 14, opacity: 0.45, marginBottom: 8 }}>Moderation offline — results unmoderated.</div>
            )}
            {(data?.divisions ?? []).length === 0 && <Dim>No results logged yet.</Dim>}
            {(data?.divisions ?? []).map((d) => (
              <div key={d.division} style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: 16, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.55, marginBottom: 6 }}>{d.division}</div>
                {d.rows.slice(0, 10).map((r, i) => (
                  <div key={i} style={tvRow}>
                    <span style={{ width: 36, fontWeight: 800, opacity: 0.6 }}>{r.rnk ?? '—'}</span>
                    <span style={{ flex: 1 }}>{r.display_name}{r.under_review && <span style={{ opacity: 0.5, fontSize: 15 }}> · under review</span>}</span>
                    <span style={{ fontWeight: 700 }}>{data?.metric !== 'raw' && r.metric_value != null ? `${r.metric_value.toFixed(2)}` : r.score_display}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 20, fontWeight: 700, marginBottom: '0.75rem', borderBottom: '2px solid rgba(255,255,255,0.15)', paddingBottom: 6 }}>{children}</div>
);
const Dim = ({ children }: { children: React.ReactNode }) => <div style={{ opacity: 0.5, fontSize: 20 }}>{children}</div>;

const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0b0d12', color: '#f5f7fa', padding: '2.5rem 3rem', fontSize: 20 };
const tvRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 22 };
