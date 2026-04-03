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
          Your engine isn't one thing. It's many things: Aerobic capacity. Anaerobic power. Efficiency. Repeatability. Treat them as one and you drag weak links along while holding strong ones back.
        </p>
        <p className="feature-hero-body">
          Year of the Engine uses 20 distinct training frameworks, each targeting a specific adaptation. Machine learning calibrates every session precisely to you - every single interval is personalized to you. High aerobic capacity? You'll get aggressive goals. Building anaerobic power? Each session ramps as you progress.
        </p>
        <img
          src="/images/pacing-coach.png"
          alt="Pacing Coach — real-time interval targets and progress tracking"
          className="feature-hero-img"
        />
      </section>

      {/* Know the number */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Know the number. Hit the number.</h3>
              <p>
                Day 24. Max Aerobic Power. Goal: 68.4 calories.
              </p>
              <p>
                Once the clock starts, the app becomes your pacing coach. Goals, countdowns, and round
                context stay front and center through fatigue—so you execute the plan and get the stimulus you need.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AI adjusts */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>The AI watches. The program adjusts.</h3>
              <p>
                Log your results and it recalibrates. Target: 14. Actual: 17. The AI notices, and your next session will be harder.
              </p>
              <p>
                The program follows your actual performance, not a schedule.
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
              <h3>Your engine has a fingerprint.</h3>
              <p><em>1:3 work-to-rest: 31 cal/min. 1:1 work-to-rest: 16 cal/min.</em></p>
              <p>
                Year of the Engine tracks your performance across every work:rest ratio so the AI programs the intervals that actually work for you. Year of the Engine includes AI Coaching, so share this data with your AI Coach to get pacing guidance for MetCons.
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
              <h3>See how your output differs across training types.</h3>
              <p>
                Anaerobic: 31 cal/min. Max Aerobic Power: 15 cal/min. Endurance: 11 cal/min. Every
                framework produces different output — and it should. Now you can see exactly how your
                performance varies across energy systems and track improvement in each one independently.
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
              <h3>Heart rate doesn't lie.</h3>
              <p>
                Anaerobic sessions peak at 165 bpm. Max Aerobic Power sessions at 134 bpm. That 31
                bpm spread is your aerobic system working exactly as designed.
              </p>
              <p>
                If your Max Aerobic Power sessions are running above 150 bpm, you're not training
                the system you think you are.
              </p>
              <p>
                HR analytics—avg HR, peak HR, efficiency, load—give you the data to train smarter, not just harder.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Framework balance */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Balance across all 20 frameworks.</h3>
              <p>
                See how your training distributes across workout types, time domains, and energy
                systems. Spot gaps. Fix overemphasis. Keep every component of your engine in check.
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
