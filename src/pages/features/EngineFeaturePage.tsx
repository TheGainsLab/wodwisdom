import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

export default function EngineFeaturePage() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const buyEngine = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'engine', interval: 'monthly' }),
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
        <span className="feature-hero-badge">Engine</span>
        <h1 className="feature-hero-title">Year of the Engine</h1>
        <p className="feature-hero-sub">The conditioning program that follows you.</p>
        <p className="feature-hero-body">
          Your engine isn't one thing. It's aerobic capacity. Anaerobic power. Efficiency. Repeatability.
        </p>
        <p className="feature-hero-body">
          Year of the Engine uses 20 distinct training frameworks, each targeting a specific adaptation. Machine learning calibrates every session precisely, so every single interval is personalized to you.
        </p>
      </section>

      {/* Know the number */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Know the number. Hit the number.</h3>
              <p>
                Day 24. Max Aerobic Power. Goal: 68.4 calories.
              </p>
              <p>
                Once the clock starts, the app becomes your pacing coach. Goals, countdowns, and round
                context stay front and center through fatigue—so you execute the plan and get the stimulus you need.
              </p>
              <img src="/images/pacing-coach.png" alt="Pacing Coach — real-time interval targets and progress tracking" className="feature-img" />
            </div>
          </div>
        </div>
      </section>

      {/* AI adjusts */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>The AI watches. The program adjusts.</h3>
              <p>
                Target: 14. Actual: 17. The AI recalibrates, and your next session will be harder.
              </p>
              <p>
                The program follows your performance, not a schedule.
              </p>
              <img src="/images/target-vs-actual.png" alt="Target vs Actual output comparison" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Engine fingerprint */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Your engine has a fingerprint.</h3>
              <p>
                Unmatched detail into how your Engine works, and how it recovers. Ask your coach (or your AI Coach — it's included for Engine athletes) how to use this data in metcons.
              </p>
              <img src="/images/work-rest-ratio.png" alt="Work to rest ratio analytics" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Workout taxonomy */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Track output across frameworks</h3>
              <p>
                See exactly how your performance varies across energy systems and track improvement in each one independently.
              </p>
              <img src="/images/comparison.png" alt="Output comparison across training types" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Heart rate analytics */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Heart rate doesn't lie.</h3>
              <p>
                HR analytics—avg HR, peak HR, efficiency, load—give you the data to train smarter, not just harder.
              </p>
            </div>
            <img src="/images/HR-analytics.png" alt="HR Analytics — average heart rate by day type" className="feature-img" />
          </div>
        </div>
      </section>

      {/* Framework balance */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>See what the AI sees</h3>
              <p>
                Track your training distribution across energy systems — the same data the AI uses to update your training.
              </p>
              <img src="/images/sessions.png" alt="Sessions by day type analytics" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Year of the Engine — $29.99/mo</h2>
        <p className="feature-footer-details">
          AI Coach included. Machine learning calibration. Pacing coach. Full conditioning analytics.
        </p>
        <div className="feature-footer-actions">
          <button className="feature-cta" onClick={buyEngine} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
          <Link to="/#pricing" className="feature-cta-secondary">Back to Pricing</Link>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
