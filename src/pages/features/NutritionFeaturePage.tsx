import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

export default function NutritionFeaturePage() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [interval, setInterval] = useState<'monthly' | 'quarterly'>('monthly');

  const buyNutrition = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'nutrition', interval }),
      });
      const data = await resp.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.error) alert(data.error);
    } catch { alert('Failed to start checkout'); }
    finally { setCheckoutLoading(false); }
  };

  useEffect(() => {
    document.body.classList.add('feature-body');
    return () => document.body.classList.remove('feature-body');
  }, []);

  return (
    <div className="feature-page">
      {/* Header */}
      <header className="feature-header">
        <div className="feature-header-inner">
          <Link to="/" className="feature-brand">
            <GainsLogo className="feature-brand-name" />
          </Link>
          <nav className="feature-nav">
            <Link to="/features">All Features</Link>
            <a href="/#pricing">Pricing</a>
          </nav>
          <Link to="/auth" className="feature-signin-btn">Sign In</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="feature-hero">
        <span className="feature-hero-badge">Nutrition</span>
        <h1 className="feature-hero-title">Fuel built for how you train.</h1>
        <p className="feature-hero-sub">
          A complete nutrition app that knows what you burned. Photo logging, barcodes, millions of foods — plus calorie burn computed from your actual training output, not a guess. Track what goes in against what your training actually took out.
        </p>
      </section>

      {/* Dashboard */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Nutrition dashboard</h3>
              <p>
                Daily intake at a glance — know instantly if you're in a surplus or deficit. Updates in real time, so you can plan your days and weeks easily.
              </p>
              <ul>
                <li>Daily macro tracking</li>
                <li>Targets set for your training, not a generic goal</li>
                <li>Real-time progress updates</li>
              </ul>
            </div>
            <div className="feature-screenshot">
              <img src="/images/nutr2.png" alt="Nutrition Dashboard" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Barcode Scanner */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Scan and search</h3>
              <p>
                Easy to use: take a photo and AI does the rest. Shopping? Snap the barcode at the store and save the ingredients for use later. Logging takes seconds.
              </p>
            </div>
            <div className="feature-screenshot">
              <img src="/images/nutr1.png" alt="Barcode Scanner & Food Search" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Meal Builder */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Meal builder & templates</h3>
              <p>
                Build the meals you eat all the time once, then log them with a single tap. Combine ingredients into a go-to dinner, or save your usual order from the spot down the street — next time it's one tap, not a re-entry.
              </p>
              <ul>
                <li>Combine foods into complete meals</li>
                <li>Adjustable portions and servings</li>
                <li>Save and reuse meal templates</li>
              </ul>
            </div>
            <div className="feature-screenshot">
              <img src="/images/nutrition-3.png" alt="Meal Builder & Templates" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>AI Nutrition — {interval === 'monthly' ? '$7.99/mo' : '$17.99/qtr'}</h2>
        <p className="feature-footer-details">
          Photo logging, barcode scanner, millions of foods, restaurant and brand menus, meal templates, and macro tracking — a complete nutrition app.
        </p>
        <div style={{ display: 'flex', maxWidth: 280, margin: '0 auto 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <button type="button" style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'monthly' ? 'var(--accent)' : 'transparent', color: interval === 'monthly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }} onClick={() => setInterval('monthly')}>Monthly</button>
          <button type="button" style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'quarterly' ? 'var(--accent)' : 'transparent', color: interval === 'quarterly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }} onClick={() => setInterval('quarterly')}>Quarterly</button>
        </div>
        <div className="feature-footer-actions">
          <button className="feature-cta" onClick={buyNutrition} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
        </div>
        <p style={{ maxWidth: 540, margin: '24px auto 0', color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6 }}>
          Already training with us? AI Nutrition is included free with{' '}
          <Link to="/features/programs" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>AI Programming</Link>,{' '}
          <Link to="/features/engine" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Year of the Engine</Link>, and{' '}
          <Link to="/#pricing" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>All Access</Link>.
        </p>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
