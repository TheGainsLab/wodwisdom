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
        <h1 className="feature-hero-title">Advanced conditioning analytics</h1>
        <p className="feature-hero-sub">
          Every training day classified, tracked, and analyzed. See how your conditioning breaks down across workout types, time domains, and modalities.
        </p>
      </section>

      {/* Training Day */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Training day breakdown</h3>
              <p>
                Each training day is automatically classified by workout type — intervals, chippers,
                AMRAPs, EMOMs, and more. See the full workout with movements, loads, time domains,
                and the specific conditioning stimulus it targets.
              </p>
              <ul>
                <li>Automatic workout type classification</li>
                <li>Time domain and stimulus identification</li>
                <li>Movement and load details</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Engine Training Day" />
          </div>
        </div>
      </section>

      {/* Analytics */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Conditioning analytics</h3>
              <p>
                Visualize your training balance with heatmaps and charts. See how your programming
                distributes across workout types, time domains, and modalities over weeks and months.
                Identify gaps in your conditioning and areas of overemphasis.
              </p>
            </div>
            <Placeholder label="Screenshot: Engine Analytics & Heatmaps" />
          </div>
        </div>
      </section>

      {/* Taxonomy */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Workout taxonomy</h3>
              <p>
                Understand the full classification system behind the analytics. Every workout type is
                defined with clear criteria so you know exactly how your training is being categorized
                and why it matters for balanced conditioning development.
              </p>
              <ul>
                <li>Complete workout type definitions</li>
                <li>Clear classification criteria</li>
                <li>Energy system mapping</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Engine Taxonomy" />
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Build a better engine.</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
