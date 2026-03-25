import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const Placeholder = ({ label }: { label: string }) => (
  <div className="feature-screenshot">
    <div className="feature-screenshot-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
      <span>{label}</span>
    </div>
  </div>
);

export default function EngineFeaturePage() {
  const navigate = useNavigate();

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
          Engine isn't one parameter — it's many. Aerobic capacity. Anaerobic power. Threshold.
          Efficiency. Repeatability. These don't increase in lockstep. Treating them as a single
          system means dragging weak links along and holding strong ones back.
        </p>
        <p className="feature-hero-body">
          Forcing everyone into the same program doesn't make sense. So we don't.
        </p>
        <img
          src="/images/pacing-coach.png"
          alt="Pacing Coach — real-time interval targets and progress tracking"
          className="feature-hero-img"
        />
      </section>

      {/* Machine learning calibration */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Machine learning calibration</h3>
              <p>
                20 distinct training frameworks, each independently targeting a specific adaptation.
                Machine learning calibrates every session precisely to you — not just the program,
                but every individual interval and every personal target within it.
              </p>
              <ul>
                <li>High aerobic capacity? You'll get aggressive goals.</li>
                <li>Building anaerobic power? Each session ramps as you progress.</li>
                <li>You always know what you're trying to hit and why — before the clock starts.</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Session targets and interval goals" />
          </div>
        </div>
      </section>

      {/* Pacing coach */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Your pacing coach</h3>
              <p>
                Once the clock starts, the app becomes your pacing coach. Goals, countdowns, and
                round context stay front and center through fatigue so you execute the plan and get
                exactly the stimulus you need.
              </p>
              <p>No guessing. No drifting. Just the work.</p>
            </div>
            <Placeholder label="Screenshot: Pacing coach mid-session" />
          </div>
        </div>
      </section>

      {/* Conditioning analytics */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Conditioning analytics</h3>
              <p>
                Every training day classified, tracked, and analyzed. See how your conditioning
                breaks down across workout types, time domains, and modalities over weeks and months.
                Identify gaps and areas of overemphasis.
              </p>
              <ul>
                <li>Automatic workout type classification</li>
                <li>Time domain and stimulus identification</li>
                <li>Heatmaps and charts across weeks and months</li>
                <li>Energy system mapping</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Engine analytics and heatmaps" />
          </div>
        </div>
      </section>

      {/* Workout taxonomy */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Workout taxonomy</h3>
              <p>
                Understand the full classification system behind the analytics. Every workout type is
                defined with clear criteria so you know exactly how your training is being categorized
                and why it matters for balanced conditioning development.
              </p>
            </div>
            <Placeholder label="Screenshot: Engine taxonomy" />
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Year of the Engine — $29.99/mo</h2>
        <p className="feature-footer-details">
          AI Coach included. Machine learning calibration. Pacing coach. Full conditioning analytics.
        </p>
        <p className="feature-footer-promo">
          Early access — lock in 20% off permanently before May 1, 2026.
        </p>
        <div className="feature-footer-actions">
          <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Get Started</button>
          <Link to="/#pricing" className="feature-cta-secondary">Back to Pricing</Link>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
