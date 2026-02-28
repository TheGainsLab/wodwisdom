import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

export default function DashboardPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('profiles').select('full_name').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data?.full_name) setFullName(data.full_name);
        setLoading(false);
      });
  }, []);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Dashboard</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> : (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Your Account</h2>
                {fullName && <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{fullName}</p>}
                <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>{session.user.email}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
