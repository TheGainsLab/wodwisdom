import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

export default function ProgramsFeaturePage() {
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
            <span className="feature-logo">W</span>
            <span className="feature-brand-name">WodWisdom</span>
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
        <span className="feature-hero-badge">Programs</span>
        <h1 className="feature-hero-title">Your program, analyzed</h1>
        <p className="feature-hero-sub">
          Upload any training program. Get instant AI analysis of volume, movement patterns, energy systems, and smart suggestions for your athletes.
        </p>
      </section>

      {/* Upload */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Upload and parse instantly</h3>
              <p>
                Drop in a program from any source — a Word doc, a copy-paste from your programming tool, or type it in directly.
                WodWisdom parses the structure automatically: days, blocks, movements, loads, and time domains.
              </p>
              <ul>
                <li>Supports Word docs and direct text entry</li>
                <li>Automatic structure detection</li>
                <li>Parses movements, loads, and time domains</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Program Upload" />
          </div>
        </div>
      </section>

      {/* Weekly View */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>See the full picture</h3>
              <p>
                View your entire program laid out by week. Each day shows the workout blocks with
                movements, loads, and structure. Scroll through weeks to understand how the program
                progresses and where the emphasis shifts.
              </p>
            </div>
            <Placeholder label="Screenshot: Weekly Program View" />
          </div>
        </div>
      </section>

      {/* Analysis */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>AI-powered program analysis</h3>
              <p>
                Ask WodWisdom to analyze any program and get a detailed breakdown: volume distribution
                across movement categories, energy system balance, potential gaps, and suggestions for
                complementary work. Understand your programming at a deeper level.
              </p>
              <ul>
                <li>Volume and movement pattern breakdown</li>
                <li>Energy system analysis</li>
                <li>Gap identification and suggestions</li>
                <li>Comparison across training blocks</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Program Analysis" />
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Compare and modify</h3>
              <p>
                Ask the AI to suggest modifications to any program — scale for a specific athlete,
                adjust volume, or shift the energy system emphasis. Compare the original and modified
                versions side by side to see exactly what changed and why.
              </p>
            </div>
            <Placeholder label="Screenshot: Program Comparison" />
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Better programming starts here.</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer">WodWisdom</footer>
    </div>
  );
}
