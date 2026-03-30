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

export default function NutritionFeaturePage() {
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
        <span className="feature-hero-badge">Nutrition</span>
        <h1 className="feature-hero-title">Track fuel, not just reps</h1>
        <p className="feature-hero-sub">
          Nutrition data with a snap - just take a photo of whatever you eat and AI handles the rest. You can also scan barcodes, search a database and build your favorite meals, whether you're cooking at home or going out to eat.
        </p>
      </section>

      {/* Dashboard */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Nutrition dashboard</h3>
              <p>
                Daily intake at a glance - know instantly if you're in a surplus or deficit. Updates in real time so you can plan your days and weeks easily.
              </p>
              <ul>
                <li>Daily macro tracking</li>
                <li>Calorie and nutrient targets</li>
                <li>Real-time progress updates</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Nutrition Dashboard" />
          </div>
        </div>
      </section>

      {/* Barcode Scanner */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Scan and search</h3>
              <p>
                Easy to use: take a photo and AI does the rest. Shopping? Snap the barcode at the store and save the ingredients for use later. Logging takes seconds.
              </p>
            </div>
            <Placeholder label="Screenshot: Barcode Scanner & Food Search" />
          </div>
        </div>
      </section>

      {/* Meal Builder */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Meal builder & templates</h3>
              <p>
                Quickly save your favorites and log them with a single tap. Favorite meals at home? Select the ingredients and save the meal. Usual lunch place during work? Save it, and log your meal before you order next time! It's that easy.
              </p>
              <ul>
                <li>Combine foods into complete meals</li>
                <li>Adjustable portions and servings</li>
                <li>Save and reuse meal templates</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Meal Builder" />
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Fuel your training.</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
