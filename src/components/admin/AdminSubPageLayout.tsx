import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import Nav from '../Nav';

/**
 * Shared layout for admin drill-down sub-pages (athlete profile, chat,
 * evaluations, programs, engine sessions, training log, nutrition).
 *
 * Responsibilities:
 *   - Wrap content in the standard app-layout + Nav shell.
 *   - Render a header with page title and a back button to the user detail.
 *   - Fetch and display a compact user summary bar (name + email + key stats)
 *     so the admin never loses context when navigating between sub-pages.
 *   - Provide loading / error / empty-unauthorized states.
 *
 * Usage:
 *   <AdminSubPageLayout
 *     session={session}
 *     userId={id}
 *     title="Athlete Profile"
 *   >
 *     { ...your drill-down content... }
 *   </AdminSubPageLayout>
 */

interface AdminUserSummary {
  full_name: string | null;
  email: string | null;
  role: string | null;
  entitlement_features: string[];
}

interface Props {
  session: Session;
  userId: string;
  title: string;
  children: React.ReactNode;
}

export default function AdminSubPageLayout({ session, userId, title, children }: Props) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [summary, setSummary] = useState<AdminUserSummary | null>(null);
  const [adminCheck, setAdminCheck] = useState<'checking' | 'allowed' | 'denied'>('checking');

  // Admin gate: must confirm caller is admin before rendering content.
  useEffect(() => {
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      setAdminCheck(profile?.role === 'admin' ? 'allowed' : 'denied');
    })();
  }, [session.user.id]);

  // Fetch target user summary via admin RPC (bypasses RLS via SECURITY DEFINER).
  useEffect(() => {
    if (adminCheck !== 'allowed' || !userId) return;
    (async () => {
      const { data, error } = await supabase.rpc('admin_get_user_summary', { target_user_id: userId });
      if (error || !data) return;
      setSummary({
        full_name: data.full_name ?? null,
        email: data.email ?? null,
        role: data.role ?? null,
        entitlement_features: Array.isArray(data.entitlement_features) ? data.entitlement_features : [],
      });
    })();
  }, [userId, adminCheck]);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{title}</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {/* Back button to the user's detail page */}
            <button
              onClick={() => navigate(`/admin/users/${userId}`)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-dim)',
                cursor: 'pointer', fontSize: 14, fontFamily: "'Outfit', sans-serif",
                padding: '4px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back to User
            </button>

            {adminCheck === 'checking' && (
              <div className="page-loading"><div className="loading-pulse" /></div>
            )}

            {adminCheck === 'denied' && (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 20, color: 'var(--text-dim)', fontSize: 14, textAlign: 'center',
              }}>
                You need admin access to view this page.
              </div>
            )}

            {adminCheck === 'allowed' && (
              <>
                {/* User summary bar */}
                {summary && (
                  <div style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: '14px 18px', marginBottom: 20,
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: 'var(--accent-glow)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, fontWeight: 800, color: 'var(--accent)', flexShrink: 0,
                    }}>
                      {(summary.full_name?.[0] || summary.email?.[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.full_name || 'No name'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.email}
                      </div>
                    </div>
                    {summary.role === 'admin' && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                        color: 'var(--accent)', background: 'var(--accent-glow)',
                        padding: '2px 8px', borderRadius: 4,
                      }}>Admin</span>
                    )}
                    {summary.entitlement_features.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {summary.entitlement_features.map(f => (
                          <span key={f} style={{
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            color: 'var(--text-dim)', background: 'var(--border)',
                            padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                          }}>
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {children}
              </>
            )}

            <div style={{ height: 40 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
