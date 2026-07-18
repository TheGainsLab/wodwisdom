import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

/**
 * /admin/reports — the reading room (reporting layer piece 3).
 *
 * Renders on demand what the emails deliver on schedule: weekly digest
 * history (trends from digest_runs), the subscriber-health table (the
 * repeatable ghost audit), the cohort funnel, and last month's revenue.
 * All reads via the admin_report_* RPCs (is_current_user_admin-gated).
 */

interface DigestRun { run_at: string; stats: Record<string, any> }
interface HealthRow {
  user_id: string; email: string | null; full_name: string | null;
  features: string[] | null; source_kinds: string[] | null;
  signup_at: string; last_sign_in_at: string | null;
  last_training_at: string; last_any_activity_at: string;
  pwa_installed: boolean;
  engine_sessions: number; workouts: number; nutrition_entries: number; chat_questions: number;
}
interface CohortRow {
  cohort_week: string; signups: number; evaluated: number;
  opened_checkout: number; purchased: number; sources: Record<string, number>;
}

const EPOCH_CUTOFF = new Date('1971-01-01').getTime();

function d(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  return t.getTime() < EPOCH_CUTOFF ? 'never' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

function daysAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (t < EPOCH_CUTOFF) return 'never';
  const days = Math.floor((Date.now() - t) / 86400000);
  return days === 0 ? 'today' : `${days}d ago`;
}

const kv = (obj: Record<string, number> | undefined | null) =>
  obj ? Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(' · ') || '—' : '—';

const thStyle: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '2px solid var(--border)', textAlign: 'left',
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 13, whiteSpace: 'nowrap',
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: sub ? 2 : 12 }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>{sub}</p>}
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

