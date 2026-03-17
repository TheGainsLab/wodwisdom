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

          <div className="feature-app-frame">
            <div className="feature-app-frame-bar">
              <div className="feature-app-frame-dot" />
              <div className="feature-app-frame-dot" />
              <div className="feature-app-frame-dot" />
            </div>
            <div className="feature-app-frame-body">
              <div className="feature-eval-header">
                <div className="feature-eval-avatar">W</div>
                <span className="feature-eval-label">WodWisdom</span>
              </div>
              <div className="feature-eval-body">
                <p>
                  Looking at your profile, you're a well-rounded athlete with impressive strength numbers and solid gymnastics skills.
                  Your back squat of 1.8x bodyweight and deadlift of 2.47x bodyweight put you in strong territory for your age.
                  Your overhead lifts are particularly impressive — that 315 jerk is solid work, and your gymnastics strength shows
                  with advanced handstand push-ups and muscle-ups.
                </p>

                <p><strong>Strength Assessment</strong></p>
                <p>
                  Your lift ratios tell an interesting story. Your front squat at 88% of back squat is excellent — most athletes
                  struggle to hit 85%. However, your overhead squat at 65% of back squat suggests some mobility limitations that
                  are likely holding back your Olympic lifts. Your snatch at only 60% of back squat (should be closer to 65–70%)
                  and the gap between your clean (325) and jerk (315) indicates the overhead position is your limiter. Your push press
                  and push jerk being identical at 275 also suggests you're not getting full benefit from the dip-and-drive mechanics.
                </p>

                <p><strong>Skills Profile</strong></p>
                <p>
                  Your gymnastics game is strong. Advanced butterfly pull-ups, muscle-ups, and HSPUs put you ahead of most athletes.
                  The progression makes sense — you've got the strict strength foundation (intermediate strict pull-ups/HSPUs)
                  supporting your advanced kipping skills. Your rope climb and handstand walk being intermediate fits the pattern.
                  The one outlier is beginner L-sits, which suggests core strength endurance could use work.
                </p>

                <p><strong>Conditioning Reality Check</strong></p>
                <p>
                  Your engine shows some imbalances. That 6:30 mile and 2:59 1K row are solid numbers, but your 5K times reveal
                  different stories. Your 5K run at 19:11 (6:10 pace) is much stronger relative to your mile than your 5K row at 16:54.
                  This suggests better running economy than rowing technique. Your bike numbers (34 cals/min peak, 21.3 average
                  over 10 minutes) are respectable but not standout.
                </p>

                <p><strong>The Connections</strong></p>
                <p>
                  Your overhead mobility limitations are bleeding into both your Olympic lifting and potentially affecting your
                  wall-facing HSPU progression (intermediate vs advanced regular HSPU). Your strong deadlift and back squat
                  foundation should support better clean and snatch numbers, but that overhead squat tells the story. Your advanced
                  pulling strength in gymnastics pairs well with your rowing capability, but technique refinement would serve you
                  better than just grinding harder.
                </p>

                <p><strong>Your Priorities</strong></p>
                <p>
                  First, attack that overhead mobility. Your overhead squat should be 75–80% of your back squat, not 65%.
                  This will unlock your Olympic lifts and help your wall-facing HSPU progression. Daily overhead positioning work
                  and thoracic mobility will pay dividends across multiple domains.
                </p>
                <p>
                  Second, refine your rowing technique. Your 1K and 2K times show you can generate power, but your 5K row relative
                  to your 5K run suggests stroke efficiency issues. Better rowing mechanics will improve your work capacity in
                  longer conditioning pieces and complement your strong pulling strength.
                </p>
                <p>
                  Third, address that L-sit progression. For someone with your pressing and pulling strength, beginner L-sits
                  indicate a weak link in core strength endurance that could be limiting your overall gymnastics progression
                  and Olympic lift stability.
                </p>
              </div>
              <div className="feature-eval-sources">
                <span className="feature-eval-sources-label">Sources</span>
                <span className="feature-eval-chip">CrossFit Level 2 Training Guide</span>
                <span className="feature-eval-chip">CrossFit Journal — Programming</span>
                <span className="feature-eval-chip">Guyton & Hall — Medical Physiology</span>
              </div>
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
