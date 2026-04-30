import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

type Tab = 'overview' | 'engagement' | 'users';

// ── Shared Components ──

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="admin-stat-card">
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--accent)', marginTop: 32, marginBottom: 12 }}>
      {children}
    </h3>
  );
}

function FeatureBadge({ feature }: { feature: string }) {
  const colors: Record<string, string> = {
    ai_chat: '#2ec486',
    nutrition: '#6ea8fe',
    programming: 'var(--accent)',
    engine: '#f0a050',
  };
  const color = colors[feature] || '#666';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
      color, background: color + '20',
      padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
    }}>
      {feature.replace(/_/g, ' ')}
    </span>
  );
}

// ── Main Component ──

export default function AdminPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [error, setError] = useState('');

  // Overview data
  const [overviewStats, setOverviewStats] = useState<any>(null);

  // Engagement data
  const [featureUsage, setFeatureUsage] = useState<any>(null);
  const [engagementPeriod, setEngagementPeriod] = useState(30);

  // Users data
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => {
        setRole(data?.role || 'user');
        if (data?.role === 'admin') loadTab('overview');
        else setLoading(false);
      });
  }, []);

  const loadTab = async (tab: Tab) => {
    setError('');
    setLoading(true);
    try {
      switch (tab) {
        case 'overview': {
          const { data, error } = await supabase.rpc('admin_overview_stats');
          if (error) throw new Error(error.message);
          setOverviewStats(data);
          break;
        }
        case 'engagement': {
          const { data, error } = await supabase.rpc('admin_feature_usage', { days_back: engagementPeriod });
          if (error) throw new Error(error.message);
          setFeatureUsage(data);
          break;
        }
        case 'users': {
          const { data, error } = await supabase.rpc('admin_user_list_v2');
          if (error) throw new Error(error.message);
          setUsers(data || []);
          break;
        }
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    loadTab(tab);
  };

  // Access denied
  if (role !== null && role !== 'admin') {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>Admin</h1>
          </header>
          <div className="page-body">
            <div className="empty-state"><p>Access denied. Admin role required.</p></div>
          </div>
        </div>
      </div>
    );
  }

  // Filtered users
  const filteredUsers = userSearch
    ? users.filter(u =>
        (u.full_name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(userSearch.toLowerCase())
      )
    : users;

  const maxTrend = featureUsage?.chat_by_day
    ? Math.max(...featureUsage.chat_by_day.map((d: any) => d.questions), 1)
    : 1;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Admin</h1>
          <div className="source-toggle" style={{ marginLeft: 'auto' }}>
            {(['overview', 'engagement', 'users'] as const).map(tab => (
              <button
                key={tab}
                className={'source-btn ' + (activeTab === tab ? 'active' : '')}
                onClick={() => switchTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> :

            /* ===== Overview Tab ===== */
            activeTab === 'overview' && overviewStats ? (
              <>
                <SectionHeader>Active Users</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Today" value={overviewStats.active_today} />
                  <StatCard label="7 Days" value={overviewStats.active_7d} />
                  <StatCard label="30 Days" value={overviewStats.active_30d} />
                  <StatCard label="Total Users" value={overviewStats.total_users} />
                </div>

                <SectionHeader>Signups</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Last 7 Days" value={overviewStats.new_signups_7d} />
                  <StatCard label="Last 30 Days" value={overviewStats.new_signups_30d} />
                </div>

                <SectionHeader>Entitlements</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Users with Access" value={overviewStats.users_with_entitlements} sub={`of ${overviewStats.total_users} total`} />
                  {overviewStats.entitled_users && overviewStats.entitled_users.map((e: any) => (
                    <StatCard key={e.feature} label={e.feature.replace(/_/g, ' ')} value={e.count} />
                  ))}
                </div>

                <SectionHeader>Profile → Program Funnel</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Profiles with Lifts" value={overviewStats.profiles_with_lifts} />
                  <StatCard label="With Evaluation" value={overviewStats.profiles_with_evaluation} />
                  <StatCard label="With Program" value={overviewStats.profiles_with_program} />
                </div>
              </>
            ) :

            /* ===== Engagement Tab ===== */
            activeTab === 'engagement' && featureUsage ? (
              <>
                {/* Period selector */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                  {[7, 30, 90].map(d => (
                    <button
                      key={d}
                      className={'source-btn ' + (engagementPeriod === d ? 'active' : '')}
                      onClick={() => { setEngagementPeriod(d); loadTab('engagement'); }}
                    >
                      {d}d
                    </button>
                  ))}
                </div>

                <SectionHeader>Chat</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Questions" value={featureUsage.chat_questions} />
                  <StatCard label="Users" value={featureUsage.chat_users} />
                  <StatCard label="Input Tokens" value={Number(featureUsage.total_input_tokens).toLocaleString()} />
                  <StatCard label="Output Tokens" value={Number(featureUsage.total_output_tokens).toLocaleString()} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => navigate('/admin/ratings')}
                    style={{
                      background: 'var(--accent-glow)', color: 'var(--accent)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      fontFamily: "'Outfit', sans-serif",
                    }}
                  >
                    View Chat Ratings →
                  </button>
                </div>

                {/* Daily trend */}
                {featureUsage.chat_by_day && featureUsage.chat_by_day.length > 0 && (
                  <>
                    <SectionHeader>Daily Questions</SectionHeader>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {featureUsage.chat_by_day.map((d: any) => (
                        <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)', width: 52, flexShrink: 0 }}>
                            {new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                          </span>
                          <div className="admin-trend-bar" style={{ width: Math.max(2, (d.questions / maxTrend) * 200) }} />
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)', width: 24 }}>{d.questions}</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-muted)' }}>{d.users}u</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <SectionHeader>Engine</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Sessions" value={featureUsage.engine_sessions} />
                  <StatCard label="Users" value={featureUsage.engine_users} />
                </div>

                <SectionHeader>Nutrition</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Entries" value={featureUsage.nutrition_entries} />
                  <StatCard label="Users" value={featureUsage.nutrition_users} />
                  <StatCard label="Days Logged" value={featureUsage.nutrition_days_logged} />
                </div>

                <SectionHeader>Programs & Workouts</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Programs Generated" value={featureUsage.programs_generated} />
                  <StatCard label="Evaluations Run" value={featureUsage.evaluations_run} />
                  <StatCard label="Workouts Logged" value={featureUsage.workouts_logged} />
                  <StatCard label="Workout Users" value={featureUsage.workout_users} />
                </div>
              </>
            ) :

            /* ===== Users Tab ===== */
            activeTab === 'users' ? (
              <>
                {/* Search */}
                <div style={{ marginBottom: 16 }}>
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 14px', fontSize: 14,
                      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                      color: 'var(--text)', fontFamily: "'Outfit', sans-serif",
                    }}
                  />
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filteredUsers.map(u => (
                    <div
                      key={u.id}
                      onClick={() => navigate(`/admin/users/${u.id}`)}
                      style={{
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                        padding: '14px 18px', cursor: 'pointer', transition: 'border-color .15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-light)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{u.full_name || 'No name'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                        </div>
                        {(() => {
                          // Email outreach indicator. Red = never, Yellow = stale (>14d), Green = recent (<=14d).
                          const count = Number(u.email_count ?? 0);
                          const lastAt = u.last_email_at ? new Date(u.last_email_at) : null;
                          const daysSince = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86400000) : null;
                          const color = count === 0
                            ? 'var(--danger, #e74c3c)'
                            : daysSince != null && daysSince > 14
                              ? '#f1c40f'
                              : '#2ec486';
                          const tooltip = count === 0
                            ? 'Never emailed'
                            : `${count} email${count !== 1 ? 's' : ''} · last ${lastAt!.toLocaleDateString()} (${daysSince}d ago)`;
                          return (
                            <span
                              title={tooltip}
                              aria-label={tooltip}
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: color,
                                flexShrink: 0,
                                display: 'inline-block',
                              }}
                            />
                          );
                        })()}
                        {u.role === 'admin' && (
                          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 4 }}>Admin</span>
                        )}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                      </div>

                      {/* Entitlements */}
                      {u.entitlements && u.entitlements.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                          {u.entitlements.map((f: string) => <FeatureBadge key={f} feature={f} />)}
                        </div>
                      )}

                      {/* Activity summary */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {u.question_count > 0 && <span>{u.question_count} questions</span>}
                        {u.engine_sessions_count > 0 && <span>{u.engine_sessions_count} engine</span>}
                        {u.nutrition_days_logged > 0 && <span>{u.nutrition_days_logged}d nutrition</span>}
                        {u.workouts_logged > 0 && <span>{u.workouts_logged} workouts</span>}
                        {u.programs_count > 0 && <span>{u.programs_count} program{u.programs_count > 1 ? 's' : ''}</span>}
                        {u.last_active && (
                          <span>last active {new Date(u.last_active).toLocaleDateString()}</span>
                        )}
                        {!u.last_active && <span>never active</span>}
                      </div>
                    </div>
                  ))}
                  {filteredUsers.length === 0 && <div className="empty-state"><p>No users found.</p></div>}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
