// F5 — free read-only gym Engine Class view (GYM_PORTAL_FLOWS §F5) + seat-member
// result logging (F4 input). Renders today's shared workout for a gated member; a
// non-gated member gets the leak-safe "ask the front desk" teaser (no programming).
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EngineClassBlocks, { type ClassBlock } from '../components/EngineClassBlocks';

interface ViewResponse {
  access: 'none' | 'gym';
  cta?: string;
  gym_name?: string | null;
  class_name?: string | null;
  cohort_program_id?: string;
  can_log?: boolean;
  workout?: {
    week_num: number; day_num: number; modality: string | null;
    score_type: 'for_time' | 'amrap' | 'load' | 'rounds_reps' | 'other';
    blocks: ClassBlock[];
  } | null;
  message?: string;
}

export default function GymClassPage() {
  const [data, setData] = useState<ViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1); // bump → refetch (e.g. after logging)

  // Fetch effect: setState only after the await (no synchronous setState in body).
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.functions.invoke('engine-class-view', { body: {} });
      if (!live) return;
      setLoading(false);
      if (error) { setError(error.message || 'Could not load your class.'); return; }
      setError(null);
      setData(data as ViewResponse);
    })();
    return () => { live = false; };
  }, [reloadKey]);

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '1.5rem 1.25rem 5rem' }}>
      <div style={{ fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }}>
        The Gains Lab · Engine Class
      </div>
      <h1 style={{ fontSize: 24, margin: '0.3rem 0 1rem' }}>
        {data?.gym_name ? `${data.gym_name}${data.class_name ? ` · ${data.class_name}` : ''}` : "Today's class"}
      </h1>

      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}
      {error && <p style={{ color: '#c0392b' }}>{error}</p>}

      {data?.access === 'none' && (
        <div style={teaser}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Your gym runs an Engine Class</h2>
          <p style={{ opacity: 0.8 }}>{data.cta ?? 'Ask the front desk to activate your seat.'}</p>
        </div>
      )}

      {data?.access === 'gym' && !data.workout && (
        <p style={{ opacity: 0.7 }}>{data.message ?? "No class workout scheduled yet."}</p>
      )}

      {data?.access === 'gym' && data.workout && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              Week {data.workout.week_num} · Day {data.workout.day_num}
              {data.workout.modality ? ` · ${data.workout.modality}` : ''}
            </div>
            <Link to="/gym/leaderboard" style={linkBtn}>Leaderboard →</Link>
          </div>

          <EngineClassBlocks blocks={data.workout.blocks} />

          <div style={{ fontSize: 12, opacity: 0.55, margin: '0.75rem 0 1.25rem' }}>
            Loads shown are Rx. Your personalized scaling is coming soon — for now, scale to your ability.
          </div>

          {data.can_log && data.workout.score_type !== 'other' && (
            <LogForm scoreType={data.workout.score_type} onLogged={reload} />
          )}
        </>
      )}
    </div>
  );
}

function LogForm({ scoreType, onLogged }: { scoreType: string; onLogged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [reps, setReps] = useState('');
  const [rounds, setRounds] = useState('');
  const [partial, setPartial] = useState('');
  const [load, setLoad] = useState('');
  const [loadUnit, setLoadUnit] = useState<'lbs' | 'kg'>('lbs');
  const [rx, setRx] = useState(true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const body: Record<string, unknown> = { rx };
    if (scoreType === 'for_time') body.time_seconds = (parseInt(minutes || '0', 10) * 60) + parseInt(seconds || '0', 10);
    else if (scoreType === 'amrap') body.score_reps = parseInt(reps || '0', 10);
    else if (scoreType === 'rounds_reps') { body.rounds = parseInt(rounds || '0', 10); body.reps = parseInt(partial || '0', 10); }
    else if (scoreType === 'load') { body.load = parseFloat(load || '0'); body.load_unit = loadUnit; }

    const { error } = await supabase.functions.invoke('engine-class-log', { body });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not log your result.'); return; }
    setMsg('Result logged — you\'re on the leaderboard.');
    onLogged();
  }

  return (
    <form onSubmit={submit} style={logBox}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Log your result</div>
      {scoreType === 'for_time' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={input} inputMode="numeric" placeholder="min" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <span>:</span>
          <input style={input} inputMode="numeric" placeholder="sec" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        </div>
      )}
      {scoreType === 'amrap' && (
        <input style={input} inputMode="numeric" placeholder="total reps" value={reps} onChange={(e) => setReps(e.target.value)} />
      )}
      {scoreType === 'rounds_reps' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={input} inputMode="numeric" placeholder="rounds" value={rounds} onChange={(e) => setRounds(e.target.value)} />
          <span>+</span>
          <input style={input} inputMode="numeric" placeholder="reps" value={partial} onChange={(e) => setPartial(e.target.value)} />
        </div>
      )}
      {scoreType === 'load' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={input} inputMode="decimal" placeholder="load" value={load} onChange={(e) => setLoad(e.target.value)} />
          <select value={loadUnit} onChange={(e) => setLoadUnit(e.target.value as 'lbs' | 'kg')} style={input}>
            <option value="lbs">lbs</option><option value="kg">kg</option>
          </select>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
        <input type="checkbox" checked={rx} onChange={(e) => setRx(e.target.checked)} /> Rx
      </label>
      <button style={primaryBtn} disabled={busy} type="submit">{busy ? 'Saving…' : 'Log result'}</button>
      {msg && <p style={{ color: '#2e7d32', fontSize: 13 }}>{msg}</p>}
      {err && <p style={{ color: '#c0392b', fontSize: 13 }}>{err}</p>}
    </form>
  );
}

const teaser: React.CSSProperties = { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '1.25rem' };
const logBox: React.CSSProperties = { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '1rem', marginTop: 8 };
const input: React.CSSProperties = { padding: '0.5rem 0.6rem', borderRadius: 8, border: '1px solid rgba(128,128,128,0.35)', fontSize: 15, width: 90 };
const primaryBtn: React.CSSProperties = { padding: '0.6rem 1rem', borderRadius: 8, border: 'none', background: '#111', color: '#fff', fontWeight: 600, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { fontSize: 13, textDecoration: 'none', color: '#2563eb', fontWeight: 600 };