export default function AdminReportsPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [adminCheck, setAdminCheck] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [runs, setRuns] = useState<DigestRun[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [revenue, setRevenue] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single();
      const allowed = profile?.role === 'admin';
      setAdminCheck(allowed ? 'allowed' : 'denied');
      if (!allowed) return;

      const [r1, r2, r3, r4] = await Promise.all([
        supabase.rpc('admin_report_digest_history', { p_limit: 12 }),
        supabase.rpc('admin_report_subscriber_health'),
        supabase.rpc('admin_report_cohorts', { p_weeks: 8 }),
        supabase.rpc('admin_report_monthly_revenue'),
      ]);
      const firstError = r1.error ?? r2.error ?? r3.error ?? r4.error;
      if (firstError) setError(firstError.message);
      setRuns((r1.data as DigestRun[]) ?? []);
      setHealth((r2.data as HealthRow[]) ?? []);
      setCohorts((r3.data as CohortRow[]) ?? []);
      setRevenue((r4.data as Record<string, any>) ?? null);
    })();
  }, [session.user.id]);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Reports</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            {adminCheck === 'checking' && <div className="page-loading"><div className="loading-pulse" /></div>}
            {adminCheck === 'denied' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, color: 'var(--text-dim)', fontSize: 14, textAlign: 'center' }}>
                You need admin access to view this page.
              </div>
            )}
            {adminCheck === 'allowed' && (
              <>
                {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

                <Section title="Weekly trend" sub="One row per digest run (Mondays + manual runs). History accumulates from Jul 18, 2026.">
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr>
                      <th style={thStyle}>Run</th><th style={thStyle}>Active</th><th style={thStyle}>Signups</th>
                      <th style={thStyle}>Evals</th><th style={thStyle}>Checkout people</th><th style={thStyle}>Purchases</th>
                      <th style={thStyle}>Abandoners</th><th style={thStyle}>Not logging</th><th style={thStyle}>Ghosting</th>
                    </tr></thead>
                    <tbody>
                      {runs.length === 0 && <tr><td style={tdStyle} colSpan={9}>No runs recorded yet — the next digest run (or a manual curl) writes the first row.</td></tr>}
                      {runs.map((r) => (
                        <tr key={r.run_at}>
                          <td style={tdStyle}>{d(r.run_at)}</td>
                          <td style={tdStyle}>{r.stats?.active_users?.this_week ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.signups_7d ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.evals_7d ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.checkouts?.people ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.checkouts?.completed ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.abandoners_total ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.engagement?.not_logging_total ?? '—'}</td>
                          <td style={tdStyle}>{r.stats?.engagement?.ghosting_total ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title="Subscriber health" sub="Every active entitled user, least-recently-active last. 'stripe' source = live subscription; anything else = legacy grant (possible zombie).">
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr>
                      <th style={thStyle}>Who</th><th style={thStyle}>Features</th><th style={thStyle}>Source</th>
                      <th style={thStyle}>Signed up</th><th style={thStyle}>Last sign-in</th><th style={thStyle}>Last activity</th>
                      <th style={thStyle}>Sessions</th><th style={thStyle}>Workouts</th><th style={thStyle}>PWA</th>
                    </tr></thead>
                    <tbody>
                      {health.length === 0 && <tr><td style={tdStyle} colSpan={9}>No active subscribers found.</td></tr>}
                      {health.map((h) => (
                        <tr key={h.user_id}>
                          <td style={tdStyle}>{h.email ?? h.user_id}</td>
                          <td style={tdStyle}>{(h.features ?? []).join(', ')}</td>
                          <td style={tdStyle}>{(h.source_kinds ?? []).join(', ')}</td>
                          <td style={tdStyle}>{d(h.signup_at)}</td>
                          <td style={tdStyle}>{daysAgo(h.last_sign_in_at)}</td>
                          <td style={tdStyle}>{daysAgo(h.last_any_activity_at)}</td>
                          <td style={tdStyle}>{h.engine_sessions}</td>
                          <td style={tdStyle}>{h.workouts}</td>
                          <td style={tdStyle}>{h.pwa_installed ? '✓' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title="Cohort funnel" sub="Per signup week: how far each cohort travelled. Acquisition sources fill in as tagged traffic arrives.">
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr>
                      <th style={thStyle}>Week of</th><th style={thStyle}>Signups</th><th style={thStyle}>Evaluated</th>
                      <th style={thStyle}>Opened checkout</th><th style={thStyle}>Purchased</th><th style={thStyle}>Sources</th>
                    </tr></thead>
                    <tbody>
                      {cohorts.length === 0 && <tr><td style={tdStyle} colSpan={6}>No signups in the window.</td></tr>}
                      {cohorts.map((c) => (
                        <tr key={c.cohort_week}>
                          <td style={tdStyle}>{d(c.cohort_week)}</td>
                          <td style={tdStyle}>{c.signups}</td>
                          <td style={tdStyle}>{c.evaluated}</td>
                          <td style={tdStyle}>{c.opened_checkout}</td>
                          <td style={tdStyle}>{c.purchased}</td>
                          <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{kv(c.sources)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title={`Revenue — ${revenue?.month ?? 'last month'}`} sub="From the billing ledger (began Jul 18, 2026 — August is the first full month).">
                  {revenue ? (
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <tbody>
                        <tr><td style={tdStyle}>New subscriptions</td><td style={tdStyle}><strong>{revenue.purchases?.count ?? 0}</strong></td></tr>
                        <tr><td style={tdStyle}>…by plan</td><td style={tdStyle}>{kv(revenue.purchases?.by_plan)}</td></tr>
                        <tr><td style={tdStyle}>…by currency</td><td style={tdStyle}>{kv(revenue.purchases?.by_currency)}</td></tr>
                        <tr><td style={tdStyle}>Churn — chose to leave</td><td style={tdStyle}>{revenue.churn?.voluntary ?? 0}{revenue.churn?.avg_tenure_days != null ? ` (avg tenure ${revenue.churn.avg_tenure_days}d)` : ''}</td></tr>
                        <tr><td style={tdStyle}>Churn — payment died</td><td style={tdStyle}>{revenue.churn?.involuntary ?? 0}</td></tr>
                        <tr><td style={tdStyle}>Payment failures</td><td style={tdStyle}>{revenue.payment_failures ?? 0}</td></tr>
                        <tr><td style={tdStyle}>Refunds</td><td style={tdStyle}>{revenue.refunds?.count ?? 0} ({((revenue.refunds?.amount_cents ?? 0) / 100).toFixed(2)})</td></tr>
                        <tr><td style={tdStyle}>Disputes</td><td style={tdStyle}>{revenue.disputes ?? 0}</td></tr>
                        <tr><td style={tdStyle}>Plan changes</td><td style={tdStyle}>{revenue.plan_changes ?? 0}</td></tr>
                      </tbody>
                    </table>
                  ) : <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading…</p>}
                </Section>
              </>
            )}
            <div style={{ height: 40 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
