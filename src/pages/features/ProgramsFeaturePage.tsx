import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import ProfileMockup from '../../components/ProfileMockup';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

export default function ProgramsFeaturePage() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const buyProgramming = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'programming', interval: 'monthly' }),
      });
      const data = await resp.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.error) alert(data.error);
    } catch { alert('Failed to start checkout'); }
    finally { setCheckoutLoading(false); }
  };

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
                Every insight is sourced. Trace any recommendation back to the methodology.
              </p>
            </div>
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
                The AI takes everything it learned—your strengths, your gaps, your priorities—and builds a personalized 20-day training program around you. Every day designed for your numbers, your equipment, your goals.
              </p>
              <img src="/images/Program-Card.png" alt="Sample program day" className="feature-img" />
              <p>
                Every session opens with intent. Every block comes with coaching cues, movement standards, and common faults. Tap Coach before you start—your AI coach is already prepared.
              </p>
              <img src="/images/MetCon-Card.png" alt="MetCon coaching card" className="feature-img" />
              <p style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}>
                "Bar muscle-ups will be your limiter today. Here's your race plan — and your coach already knows why."
              </p>
              <img src="/images/strength-card.png" alt="Strength coaching card" className="feature-img" />
              <img src="/images/skills-card.png" alt="Skills coaching card" className="feature-img" />
            </div>
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
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>AI Programming — $29.99/mo</h3>
              <p>
                AI Coach included. Personalized programming. Adaptive adjustments. Monthly reviews.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button className="feature-cta" onClick={buyProgramming} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
                <Link to="/pricing" className="feature-cta-secondary">Back to Pricing</Link>
              </div>
              <p style={{ marginTop: 16, fontStyle: 'italic' }}>
                The program that follows you.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
