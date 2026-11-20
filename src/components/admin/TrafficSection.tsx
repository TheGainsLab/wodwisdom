import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Traffic — the public pages' visitors, for /admin/reports.
 *
 * Reads admin_report_traffic(p_days) (visitor_events + the visit id carried
 * in signup metadata). Signed-out visits only; crawlers that identify
 * themselves and admin browsers are never recorded, so they are not here.
 * A visit is one browser tab's session, not a person.
 */

interface Row { name: string; visits: number; reached_signup: number; accounts: number }
interface PageRow { name: string; views: number; visits: number }
interface CalcRow { name: string; uses: number }
interface Traffic {
  days: number;
  visits: number;
  single_page_visits: number;
  page_views: number;
  reached_signup: number;
  accounts: number;
  accounts_unmatched: number;
  by_source: Row[];
  by_landing: Row[];
  by_device: Record<string, number>;
  top_pages: PageRow[];
  calculators: CalcRow[];
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 };
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 13, whiteSpace: 'nowrap' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const h3: React.CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', margin: '18px 0 6px' };

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function FunnelTable({ title, first, rows }: { title: string; first: string; rows: Row[] }) {
  return (
    <>
      <h3 style={h3}>{title}</h3>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing yet.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>{first}</th>
              <th style={{ ...th, textAlign: 'right' }}>Visits</th>
              <th style={{ ...th, textAlign: 'right' }}>Reached sign-up</th>
              <th style={{ ...th, textAlign: 'right' }}>Accounts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td style={{ ...td, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.name}</td>
                <td style={num}>{r.visits}</td>
                <td style={num}>{r.reached_signup}</td>
                <td style={num}>{r.accounts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function TrafficSection() {
  const [days, setDays] = useState<7 | 30>(7);
  // Keyed by the window it was loaded for, so switching windows shows
  // "Loading…" rather than the other window's numbers.
  const [loaded, setLoaded] = useState<{ days: number; data: Traffic | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('admin_report_traffic', { p_days: days }).then(({ data, error }) => {
      if (cancelled) return;
      setLoaded({ days, data: error ? null : (data as Traffic), error: error ? error.message : null });
    });
    return () => { cancelled = true; };
  }, [days]);

  const current = loaded && loaded.days === days ? loaded : null;
  const t = current?.data ?? null;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Traffic — last {days} days</h2>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              style={{
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '5px 12px',
                background: days === d ? 'var(--text)' : 'transparent', color: days === d ? 'var(--bg, #09090b)' : 'var(--text-dim)',
              }}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 14px' }}>
        Signed-out visitors to the public pages. A visit is one browser tab, not a person. Crawlers that identify
        themselves and admin browsers are not recorded.
      </p>

      {!current && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}
      {current?.error && <div style={{ fontSize: 13, color: 'var(--accent)' }}>Could not load traffic: {current.error}</div>}

      {t && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <Stat label="Visits" value={t.visits} sub={`${t.page_views} page views`} />
            <Stat label="Looked at one page only" value={t.single_page_visits} sub={pct(t.single_page_visits, t.visits) + ' of visits'} />
            <Stat label="Reached sign-up" value={t.reached_signup} sub={pct(t.reached_signup, t.visits) + ' of visits'} />
            <Stat label="Created an account" value={t.accounts} sub={pct(t.accounts, t.visits) + ' of visits'} />
          </div>
          {t.accounts_unmatched > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
              {t.accounts_unmatched} more account{t.accounts_unmatched === 1 ? '' : 's'} came from a visit outside this window.
            </p>
          )}

          <h3 style={h3}>Device</h3>
          <div style={{ fontSize: 13 }}>
            {Object.keys(t.by_device).length === 0
              ? <span style={{ color: 'var(--text-muted)' }}>Nothing yet.</span>
              : Object.entries(t.by_device).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n} (${pct(n, t.visits)})`).join(' · ')}
          </div>

          <FunnelTable title="Where visits came from" first="Source" rows={t.by_source} />
          <FunnelTable title="First page of the visit" first="Landing page" rows={t.by_landing} />

          <h3 style={h3}>Most viewed pages</h3>
          {t.top_pages.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing yet.</div>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Page</th>
                  <th style={{ ...th, textAlign: 'right' }}>Views</th>
                  <th style={{ ...th, textAlign: 'right' }}>Visits</th>
                </tr>
              </thead>
              <tbody>
                {t.top_pages.map((p) => (
                  <tr key={p.name}>
                    <td style={td}>{p.name}</td>
                    <td style={num}>{p.views}</td>
                    <td style={num}>{p.visits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={h3}>Calculator use (signed in or out)</h3>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            {t.calculators.length === 0
              ? <span style={{ color: 'var(--text-muted)' }}>Nothing yet.</span>
              : t.calculators.map((c) => `${c.name} ×${c.uses}`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}
