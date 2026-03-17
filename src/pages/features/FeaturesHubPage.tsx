import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../../features.css';

const FEATURES = [
  {
    title: 'AI Coaching',
    description: 'Get a comprehensive AI evaluation of any athlete — strength ratios, skills assessment, conditioning analysis, and personalized priorities. Like having a head coach who has read every journal article and never forgets a detail.',
    path: '/features/ai-coaching',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
        <path d="M17 10v1a5 5 0 0 1-10 0v-1" />
        <path d="M12 19v3" />
        <path d="M8 22h8" />
      </svg>
    ),
  },
  {
    title: 'Programs',
    description: 'Upload any training program and get instant AI analysis — weekly volume breakdown, movement patterns, energy system balance, and smart modification suggestions tailored to your athletes.',
    path: '/features/programs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
      </svg>
    ),
  },
  {
    title: 'Engine',
    description: 'Advanced conditioning intelligence. See every training day classified by workout type, track your conditioning across time domains, and visualize your training balance with analytics and heatmaps.',
    path: '/features/engine',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: 'Nutrition',
    description: 'Track your fuel with a barcode scanner, food search, and meal builder. Build meal templates, log daily intake, and get AI-powered guidance on pre- and post-workout nutrition.',
    path: '/features/nutrition',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
];

export default function FeaturesHubPage() {
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
            <a href="/#how-it-works">How It Works</a>
            <a href="/#pricing">Pricing</a>
          </nav>
          <Link to="/auth" className="feature-signin-btn">Sign In</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="feature-hero">
        <h1 className="feature-hero-title">See what WodWisdom can do</h1>
        <p className="feature-hero-sub">
          AI-powered coaching, programming, conditioning analytics, and nutrition tracking — built for the CrossFit community.
        </p>
      </section>

      {/* Feature Cards */}
      <section style={{ padding: '0 0 80px' }}>
        <div className="feature-container">
          <div className="feature-hub-grid">
            {FEATURES.map((f) => (
              <Link key={f.path} to={f.path} className="feature-hub-card">
                <div className="feature-hub-icon">{f.icon}</div>
                <div className="feature-hub-content">
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <span className="feature-hub-link">
                    See more
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Ready to train smarter?</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer">WodWisdom</footer>
    </div>
  );
}
