import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

export default function NutritionFeaturePage() {
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

      {/* Footer CTA — Nutrition is an INCLUDED feature, not a standalone SKU
          (July '26 repositioning: it ships with every training plan and as a
          gym product; it is no longer sold alone). */}
      <section className="feature-footer-cta">
        <h2>Included with every training plan</h2>
        <p className="feature-footer-details">
          Photo logging, barcode scanner, millions of foods, restaurant and brand menus, meal
          templates, and macro tracking — the complete nutrition app comes free with AI
          Programming, Year of the Engine, and All Access.
        </p>
        <div className="feature-footer-actions" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="feature-cta" onClick={() => { window.location.href = '/features/engine'; }}>Year of the Engine</button>
          <button className="feature-cta" onClick={() => { window.location.href = '/features/programs'; }}>AI Programming</button>
        </div>
        <p style={{ maxWidth: 540, margin: '24px auto 0', color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6 }}>
          Compare plans on the <a href="/#pricing" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>pricing page</a>.
        </p>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
