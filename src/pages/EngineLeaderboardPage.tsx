import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import { supabase } from '../lib/supabase';
import { ChevronLeft, Trophy, Menu } from 'lucide-react';

type Board = 'days' | 'time_trials' | 'improvement';

interface DaysRow { rnk: number; display_name: string; days: number; is_viewer: boolean }
interface TtRow { rnk: number; display_name: string; rpm: number; total_output: number; is_viewer: boolean }
interface ImpRow { rnk: number; display_name: string; improvement_pct: number; first_rpm: number; best_rpm: number; is_viewer: boolean }
interface TtBucket { modality: string; units: string; athletes: number; is_viewer_default: boolean }

const labelModality = (m: string) =>
  m.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function EngineLeaderboardPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const uid = session.user.id;
  const [navOpen, setNavOpen] = useState(false);
  const [board, setBoard] = useState<Board>('days');

  const [days, setDays] = useState<DaysRow[]>([]);
  const [buckets, setBuckets] = useState<TtBucket[]>([]);
  const [bucketKey, setBucketKey] = useState<string>('');
  const [ttRows, setTtRows] = useState<TtRow[]>([]);
  const [impRows, setImpRows] = useState<ImpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ttLoading, setTtLoading] = useState(false);
  const [impLoading, setImpLoading] = useState(false);

  // Days board + TT bucket list load once.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [d, b] = await Promise.all([
        supabase.rpc('engine_leaderboard_days', { p_viewer: uid, p_window_days: 30 }),
        supabase.rpc('engine_leaderboard_tt_buckets', { p_viewer: uid }),
      ]);
      setDays((d.data as DaysRow[]) ?? []);
      const bk = (b.data as TtBucket[]) ?? [];
      setBuckets(bk);
      const def = bk.find((x) => x.is_viewer_default) ?? bk[0];
      if (def) setBucketKey(`${def.modality}|${def.units}`);
      setLoading(false);
    })();
  }, [uid]);

  // TT board reloads when the selected bucket changes.
  useEffect(() => {
    if (!bucketKey) { setTtRows([]); return; }
    const [modality, units] = bucketKey.split('|');
    (async () => {
      setTtLoading(true);
      const { data } = await supabase.rpc('engine_leaderboard_time_trials', {
        p_viewer: uid, p_modality: modality, p_units: units,
      });
      setTtRows((data as TtRow[]) ?? []);
      setTtLoading(false);
    })();
  }, [bucketKey, uid]);

  // Improvement board reloads when the selected bucket changes.
  useEffect(() => {
    if (!bucketKey) { setImpRows([]); return; }
    const [modality, units] = bucketKey.split('|');
    (async () => {
      setImpLoading(true);
      const { data } = await supabase.rpc('engine_leaderboard_tt_improvement', {
        p_viewer: uid, p_modality: modality, p_units: units,
      });
      setImpRows((data as ImpRow[]) ?? []);
      setImpLoading(false);
    })();
  }, [bucketKey, uid]);

  const renderRow = (rnk: number, name: string, metric: string, isViewer: boolean, key: string | number, sub?: string) => {
    // Insert a divider hint when the viewer's anchored row is detached from the top 10.
    return (
      <div
        key={key}
        className="engine-exercise"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
          border: isViewer ? '1px solid var(--accent)' : '1px solid transparent',
          background: isViewer ? 'var(--accent-glow)' : 'transparent',
          borderRadius: 8,
        }}
      >
        <span style={{
          width: 32, textAlign: 'center', fontWeight: 700,
          color: rnk <= 3 ? 'var(--accent)' : 'var(--text-muted)',
        }}>{rnk}</span>
        <span style={{ flex: 1, fontWeight: 600 }}>
          {isViewer ? 'You' : name}
        </span>
        <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: 'var(--text-muted)', display: 'block' }}>{metric}</span>
          {sub && <span style={{ color: 'var(--text-dim)', fontSize: 12, display: 'block' }}>{sub}</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="app-main">
        <div className="engine-page">
          <header className="engine-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="engine-btn engine-btn-secondary" onClick={() => navigate('/engine')}>
              <ChevronLeft size={16} /> Back
            </button>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trophy size={22} /> Leaderboard
            </h1>
            <button className="engine-menu-btn" onClick={() => setNavOpen(true)} style={{ marginLeft: 'auto' }}>
              <Menu size={20} />
            </button>
          </header>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}>
            <button
              className={'engine-btn ' + (board === 'days' ? 'engine-btn-primary' : 'engine-btn-secondary')}
              onClick={() => setBoard('days')}
              style={{ flex: 1 }}
            >Days Completed</button>
            <button
              className={'engine-btn ' + (board === 'time_trials' ? 'engine-btn-primary' : 'engine-btn-secondary')}
              onClick={() => setBoard('time_trials')}
              style={{ flex: 1 }}
            >Time Trials</button>
            <button
              className={'engine-btn ' + (board === 'improvement' ? 'engine-btn-primary' : 'engine-btn-secondary')}
              onClick={() => setBoard('improvement')}
              style={{ flex: 1 }}
            >Most Improved</button>
          </div>

          {loading ? (
            <div className="engine-empty"><div className="engine-empty-desc">Loading…</div></div>
          ) : board === 'days' ? (
            <div className="engine-section">
              <p className="engine-subheader" style={{ marginBottom: 8 }}>
                Most days trained in the last 30 days — global, all programs.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {days.length === 0
                  ? <div className="engine-empty-desc">No completed days yet.</div>
                  : days.map((r) => renderRow(r.rnk, r.display_name, `${r.days} days`, r.is_viewer, r.rnk))}
              </div>
            </div>
          ) : board === 'time_trials' ? (
            <div className="engine-section">
              {buckets.length === 0 ? (
                <div className="engine-empty">
                  <div className="engine-empty-desc">Not enough athletes here yet — time-trial boards open at 5 athletes per equipment.</div>
                </div>
              ) : (
                <>
                  <select
                    value={bucketKey}
                    onChange={(e) => setBucketKey(e.target.value)}
                    className="engine-input"
                    style={{ width: '100%', marginBottom: 12 }}
                  >
                    {buckets.map((b) => (
                      <option key={`${b.modality}|${b.units}`} value={`${b.modality}|${b.units}`}>
                        {labelModality(b.modality)} · {b.units} ({b.athletes})
                      </option>
                    ))}
                  </select>
                  <p className="engine-subheader" style={{ marginBottom: 8 }}>
                    Ranked by pace ({bucketKey.split('|')[1]}/min) on the current time trial.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {ttLoading
                      ? <div className="engine-empty-desc">Loading…</div>
                      : ttRows.length === 0
                        ? <div className="engine-empty-desc">Not enough athletes in this bucket yet.</div>
                        : ttRows.map((r) => renderRow(
                            r.rnk, r.display_name,
                            `${Number(r.rpm).toFixed(1)} ${bucketKey.split('|')[1]}/min`,
                            r.is_viewer, r.rnk))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="engine-section">
              {buckets.length === 0 ? (
                <div className="engine-empty">
                  <div className="engine-empty-desc">Not enough athletes here yet — leaderboards open at 5 athletes per equipment.</div>
                </div>
              ) : (
                <>
                  <select
                    value={bucketKey}
                    onChange={(e) => setBucketKey(e.target.value)}
                    className="engine-input"
                    style={{ width: '100%', marginBottom: 12 }}
                  >
                    {buckets.map((b) => (
                      <option key={`${b.modality}|${b.units}`} value={`${b.modality}|${b.units}`}>
                        {labelModality(b.modality)} · {b.units} ({b.athletes})
                      </option>
                    ))}
                  </select>
                  <p className="engine-subheader" style={{ marginBottom: 8 }}>
                    Ranked by % pace improvement from your first time trial to your best, on this equipment.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {impLoading
                      ? <div className="engine-empty-desc">Loading…</div>
                      : impRows.length === 0
                        ? <div className="engine-empty-desc">Not enough athletes with 2+ time trials in this bucket yet.</div>
                        : impRows.map((r) => renderRow(
                            r.rnk, r.display_name,
                            `+${Number(r.improvement_pct).toFixed(1)}%`,
                            r.is_viewer, r.rnk,
                            `${Number(r.first_rpm).toFixed(0)} → ${Number(r.best_rpm).toFixed(0)} ${bucketKey.split('|')[1]}/min`))}
                  </div>
                </>
              )}
            </div>
          )}

          <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            Your name is shown on these boards.{' '}
            <button
              onClick={() => navigate('/settings')}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
            >
              Appear as Anonymous in Settings
            </button>.
          </p>
        </div>
      </div>
    </div>
  );
}
