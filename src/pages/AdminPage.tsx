import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

type Tab = 'overview' | 'users' | 'knowledge' | 'gyms';

interface OverviewData {
  stats: any;
  trend: { day: string; question_count: number; unique_users: number }[];
  topUsers: { user_id: string; full_name: string; email: string; question_count: number; total_tokens: number }[];
  chunks: { journal: number; science: number };
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  subscription_status: string;
  question_count: number;
  total_tokens: number;
  last_active: string | null;
}

interface KBData {
  journal_chunks: number;
  science_chunks: number;
  sources: { title: string; category: string; chunks: number }[];
}

interface GymRow {
  id: string;
  name: string;
  max_seats: number;
  created_at: string;
  owner_name: string;
  owner_email: string;
  member_count: number;
}

interface GymMember {
  id: string;
  invited_email: string;
  user_id: string | null;
  status: string;
  full_name: string;
  created_at: string;
}

async function adminFetch(supabase: import('@supabase/supabase-js').SupabaseClient, action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('admin-data', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || 'Admin request failed');
  if (data?.error) throw new Error(data.error || 'Admin request failed');
  return data;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="admin-stat-card">
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

const statusColor = (s: string) => s === 'active' ? '#2ec486' : s === 'invited' ? '#f0a050' : '#666';

export default function AdminPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Tab data
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [kb, setKb] = useState<KBData | null>(null);
  const [gyms, setGyms] = useState<GymRow[]>([]);
  const [expandedGym, setExpandedGym] = useState<string | null>(null);
  const [gymMembers, setGymMembers] = useState<Record<string, GymMember[]>>({});

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
    try {
      switch (tab) {
        case 'overview': {
          const data = await adminFetch(supabase, 'get_overview');
          setOverview(data);
          break;
        }
        case 'users': {
          const data = await adminFetch(supabase, 'get_users');
          setUsers(data.users || []);
          break;
        }
        case 'knowledge': {
          const data = await adminFetch(supabase, 'get_knowledge_base');
          setKb(data);
          break;
        }
        case 'gyms': {
          const data = await adminFetch(supabase, 'get_gyms');
          setGyms(data.gyms || []);
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
    setLoading(true);
    loadTab(tab);
  };

  const updateUser = async (userId: string, field: string, value: string) => {
    setError(''); setSuccess('');
    try {
      await adminFetch(supabase, 'update_user', { user_id: userId, field, value });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field]: value } : u));
      setSuccess('Updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleGym = async (gymId: string) => {
    if (expandedGym === gymId) { setExpandedGym(null); return; }
    setExpandedGym(gymId);
    if (!gymMembers[gymId]) {
      try {
        const data = await adminFetch(supabase, 'get_gym_members', { gym_id: gymId });
        setGymMembers(prev => ({ ...prev, [gymId]: data.members || [] }));
      } catch (e: any) {
        setError(e.message);
      }
    }
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

  const maxTrend = overview?.trend ? Math.max(...overview.trend.map(d => d.question_count), 1) : 1;

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
            {(['overview', 'users', 'knowledge', 'gyms'] as const).map(tab => (
              <button
                key={tab}
                className={'source-btn ' + (activeTab === tab ? 'active' : '')}
                onClick={() => switchTab(tab)}
              >
                {tab === 'knowledge' ? 'KB' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}
            {success && <div style={{ background: 'rgba(46,196,134,0.1)', border: '1px solid rgba(46,196,134,0.25)', color: '#2ec486', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{success}</div>}

            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> :

            /* ===== Overview Tab ===== */
            activeTab === 'overview' && overview ? (
              <>
                <div className="admin-stats-grid">
                  <StatCard label="Total Questions" value={overview.stats.total_questions} />
                  <StatCard label="Today" value={overview.stats.today_questions} />
                  <StatCard label="This Week" value={overview.stats.week_questions} />
                  <StatCard label="This Month" value={overview.stats.month_questions} />
                  <StatCard label="Active Today" value={overview.stats.active_users_today} />
                  <StatCard label="Active (Week)" value={overview.stats.active_users_week} />
                  <StatCard label="Total Users" value={overview.stats.total_users} />
                  <StatCard label="Bookmarks" value={overview.stats.total_bookmarks} />
                  <StatCard label="Tokens (Total)" value={(overview.stats.total_input_tokens + overview.stats.total_output_tokens).toLocaleString()} />
                  <StatCard label="Tokens (Today)" value={(overview.stats.today_input_tokens + overview.stats.today_output_tokens).toLocaleString()} />
                  <StatCard label="Journal Chunks" value={overview.chunks.journal} />
                  <StatCard label="Science Chunks" value={overview.chunks.science} />
                </div>

                <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 32, marginBottom: 12 }}>
                  Top Users
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {overview.topUsers.map((u, i) => (
                    <div key={u.user_id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>#{i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{u.full_name || u.email}</div>
                        {u.full_name && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>}
                      </div>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{u.question_count}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)' }}>{u.total_tokens.toLocaleString()} tok</span>
                    </div>
                  ))}
                </div>

                <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 32, marginBottom: 12 }}>
                  Daily Trend (30 days)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {overview.trend.map(d => (
                    <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)', width: 52, flexShrink: 0 }}>
                        {new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                      </span>
                      <div className="admin-trend-bar" style={{ width: Math.max(2, (d.question_count / maxTrend) * 200) }} />
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)', width: 24 }}>{d.question_count}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-muted)' }}>{d.unique_users}u</span>
                    </div>
                  ))}
                </div>
              </>
            ) :

            /* ===== Users Tab ===== */
            activeTab === 'users' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {users.map(u => (
                  <div key={u.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{u.full_name || 'No name'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                    </div>
                    <select
                      value={u.role}
                      onChange={e => updateUser(u.id, 'role', e.target.value)}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text)', fontFamily: "'Outfit', sans-serif", fontSize: 12 }}
                    >
                      <option value="user">User</option>
                      <option value="coach">Coach</option>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => updateUser(u.id, 'subscription_status', u.subscription_status === 'active' ? 'inactive' : 'active')}
                      style={{
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                        color: u.subscription_status === 'active' ? '#2ec486' : '#666',
                        background: (u.subscription_status === 'active' ? '#2ec486' : '#666') + '20',
                        padding: '3px 10px', borderRadius: 4,
                        border: 'none', cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
                      }}
                    >
                      {u.subscription_status || 'inactive'}
                    </button>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)' }}>
                      {u.question_count} Q
                    </span>
                    {u.last_active && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(u.last_active).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
                {users.length === 0 && <div className="empty-state"><p>No users found.</p></div>}
              </div>
            ) :

            /* ===== Knowledge Base Tab ===== */
            activeTab === 'knowledge' && kb ? (
              <>
                <div className="admin-stats-grid" style={{ maxWidth: 400, marginBottom: 24 }}>
                  <StatCard label="Journal Chunks" value={kb.journal_chunks} />
                  <StatCard label="Science Chunks" value={kb.science_chunks} />
                </div>
                <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Sources ({kb.sources.length} titles)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {kb.sources.map((s, i) => (
                    <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                          color: s.category === 'science' ? '#6ea8fe' : 'var(--accent)',
                          background: (s.category === 'science' ? '#6ea8fe' : 'var(--accent)') + '15',
                          padding: '2px 6px', borderRadius: 3,
                        }}>
                          {s.category}
                        </span>
                      </div>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {s.chunks}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) :

            /* ===== Gyms Tab ===== */
            activeTab === 'gyms' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {gyms.map(g => (
                  <div key={g.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => toggleGym(g.id)}
                    >
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{g.name}</div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>
                          Owner: {g.owner_name} &middot; {g.member_count}/{g.max_seats} seats &middot; {new Date(g.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transition: 'transform .2s', transform: expandedGym === g.id ? 'rotate(180deg)' : 'none', flexShrink: 0, color: 'var(--text-muted)' }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                    {expandedGym === g.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {!gymMembers[g.id] ? (
                          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
                        ) : gymMembers[g.id].length === 0 ? (
                          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No members</div>
                        ) : gymMembers[g.id].map(m => (
                          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{m.full_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.invited_email}</div>
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: statusColor(m.status), background: statusColor(m.status) + '20', padding: '2px 8px', borderRadius: 4 }}>
                              {m.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {gyms.length === 0 && <div className="empty-state"><p>No gyms found.</p></div>}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
