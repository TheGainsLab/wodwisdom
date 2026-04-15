import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="admin-stat-card">
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 8 }}>
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
    <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 32, marginBottom: 12 }}>
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

export default function AdminUserDetailPage({ session: _session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data: result, error: err } = await supabase.rpc('admin_user_detail', { target_user_id: id });
      if (err) { setError(err.message); setLoading(false); return; }
      setData(result);
      setLoading(false);
    })();
  }, [id]);

  const profile = data?.profile;
  const athlete = data?.athlete_profile;
  const chat = data?.chat;
  const engine = data?.engine;
  const nutrition = data?.nutrition;
  const workouts = data?.workouts;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>User Detail</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {/* Back button */}
            <button
              onClick={() => navigate('/admin')}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, fontFamily: "'Outfit', sans-serif", padding: '4px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back to Users
            </button>

            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> : data ? (
              <>
                {/* Account Info */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>
                      {(profile?.full_name?.[0] || profile?.email?.[0] || '?').toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{profile?.full_name || 'No name'}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{profile?.email}</div>
                    </div>
                    {profile?.role === 'admin' && (
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 4, marginLeft: 'auto' }}>Admin</span>
                    )}
                  </div>
                  <InfoRow label="Signup Date" value={profile?.signup_date ? new Date(profile.signup_date).toLocaleDateString() : null} />
                  <InfoRow label="Role" value={profile?.role} />
                  <InfoRow label="Stripe Customer" value={profile?.stripe_customer_id || 'None'} />
                </div>

                {/* Entitlements */}
                {data.entitlements && data.entitlements.length > 0 && (
                  <>
                    <SectionHeader>Entitlements</SectionHeader>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.entitlements.map((e: any, i: number) => (
                        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FeatureBadge feature={e.feature} />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>via {e.source}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Profile Completeness */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Athlete Profile
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/athlete-profile`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View full →
                  </button>
                </div>
                {athlete ? (
                  <div
                    className="admin-stats-grid"
                    onClick={() => navigate(`/admin/users/${id}/athlete-profile`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <StatCard label="Lifts" value={athlete.lift_count || 0} sub={athlete.has_lifts ? 'entered' : 'none'} />
                    <StatCard label="Skills" value={athlete.skill_count || 0} sub={athlete.has_skills ? 'assessed' : 'none'} />
                    <StatCard label="Conditioning" value={athlete.has_conditioning ? 'Yes' : 'No'} />
                    <StatCard label="Engine Day" value={athlete.engine_current_day || 1} sub={`${athlete.engine_months_unlocked || 1} months unlocked`} />
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                    No athlete profile created yet.
                  </div>
                )}

                {/* Chat Usage */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Chat
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/chat`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View transcripts →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/chat`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Total Questions" value={chat?.total_questions || 0} />
                  <StatCard label="Last 7 Days" value={chat?.questions_7d || 0} />
                  <StatCard label="Last 30 Days" value={chat?.questions_30d || 0} />
                  <StatCard label="Total Tokens" value={((chat?.total_input_tokens || 0) + (chat?.total_output_tokens || 0)).toLocaleString()} />
                </div>
                {chat?.last_question && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Last question: {new Date(chat.last_question).toLocaleString()}
                  </div>
                )}

                {/* Engine */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Engine
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/engine-sessions`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View sessions →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/engine-sessions`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Sessions" value={engine?.total_sessions || 0} />
                  <StatCard label="Last 30 Days" value={engine?.sessions_30d || 0} />
                  <StatCard label="Avg Performance" value={engine?.avg_performance_ratio || '—'} />
                </div>
                {engine?.modalities && engine.modalities.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Modalities: {engine.modalities.join(', ')}
                  </div>
                )}
                {engine?.last_session && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Last session: {new Date(engine.last_session).toLocaleString()}
                  </div>
                )}

                {/* Nutrition */}
                <SectionHeader>Nutrition</SectionHeader>
                <div className="admin-stats-grid">
                  <StatCard label="Total Entries" value={nutrition?.total_entries || 0} />
                  <StatCard label="Days Logged" value={nutrition?.days_logged || 0} />
                  <StatCard label="Last 30 Days" value={nutrition?.entries_30d || 0} />
                  <StatCard label="Avg Calories" value={nutrition?.avg_daily_calories || '—'} />
                </div>
                {nutrition?.last_entry && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Last entry: {new Date(nutrition.last_entry).toLocaleString()}
                  </div>
                )}

                {/* Workouts */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Training Log
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/workouts`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View logs →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/workouts`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Workouts Logged" value={workouts?.total_logged || 0} />
                  <StatCard label="Last 30 Days" value={workouts?.logged_30d || 0} />
                </div>
                {workouts?.last_logged && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Last logged: {new Date(workouts.last_logged).toLocaleString()}
                  </div>
                )}

                {/* Programs */}
                {data.programs && data.programs.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                        Programs
                      </h3>
                      <button
                        onClick={() => navigate(`/admin/users/${id}/programs`)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                      >
                        View all →
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {data.programs.map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => navigate(`/admin/users/${id}/programs/${p.id}`)}
                          style={{ textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.source} &middot; {p.workout_count} workouts &middot; {new Date(p.created_at).toLocaleDateString()}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Evaluations */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Evaluations
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/evaluations`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View all →
                  </button>
                </div>
                {data.evaluations && data.evaluations.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {data.evaluations.map((e: any) => (
                      <button
                        key={e.id}
                        onClick={() => navigate(`/admin/users/${id}/evaluations/profile/${e.id}`)}
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}
                      >
                        Profile · {new Date(e.created_at).toLocaleDateString()}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                    No profile evaluations yet.
                  </div>
                )}

                <div style={{ height: 40 }} />
              </>
            ) : (
              <div className="empty-state"><p>User not found.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
