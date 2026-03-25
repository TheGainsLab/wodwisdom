import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

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
              <p>
                Once it does, the app becomes your pacing coach. Goals, countdowns, and round context
                stay front and center through fatigue so you execute the plan and get exactly the
                stimulus you need.
              </p>
              <p>
                Day 24. Max Aerobic Power. Goal: 68.4 calories. Not 65. Not 70. The AI calculated
                that number specifically for you.
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
                Target: 14. Actual: 17. Three sessions in a row beating the target. The AI noticed.
                Your next session will be harder.
              </p>
              <p>
                Log your results and the machine learning recalibrates. Beat your targets consistently
                and they go up. Fall short and the AI adjusts down. The program never stays static —
                it follows your actual performance, not a predetermined schedule.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Engine fingerprint */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Your engine has a fingerprint. Here's yours.</h3>
              <p>
                1:3 work-to-rest: 31 cal/min. 1:1 work-to-rest: 16 cal/min. Your output nearly
                doubles with the right rest ratio. Most athletes never know this about themselves.
                Most coaches don't have this data either.
              </p>
              <p>
                Year of the Engine tracks your performance across every work:rest ratio so the AI
                programs the intervals that actually produce results for you — not the ratios that
                work for everyone else.
              </p>
              <p>No one else is showing you this data. Because no one else has it.</p>
            </div>

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
