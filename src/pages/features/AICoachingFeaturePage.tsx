import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../../features.css';

export default function AICoachingFeaturePage() {
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
        <span className="feature-hero-badge">AI Coaching</span>
        <h1 className="feature-hero-title">AI that knows your athlete</h1>
        <p className="feature-hero-sub">
          Enter your numbers, skills, and benchmarks. Get back a comprehensive evaluation that connects the dots across every domain of fitness.
        </p>
      </section>

      {/* How It Works */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Build your athlete profile</h3>
              <p>
                Tell WodWisdom about your lifts, gymnastics skills, conditioning benchmarks, and goals.
                The AI uses your complete profile to generate a detailed evaluation — not generic advice,
                but analysis specific to your numbers and your movement capabilities.
              </p>
              <ul>
                <li>Strength numbers and lift ratios</li>
                <li>Gymnastics skill levels</li>
                <li>Conditioning benchmarks across modalities</li>
                <li>Training history and goals</li>
              </ul>
            </div>
            <div className="feature-screenshot">
              <div className="feature-screenshot-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <span>Screenshot: Athlete Profile</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Evaluation */}
      <section className="feature-section">
        <div className="feature-container">
          <h2 className="feature-section-title">A real athlete evaluation</h2>
          <p className="feature-section-sub">
            This is an actual AI-generated evaluation from WodWisdom. Every insight is specific to the athlete's profile.
          </p>

          <div className="workout-review-section" style={{ maxWidth: 720, margin: '0 auto' }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 10 }}>
              Profile Evaluation
            </h3>
            <div className="workout-review-content">
              <p>
                Looking at your profile, you're a well-rounded athlete with some clear strengths and specific areas that need work.
              </p>

              <p><strong>Your Strength Foundation is Solid</strong></p>
              <p>
                Your squat pattern is strong across the board. Back squat at 1.8x bodyweight and front squat at 1.6x are solid numbers for a 50-year-old. Your front squat to back squat ratio of 88% is excellent — most athletes struggle to get above 85%. Your deadlift at 2.5x bodyweight shows good posterior chain strength. The Olympic lifts tell an interesting story though — your clean at 325 is respectable, but your jerk at 315 means you're leaving weight on the platform. That 10-pound gap suggests your overhead strength or receiving position needs work.
              </p>

              <p><strong>Skills Show Experience but Gaps</strong></p>
              <p>
                You've clearly put time into the high-skill movements. Advanced HSPU and muscle-ups indicate good pressing strength and coordination. Your butterfly pull-ups being advanced while kipping are intermediate suggests you rushed the progression — the reference material emphasizes mastering the controlled shoulder kip before adding complexity. Your L-sit being beginner level is a red flag for core strength and shoulder stability, especially given your advanced upper body gymnastics work.
              </p>

              <p><strong>Conditioning Reveals Your Athletic Background</strong></p>
              <p>
                Your conditioning profile screams "former athlete who stayed fit." That 6:30 mile suggests good aerobic capacity, but your rowing times are inconsistent with your running — a 6:20 2K row is solid but your 5K row at 16:54 shows you fade on longer pieces. Your bike output is respectable but nothing special. The gap between your short and long efforts suggests you rely more on strength than aerobic development.
              </p>

              <p><strong>The Bigger Picture</strong></p>
              <p>
                Your strength supports your gymnastics skills well, but there are technical gaps that limit your ceiling. That jerk being 40 pounds behind your clean, combined with your overhead squat being only 65% of your back squat, points to overhead mobility or receiving position issues. Your advanced butterfly pull-ups paired with beginner L-sits suggests you've prioritized flashy skills over foundational midline strength.
              </p>

              <p><strong>Your Priorities</strong></p>
              <p>
                First priority: Fix your jerk mechanics and overhead position. Work push jerks from stands, overhead squats, and get that jerk closer to your clean. Second priority: Address the L-sit deficiency — it's limiting your midline strength for everything else. Third priority: Build aerobic capacity through longer, controlled efforts to match your anaerobic power with sustainable work capacity.
              </p>

              <p>
                You've got the strength and skill base of a competitive master's athlete. Clean up these technical gaps and you'll see everything improve.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sourced */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Every recommendation is sourced</h3>
              <p>
                WodWisdom doesn't make things up. Every evaluation pulls from real training methodology —
                CrossFit Journal articles, seminar content, exercise physiology textbooks, and more.
                You can trace any recommendation back to its source material.
              </p>
            </div>
            <div className="feature-screenshot">
              <div className="feature-screenshot-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <span>Screenshot: Sources & Citations</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Get your evaluation today.</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer">WodWisdom</footer>
    </div>
  );
}
