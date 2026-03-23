import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import ProfileMockup from '../../components/ProfileMockup';
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
        <span className="feature-hero-badge">Programs</span>
        <h1 className="feature-hero-title">AI Programming</h1>
        <p className="feature-hero-sub">
          From evaluation to program to progress — AI handles all of it.
        </p>
      </section>

      {/* Step 1 — Profile */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Step 1 — Your profile</h3>
              <p>
                Tell The Gains Lab about your lifts, gymnastics skills, conditioning benchmarks, and goals.
                Five minutes is all it takes to build the profile that powers everything.
              </p>
              <ul>
                <li>Strength numbers and lift ratios</li>
                <li>Gymnastics skill levels</li>
                <li>Conditioning benchmarks across modalities</li>
                <li>Training history and goals</li>
              </ul>
              <ProfileMockup />
            </div>
            <Placeholder label="Screenshot: Athlete Profile" />
          </div>
        </div>
      </section>

      {/* Step 2 — Evaluation */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Step 2 — Your evaluation</h3>
              <p>
                The AI uses your complete profile to generate a detailed evaluation — not generic advice,
                but analysis specific to your numbers and your movement capabilities.
              </p>
              <div className="workout-review-section" style={{ maxWidth: 720, margin: '24px 0 16px' }}>
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
              <p>
                Every insight is sourced from real methodology — CrossFit Journal articles, seminar content,
                and exercise physiology. You can trace any recommendation back to its source.
              </p>
            </div>
            <Placeholder label="Screenshot: Profile Evaluation" />
          </div>
        </div>
      </section>

      {/* Step 3 — Program */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3>Step 3 — Your program</h3>
              <p>
                The evaluation doesn't sit in a folder. It becomes your program.
              </p>
              <p>
                The AI takes everything it learned about you — your strength ratios, your skill gaps,
                your conditioning limiters, your priorities — and builds a personalized 20-day training
                program around it. Every day is designed for you specifically.
              </p>
              <ul>
                <li>Warm-ups targeted to that day's training</li>
                <li>Mobility work matched to your limiters</li>
                <li>Skills blocks addressing your gaps</li>
                <li>Strength work prioritized by your hierarchy</li>
                <li>Metcons built around movements you're proficient at</li>
              </ul>
              <p>
                Every training day opens with the intent behind the session — the why behind every set
                and rep. Every block comes with coaching cues, movement standards, and common faults to avoid.
              </p>
            </div>
            <Placeholder label="Screenshot: Sample program day with coach's notes" />
          </div>
        </div>
      </section>

      {/* Step 4 — Ongoing */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Step 4 — Ongoing</h3>
              <p>
                The AI doesn't send you a program and wish you the best.
              </p>
              <p>
                Log your results and the AI pays attention. Demonstrate proficiency and receive harder
                progressions. Flag a weakness and the program adjusts. Tell it you're traveling and it
                updates your workouts for the equipment you have.
              </p>
              <p>
                Each month your profile is reviewed and your evaluation updated. Over time your assessments
                tell the story of your development as an athlete.
              </p>
              <ul>
                <li>Adaptive adjustments — travel, competition prep, skill focus</li>
                <li>Progressive overload — harder progressions as you improve</li>
                <li>Monthly re-evaluation — your profile stays current</li>
                <li>Longitudinal tracking — see your development over time</li>
              </ul>
            </div>
            <Placeholder label="Screenshot: Monthly evaluation update" />
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>AI Programming — $34.99/mo</h3>
              <p>
                AI Coach included. Personalized programming. Adaptive adjustments. Monthly reviews.
              </p>
              <p>
                Early access — lock in 20% off permanently before May 1, 2026.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Get Started</button>
                <Link to="/pricing" className="feature-cta-secondary">Back to Pricing</Link>
              </div>
              <p style={{ marginTop: 16, fontStyle: 'italic' }}>
                The program that follows you.
              </p>
            </div>
            <Placeholder label="Screenshot: Program Comparison" />
          </div>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
