import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

// July '26 repositioning: two hero PRODUCTS (Engine, Programs); the AI Coach
// and Nutrition are INCLUDED features of every training plan (Coach also
// sells standalone at $7.99, quietly). Nutrition standalone is retired from
// new sales — it lives on as a plan feature and a gym product.
const PRODUCTS = [
  {
    title: 'Engine',
    description: 'The app learns your Engine and sets a custom target for every training day—pacing each interval to your fitness, not a generic template. Machine learning targets each energy system independently. Real-time coaching guides you through every session. And the analytics show your Engine in unmatched detail.',
    path: '/features/engine',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: 'Programs',
    description: 'The AI learns your lifts, skills, and conditioning. Then it builds a personalized program—warm-ups, skill work, strength, metcons—with coaching cues for every session. Log your results and it adapts. The program follows you.',
    path: '/features/programs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
      </svg>
    ),
  },
];

const INCLUDED = [
  {
    title: 'AI Coaching',
    description: 'Not generic AI — a coach grounded in the methodology and the strength-science literature, that knows your training data: your program, your baselines, today’s session. Included with every plan.',
    path: '/features/coaching',
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
    title: 'Nutrition',
    description: 'The complete nutrition app — photo logging, barcode scanner, meal templates, macro tracking, and calorie burn computed from your actual training. Included with every plan.',
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
            <GainsLogo className="feature-brand-name" />
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
        <h1 className="feature-hero-title">See what <GainsLogo /> can do</h1>
        <p className="feature-hero-sub">
          AI-powered training programs for the CrossFit community — with your AI coach and full nutrition tracking built in.
        </p>
      </section>

      {/* The two products */}
      <section style={{ padding: '0 0 48px' }}>
        <div className="feature-container">
          <div className="feature-hub-grid">
            {PRODUCTS.map((f) => (
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

      {/* Included with every plan */}
      <section style={{ padding: '0 0 80px' }}>
        <div className="feature-container">
          <h2 className="feature-section-title" style={{ textAlign: 'center', marginBottom: 24 }}>
            Every plan includes
          </h2>
          <div className="feature-hub-grid">
            {INCLUDED.map((f) => (
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

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
