import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import { cacheGet, cacheSet, profileKey, entitlementsKey } from '../lib/offlineCache';

interface Profile {
  full_name: string;
  role: string;
}

export default function SettingsPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>({ full_name: '', role: 'user' });
  const [hasSubscription, setHasSubscription] = useState(false);
  const [userFeatures, setUserFeatures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    const uid = session.user.id;

    if (!navigator.onLine) {
      // Load from cache when offline
      Promise.all([
        cacheGet<Profile>(profileKey(uid)),
        cacheGet<string[]>(entitlementsKey(uid)),
      ]).then(([cachedProfile, cachedFeatures]) => {
        if (cachedProfile) setProfile(cachedProfile);
        if (cachedFeatures && cachedFeatures.length > 0) {
          setHasSubscription(true);
          setUserFeatures(cachedFeatures);
        }
        setLoading(false);
      });
      return;
    }

    Promise.all([
      supabase.from('profiles').select('full_name, role').eq('id', uid).single(),
      supabase.from('user_entitlements').select('feature')
        .eq('user_id', uid)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString()),
    ]).then(([{ data: profileData }, { data: entitlements }]) => {
      if (profileData) {
        setProfile(profileData);
        cacheSet(profileKey(uid), profileData);
      }
      if (entitlements && entitlements.length > 0) {
        setHasSubscription(true);
        const features = entitlements.map(e => e.feature);
        setUserFeatures(features);
        cacheSet(entitlementsKey(uid), features);
      }
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

  const roleBadge = profile.role === 'admin' ? 'Admin' : 'User';

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
                {/* Subscription Section */}
                <div className="settings-card" style={hasSubscription || profile.role === 'admin' ? { borderColor: 'var(--accent)', background: 'var(--accent-glow)' } : {}}>
                  <h2 className="settings-card-title">Subscription</h2>
                  {hasSubscription || profile.role === 'admin' ? (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                        {profile.role === 'admin' ? (
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--accent)', background: 'rgba(255,58,58,0.1)', padding: '3px 10px', borderRadius: 4 }}>
                            All Access (Admin)
                          </span>
                        ) : userFeatures.map(f => (
                          <span key={f} style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--accent)', background: 'rgba(255,58,58,0.1)', padding: '3px 10px', borderRadius: 4 }}>
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>Update payment method, change plan, or cancel anytime.</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="auth-btn" onClick={openBillingPortal} disabled={portalLoading}>
                          {portalLoading ? 'Opening...' : 'Manage subscription'}
                        </button>
                        <button className="auth-btn" onClick={() => navigate('/checkout')} style={{ background: 'var(--surface2)', color: 'var(--text)' }}>
                          Change plan
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>You're on the free plan. Upgrade to unlock all features.</p>
                      <button className="auth-btn" onClick={() => navigate('/checkout')}>
                        Upgrade
                      </button>
                    </>
                  )}
                </div>
                {/* Athlete Profile Link */}
                <div className="settings-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/profile')}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>Athlete Profile</div>
                        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>1RMs, skills, equipment & benchmarks</div>
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

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

                {/* Install App — only show when not already installed as PWA */}
                {!window.matchMedia('(display-mode: standalone)').matches && (
                  <div className="settings-card">
                    <h2 className="settings-card-title">Install App</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
                      Install GAINS on your phone for a fullscreen app experience with offline support.
                    </p>
                    {/iPad|iPhone|iPod/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text)' }}>
                        <span>Tap</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
                        <span>in Safari, then <strong>&quot;Add to Home Screen&quot;</strong></span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, color: 'var(--text)' }}>
                        Use your browser menu to <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong>
                      </div>
                    )}
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
