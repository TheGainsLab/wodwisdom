import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';

export default function CheckoutCompletePage() {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => navigate('/', { replace: true }), 4000);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="app-layout">
      <Nav isOpen={false} onClose={() => {}} />
      <div className="main-content">
        <div className="page-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: 40 }}>
          <div style={{ width: 64, height: 64, background: 'rgba(46,196,134,0.2)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2ec486" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>You're upgraded!</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 24 }}>Your subscription is active. Redirecting you to the app...</p>
          <button className="auth-btn" onClick={() => navigate('/', { replace: true })} style={{ maxWidth: 200 }}>Go to Chat</button>
        </div>
      </div>
    </div>
  );
}
