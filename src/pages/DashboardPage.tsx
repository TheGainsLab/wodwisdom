import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

interface Gym { id: string; name: string; max_seats: number; }
interface Member { id: string; invited_email: string; user_id: string | null; status: string; full_name?: string; }
interface CoachGym { gym_name: string; status: string; invited_email: string; }

export default function DashboardPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [gym, setGym] = useState<Gym | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [coachGyms, setCoachGyms] = useState<CoachGym[]>([]);
  const [gymName, setGymName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setLoading(true);
    // Load profile role
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    const userRole = profile?.role || 'user';
    setRole(userRole);

    if (userRole === 'owner') {
      await loadOwnerGym();
    } else if (userRole === 'coach') {
      await loadCoachGyms();
    }
    setLoading(false);
  };

  const loadOwnerGym = async () => {
    const { data: gyms, error: gymErr } = await supabase.from('gyms').select('*').eq('owner_id', session.user.id).limit(1);
    if (gymErr) {
      console.error('loadGym error:', gymErr);
      setError('Failed to load gym: ' + gymErr.message);
    }
    if (gyms && gyms.length > 0) {
      setGym(gyms[0]);
      const { data: mems } = await supabase.from('gym_members').select('*').eq('gym_id', gyms[0].id).neq('status', 'declined').order('created_at');
      if (mems) {
        const enriched = await Promise.all(mems.map(async (m: any) => {
          if (m.user_id) {
            const { data: p } = await supabase.from('profiles').select('full_name').eq('id', m.user_id).single();
            return { ...m, full_name: p?.full_name || m.invited_email };
          }
          return { ...m, full_name: m.invited_email };
        }));
        setMembers(enriched);
      }
    }
  };

  const loadCoachGyms = async () => {
    const email = session.user.email?.toLowerCase();
    const { data: memberships } = await supabase
      .from('gym_members')
      .select('status, invited_email, gym_id, gyms(name)')
      .or(`user_id.eq.${session.user.id}${email ? `,invited_email.eq.${email}` : ''}`)
      .neq('status', 'declined')
      .neq('status', 'revoked');
    if (memberships) {
      setCoachGyms(memberships.map((m: any) => ({
        gym_name: m.gyms?.name || 'Unknown gym',
        status: m.status,
        invited_email: m.invited_email,
      })));
    }
  };

  const createGym = async () => {
    if (!gymName.trim()) { setError('Enter a gym name'); return; }
    setError('');
    const { data, error: err } = await supabase.from('gyms').insert({ name: gymName.trim(), owner_id: session.user.id, max_seats: 3 }).select().single();
    if (err) { setError(err.message); return; }
    await supabase.from('profiles').update({ role: 'owner' }).eq('id', session.user.id);
    setRole('owner');
    setGym(data);
    setSuccess('Gym created!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const inviteCoach = async () => {
    if (!inviteEmail.trim()) { setError('Enter an email'); return; }
    if (!gym) return;
    setError(''); setSuccess('');
    const normalizedEmail = inviteEmail.trim().toLowerCase();

    // Check seat limits
    const activeCount = members.filter(m => m.status === 'active' || m.status === 'invited').length;
    if (activeCount >= gym.max_seats) { setError(`All ${gym.max_seats} coach seats are filled`); return; }

    // Check for existing row (re-invite or duplicate)
    const { data: existing } = await supabase
      .from('gym_members')
      .select('id, status')
      .eq('gym_id', gym.id)
      .eq('invited_email', normalizedEmail)
      .limit(1);

    if (existing && existing.length > 0) {
      const row = existing[0];
      if (row.status === 'active' || row.status === 'invited') { setError('This email has already been invited'); return; }
      // Re-invite a previously declined/revoked coach
      const { error: updateErr } = await supabase.from('gym_members').update({ status: 'invited' }).eq('id', row.id);
      if (updateErr) { setError(updateErr.message); return; }
    } else {
      const { error: insertErr } = await supabase.from('gym_members').insert({
        gym_id: gym.id,
        invited_email: normalizedEmail,
        invited_by: session.user.id,
        status: 'invited',
      });
      if (insertErr) { setError(insertErr.message); return; }
    }

    setInviteEmail('');
    setSuccess('Coach invited!');
    setTimeout(() => setSuccess(''), 5000);
    loadDashboard();
  };

  const revokeCoach = async (memberId: string) => {
    await supabase.from('gym_members').update({ status: 'revoked' }).eq('id', memberId);
    loadDashboard();
  };

  const statusColor = (s: string) => s === 'active' ? '#2ec486' : s === 'invited' ? '#f0a050' : '#666';

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Gym Dashboard</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}
            {success && <div style={{ background: 'rgba(46,196,134,0.1)', border: '1px solid rgba(46,196,134,0.25)', color: '#2ec486', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{success}</div>}
            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> :

            /* ---- Coach view ---- */
            role === 'coach' ? (
              <div>
                {coachGyms.length === 0 ? (
                  <div className="empty-state"><p>You haven't been added to any gyms yet.</p></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {coachGyms.map((cg, i) => (
                      <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <h2 style={{ fontSize: 20, fontWeight: 700 }}>{cg.gym_name}</h2>
                            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>You're a coach at this gym</p>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5, color: statusColor(cg.status), background: statusColor(cg.status) + '20', padding: '3px 10px', borderRadius: 4 }}>{cg.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) :

            /* ---- User view ---- */
            role !== 'owner' && role !== 'coach' ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Your Account</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 4 }}>{session.user.email}</p>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5, color: 'var(--accent)', background: 'rgba(255,58,58,0.1)', padding: '3px 10px', borderRadius: 4 }}>User</span>
              </div>
            ) :

            /* ---- Owner view: no gym yet ---- */
            !gym ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Create Your Gym</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 24 }}>Set up your gym to invite and manage coaches.</p>
                <div className="field"><label>Gym Name</label><input type="text" value={gymName} onChange={e => setGymName(e.target.value)} placeholder="e.g. CrossFit Thunder" onKeyDown={e => e.key === 'Enter' && createGym()} /></div>
                <button className="auth-btn" onClick={createGym}>Create Gym</button>
              </div>
            ) :

            /* ---- Owner view: has gym ---- */
            (
              <>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div>
                      <h2 style={{ fontSize: 20, fontWeight: 700 }}>{gym.name}</h2>
                      <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{members.filter(m => m.status === 'active' || m.status === 'invited').length} / {gym.max_seats} coach seats used</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="coach@example.com" style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text)', fontFamily: 'Outfit, sans-serif', fontSize: 14, outline: 'none' }} onKeyDown={e => e.key === 'Enter' && inviteCoach()} />
                    <button onClick={inviteCoach} style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Invite</button>
                  </div>
                </div>
                {members.length === 0 ? (
                  <div className="empty-state"><p>No coaches yet. Invite your first coach above.</p></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {members.map(m => (
                      <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{m.full_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.invited_email}</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5, color: statusColor(m.status), background: statusColor(m.status) + '20', padding: '3px 10px', borderRadius: 4 }}>{m.status}</span>
                        {(m.status === 'active' || m.status === 'invited') && (
                          <button onClick={() => revokeCoach(m.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'Outfit, sans-serif' }}>Revoke</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
