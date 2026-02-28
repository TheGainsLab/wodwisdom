import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

interface Profile {
  full_name: string;
  role: string;
}

export default function SettingsPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>({ full_name: '', role: 'user' });
  const [hasSubscription, setHasSubscription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('full_name, role').eq('id', session.user.id).single(),
      supabase.from('user_entitlements').select('id')
        .eq('user_id', session.user.id)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .limit(1),
    ]).then(([{ data: profileData }, { data: entitlements }]) => {
      if (profileData) setProfile(profileData);
      setHasSubscription((entitlements && entitlements.length > 0) || false);
      setLoading(false);
    });
  }, [session.user.id]);

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: {},
      });
      if (error) {
        setError(error.message || 'Failed to open billing portal');
        return;
      }
      if (data?.error) {
        setError(data.error);
        return;
      }
      if (data?.url) window.location.href = data.url;
    } finally {
      setPortalLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true); setError(''); setSuccess('');
    const { error: err } = await supabase.from('profiles').update({ full_name: profile.full_name }).eq('id', session.user.id);
    if (err) setError(err.message);
    else setSuccess('Profile updated');
    setSaving(false);
    setTimeout(() => setSuccess(''), 3000);
  };

  const changePassword = async () => {
    if (!newPassword) { setError('Enter a new password'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setPasswordSaving(true); setError(''); setSuccess('');
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    if (err) setError(err.message);
    else { setSuccess('Password updated'); setNewPassword(''); setConfirmPassword(''); }
    setPasswordSaving(false);
    setTimeout(() => setSuccess(''), 3000);
  };

  const roleBadge = profile.role === 'owner' ? 'Gym Owner' : profile.role === 'coach' ? 'Coach' : 'User';

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Settings</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <div className="auth-error" style={{ display: 'block' }}>{error}</div>}
            {success && <div className="success-msg">{success}</div>}

            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> : (
              <>
                {hasSubscription && (
                  <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)' }}>
                    <h2 className="settings-card-title">Subscription</h2>
                    <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>Update payment method, change plan, or cancel anytime.</p>
                    <button className="auth-btn" onClick={openBillingPortal} disabled={portalLoading}>
                      {portalLoading ? 'Opening...' : 'Manage subscription'}
                    </button>
                  </div>
                )}
                {/* Profile Section */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Profile</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                    <div className="settings-avatar">{profile.full_name?.[0]?.toUpperCase() || session.user.email?.[0]?.toUpperCase() || '?'}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{profile.full_name || 'No name set'}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{session.user.email}</div>
                    </div>
                    <span className="role-badge">{roleBadge}</span>
                  </div>
                  <div className="field">
                    <label>Full Name</label>
                    <input type="text" value={profile.full_name} onChange={e => setProfile({ ...profile, full_name: e.target.value })} placeholder="Your name" />
                  </div>
                  <button className="auth-btn" onClick={saveProfile} disabled={saving} style={{ marginTop: 4 }}>
                    {saving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>

                {/* Password Section */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Change Password</h2>
                  <div className="field">
                    <label>New Password</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password" />
                  </div>
                  <div className="field">
                    <label>Confirm Password</label>
                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" />
                  </div>
                  <button className="auth-btn" onClick={changePassword} disabled={passwordSaving} style={{ marginTop: 4 }}>
                    {passwordSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </div>

                {/* Account Info */}
                <div className="settings-card">
                  <h2 className="settings-card-title">Account</h2>
                  <div className="settings-row">
                    <span className="settings-label">Email</span>
                    <span className="settings-value">{session.user.email}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">Role</span>
                    <span className="settings-value">{roleBadge}</span>
                  </div>
                  <div className="settings-row" style={{ borderBottom: 'none' }}>
                    <span className="settings-label">Member since</span>
                    <span className="settings-value">{new Date(session.user.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
