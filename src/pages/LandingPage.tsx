import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

/** Inline styled plan name — bold + accent color, used throughout FAQs */
const PN: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <strong style={{ color: 'var(--accent)' }}>{children}</strong>
);

/** Dashed image-placeholder box. Swap each for a real <img> once art is ready. */
const Placeholder: React.FC<{ label: string; ratio?: string }> = ({ label, ratio = '16 / 10' }) => (
  <div style={{
    width: '100%',
    aspectRatio: ratio,
    border: '2px dashed var(--border)',
    borderRadius: 14,
    background: 'var(--surface)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-dim)',
    fontSize: 14,
    textAlign: 'center',
    padding: 24,
    boxSizing: 'border-box',
  }}>
    {label}
  </div>
);

/** Small uppercase accent label that sits above a section headline. */
const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
    {children}
  </div>
);

/** Horizontal "A → B → C" chip flow. */
const Flow: React.FC<{ steps: string[] }> = ({ steps }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
    {steps.map((s, i) => (
      <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 999, padding: '6px 14px', fontSize: 14, fontWeight: 600 }}>{s}</span>
        {i < steps.length - 1 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>&rarr;</span>}
      </span>
    ))}
  </div>
);

const sectionHeadline: React.CSSProperties = { fontSize: 'clamp(26px,3.4vw,34px)', fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.2, marginBottom: 16 };
const bodyP: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, color: 'var(--text-dim)', marginBottom: 16 };
const featureRow: React.CSSProperties = { display: 'flex', gap: 48, alignItems: 'center', flexWrap: 'wrap' };
const featureCol: React.CSSProperties = { flex: '1 1 360px', minWidth: 280 };

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How can I try it before paying?',
    a: <><a href="/auth?signup=1" style={{ color: 'var(--accent)', fontWeight: 600 }}>Create a free account</a> to get access to <PN>AI Coach</PN>, the AI trained on the methodology, physiology and biochemistry. <PN>AI Coach</PN> is also included with <PN>AI Programming</PN>, <PN>Year of the Engine</PN> and <PN>All Access</PN> Programs.</>,
  },
  {
    q: "What's the difference among the programs?",
    a: <>
      <PN>AI Coach</PN> is an AI trained on the methodology. Get advice about anything related to fitness. It's like having access to a high-level coach 24/7.
      <br /><br />
      <PN>Year of the Engine</PN> is a personalized conditioning program for athletes at any level.
      <br /><br />
      <PN>AI Programming</PN> is customized programming written by an AI trained on methodology. Complete a user profile and the AI writes a program tailored precisely to you. Log your results and the AI learns, updating your training so you always get exactly what you need.
    </>,
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. There are no contracts or commitments. You can cancel your subscription at any time and retain access through the end of your billing period.',
  },
  {
    q: 'What else is included with my Year of the Engine subscription?',
    a: <>All <PN>Year of the Engine</PN> subscribers also get access to the <PN>AI Coach</PN> feature and the <PN>AI Nutrition</PN> feature with unlimited usage at no additional cost.</>,
  },
  {
    q: 'What else is included with my AI Programming subscription?',
    a: <>All <PN>AI Programming</PN> subscribers also get access to the <PN>AI Coach</PN> feature with 20 questions a day and the <PN>AI Nutrition</PN> feature with unlimited usage at no additional cost.</>,
  },
  {
    q: 'What is included in the All Access membership?',
    a: <><PN>All Access</PN> members get access to <PN>AI Programming</PN>, <PN>Year of the Engine</PN>, <PN>AI Coach</PN>, and <PN>AI Nutrition</PN>. All of this for under $50 a month.</>,
  },
  {
    q: 'I have additional questions. How can I contact you?',
    a: <>You can send us an email anytime to <a href="mailto:coach@thegainslab.com" style={{ color: 'var(--accent)' }}>coach@thegainslab.com</a></>,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pricingInterval, setPricingInterval] = useState<'monthly' | 'quarterly'>('monthly');
  const goToAuth = () => navigate('/auth');

  useEffect(() => {
    document.body.classList.add('landing-body');
    return () => document.body.classList.remove('landing-body');
  }, []);

  return (
    <div className="landing-page">
      {/* ===== Header ===== */}
      <header className="landing-header">
        <div className="landing-header-inner">
          <div className="landing-brand">
            <GainsLogo className="landing-brand-name" />
          </div>
          <nav className="landing-nav">
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="landing-signin-btn" onClick={goToAuth}>Sign In</button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="landing-hero">
        <GainsLogo className="landing-hero-logo" />
        <h1 className="landing-hero-title">Stop Doing Someone Else's Workout.</h1>
        <p className="landing-hero-sub">
          A coach that learns who you are, finds what's holding you back, and adapts as you improve — built on 15 million workout results.
        </p>
        <div className="landing-hero-ctas">
          <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
          <a href="#how-it-works" className="landing-cta landing-cta-outline">See How It Works &rarr;</a>
        </div>

        {/* Visual: evaluation screenshot with a highlighted callout. */}
        <div style={{ position: 'relative', width: '100%', maxWidth: 820, margin: '48px auto 0' }}>
          {/* TODO: replace placeholder with evaluation screenshot (~820×512, 16:10) */}
          <div style={{
            aspectRatio: '16 / 10',
            border: '2px dashed var(--border)',
            borderRadius: 14,
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
            fontSize: 14,
            textAlign: 'center',
            padding: 24,
          }}>
            [ Image placeholder — Evaluation screenshot (~820×512) ]
          </div>
          <div style={{
            position: 'absolute',
            right: 'clamp(-12px, -2vw, 0px)',
            top: '28%',
            maxWidth: 280,
            background: 'var(--accent)',
            color: 'white',
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 14,
            lineHeight: 1.5,
            boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            textAlign: 'left',
          }}>
            "Your profile tells the story of a strength-dominant athlete…"
          </div>
        </div>

        <p style={{ marginTop: 24, fontSize: 14, color: 'var(--text-dim)', fontWeight: 500 }}>
          Always available. Never forgets.
        </p>
      </section>

      {/* ===== Data comes to life ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>Data comes to life</Eyebrow>
          <h2 style={sectionHeadline}>Most Apps Record Your Workout. Your Coach Interprets It.</h2>
          <p style={{ ...bodyP, maxWidth: 680 }}>
            A spreadsheet saves your score. A coach tells you what it means — and what to do about it.
          </p>
          <div style={{ marginBottom: 36 }}>
            <Flow steps={['Workout', 'Context', 'Insight', 'Action']} />
          </div>

          {/* Split screen: anonymous record vs. personalized coach read */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {/* Left — someone else's workout */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
              <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 16 }}>
                Someone Else's Workout
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-dim)' }}>Fran</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-dim)' }}>3:42</span>
              </div>
              <div style={{ marginTop: 12, fontSize: 14, color: 'var(--text-muted)' }}>Saved.</div>
            </div>
            {/* Right — your coach */}
            <div style={{ background: 'var(--surface)', border: '2px solid var(--accent)', borderRadius: 14, padding: 24 }}>
              <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 16 }}>
                Your Coach
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>Fran</span>
                <span style={{ fontSize: 24, fontWeight: 800 }}>3:42</span>
              </div>
              <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 15, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                <li>Top 12% power output.</li>
                <li>Gymnastics endurance remains a limiter.</li>
                <li>Aerobic recovery improving.</li>
              </ul>
              <div style={{ marginTop: 14, fontSize: 15, fontWeight: 600 }}>
                Recommendation: <span style={{ color: 'var(--accent)' }}>increase gymnastics density.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== How It Knows You ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>How It Knows You</Eyebrow>
          <h2 style={{ ...sectionHeadline, textAlign: 'center' }}>Before Programming, Understanding</h2>
          <div className="landing-offerings-grid">
            <div className="landing-offering-card">
              <h3>Your Profile</h3>
              <p>Strength numbers, key ratios, skills, benchmarks, goals.</p>
            </div>
            <div className="landing-offering-card">
              <h3>Your History</h3>
              <p>Competition results, training history, past performance.</p>
            </div>
            <div className="landing-offering-card">
              <h3>Your Training</h3>
              <p>Every workout, every score, every RPE, every quality rating.</p>
            </div>
          </div>
          <p style={{ ...bodyP, maxWidth: 760, margin: '32px auto 0', textAlign: 'center' }}>
            From those, the coach evaluates every part of your fitness — strength, conditioning, gymnastics, competition performance, and movement limitations — before recommending what comes next. It starts with your profile and gets sharper every time you train.
          </p>
          <div style={{ maxWidth: 920, margin: '32px auto 0' }}>
            {/* TODO: replace with full evaluation screenshot (a different view than the hero) */}
            <Placeholder label="[ Image placeholder — Full evaluation screenshot (different view than hero) ]" />
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
          </div>
        </div>
      </section>

      {/* ===== A Common Language for Fitness ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={featureRow}>
          <div style={featureCol}>
            <Eyebrow>A Common Language for Fitness</Eyebrow>
            <h2 style={sectionHeadline}>Fitness Needs a Common Language.</h2>
            <p style={bodyP}>
              A rowing workout doesn't look like a lifting workout. A two-minute sprint doesn't look like a twenty-minute grinder. The coach converts performance into a common measurement — watts and watts per kilogram — so progress can be tracked across every time domain on one scale.
            </p>
            <p style={{ ...bodyP, marginBottom: 8, fontWeight: 600, color: 'var(--text)' }}>Now you can see:</p>
            <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 16, lineHeight: 1.8, color: 'var(--text-dim)' }}>
              <li>What you're strong at</li>
              <li>Where you're weak</li>
              <li>What's improving</li>
              <li>What's stagnating</li>
            </ul>
            <p style={bodyP}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>…and where you stand:</span> Your numbers aren't read in isolation — they're compared against 15 million workouts, plus Open, Quarterfinal, and competition data. So you can see exactly where you rank and how far you are from the top 1%.
            </p>
          </div>
          <div style={featureCol}>
            {/* TODO: replace with power-duration curve + percentile/ranking screenshot */}
            <Placeholder label="[ Image placeholder — Power-duration curve + percentile / ranking view ]" />
          </div>
        </div>
      </section>

      {/* ===== Your Coach, Every Training Day ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={featureRow}>
          <div style={featureCol}>
            {/* TODO: replace with training-intent + coach-chat screenshots (rowing-pacing example) */}
            <Placeholder label="[ Image placeholder — Training-intent screen + coach chat (rowing-pacing example) ]" />
          </div>
          <div style={featureCol}>
            <Eyebrow>Your Coach, Every Training Day</Eyebrow>
            <h2 style={sectionHeadline}>Every Workout Has a Purpose.</h2>
            <p style={bodyP}>The coach doesn't just tell you what to do. For each session it explains:</p>
            <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 16, lineHeight: 1.8, color: 'var(--text-dim)' }}>
              <li>Why today's workout exists</li>
              <li>What adaptation you're chasing</li>
              <li>What success looks like</li>
              <li>How it fits into your goals</li>
            </ul>
            <p style={{ ...bodyP, marginBottom: 0 }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>Ask the Coach:</span> And when you have a question, the coach answers in context. It sees your profile, your history, today's workout, and your strengths and weaknesses — so the answer is specific to you, not generic internet advice. Your first three questions are free.
            </p>
          </div>
        </div>
      </section>

      {/* ===== It Learns From Every Workout ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>It Learns From Every Workout</Eyebrow>
          <h2 style={{ ...sectionHeadline, textAlign: 'center' }}>Your Coach Learns From Every Workout.</h2>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 28px' }}>
            <Flow steps={['Assessment', 'Training', 'Results', 'Updated Understanding', 'Better Decisions', '↻ Training']} />
          </div>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto 28px', textAlign: 'center' }}>
            Most programs stay fixed. Your coach adapts. Every score, every session, every piece of feedback sharpens the next decision. Over time it even learns to calibrate you — how your reported exertion and quality line up with your actual output — so its read on you keeps getting more accurate the longer you train. Your program isn't a fixed plan; it's a working model that adjusts to how you actually respond.
          </p>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {/* TODO: replace with the adaptation-cycle diagram */}
            <Placeholder label="[ Image placeholder — Adaptation cycle diagram ]" ratio="16 / 9" />
          </div>
        </div>
      </section>

      {/* ===== Explore the Platform ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <h2 style={{ ...sectionHeadline, textAlign: 'center' }}>Explore the Platform</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginTop: 32 }}>
            <div className="landing-offering-card">
              <h3>AI Programming</h3>
              <p>Training built around you.</p>
            </div>
            <div className="landing-offering-card">
              <h3>Analytics</h3>
              <p>Know if you're improving.</p>
            </div>
            <div className="landing-offering-card">
              <h3>Competition Intelligence</h3>
              <p>See where you stand.</p>
            </div>
            <div className="landing-offering-card">
              <h3>Nutrition</h3>
              <p>Support recovery and performance.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Divider ===== */}
      <div className="landing-container" style={{ padding: '0 24px' }}>
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
      </div>

      {/* ===== How to Work With Us ===== */}
      <section id="how-it-works" className="landing-explainer">
        <div className="landing-container">
          <h2 className="landing-section-title">Let's Make Some Gains</h2>
          <div className="landing-offerings-grid">
            <div className="landing-offering-card">
              <h3>AI Coach</h3>
              <p className="landing-offering-tagline">The brain of a Level 4 coach, available any time</p>
              <p>Get answers you can trust, grounded in the methodology. Or go deeper—switch to science mode and talk with an AI trained on physiology and biochemistry.</p>
              <Link to="/features/coaching" className="landing-offering-learn-more">See how it works &rarr;</Link>
            </div>
            <div className="landing-offering-card">
              <h3>AI Programming</h3>
              <p className="landing-offering-tagline">Stop following someone else's program.</p>
              <p>AI trained on the methodology builds your program, provides coaching guidance for every exercise, and adapts as you train. See your progress with our analytics. The program follows you.</p>
              <Link to="/features/programs" className="landing-offering-learn-more">See how it works &rarr;</Link>
            </div>
            <div className="landing-offering-card">
              <h3>Year of the Engine</h3>
              <p className="landing-offering-tagline">The best conditioning program, calibrated to you</p>
              <p>Custom targets for every training day, pacing each interval to your fitness. Machine learning targets each energy system independently. Real-time coaching guides you through every session. Analytics give you a window into your progress — share results with AI for even deeper insights.</p>
              <Link to="/features/engine" className="landing-offering-learn-more">See how it works &rarr;</Link>
            </div>
            <div className="landing-offering-card">
              <h3>AI Nutrition</h3>
              <p className="landing-offering-tagline">Tracking your training? Track your fuel.</p>
              <p>Log meals with photos, barcodes, or by searching millions of foods and restaurant menus. Build templates for your go-to meals. Track macros against your targets. Because what you put in is half the equation.</p>
              <Link to="/features/nutrition" className="landing-offering-learn-more">See how it works &rarr;</Link>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Link to="/auth?signup=1" className="landing-cta">Try it Free</Link>
            <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-dim)', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              Create a free account, quickly fill out a profile, and get personalized guidance from an AI coach trained on the methodology, plus an in-depth evaluation of your fitness — free!
            </p>
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-pricing">
        <div className="landing-container">
          <p style={{ textAlign: 'center', fontSize: 15, color: 'var(--text-dim)', maxWidth: 640, margin: '0 auto 24px', lineHeight: 1.6 }}>
            Personalized training and coaching for less than you'd pay for most group programs. Even bigger savings for quarterly plans and combined services.
          </p>
          <div className="landing-pricing-table">
            <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <button
                style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: pricingInterval === 'monthly' ? 'var(--accent)' : 'transparent', color: pricingInterval === 'monthly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                onClick={() => setPricingInterval('monthly')}
              >
                Monthly
              </button>
              <button
                style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: pricingInterval === 'quarterly' ? 'var(--accent)' : 'transparent', color: pricingInterval === 'quarterly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                onClick={() => setPricingInterval('quarterly')}
              >
                Quarterly
              </button>
            </div>
            <div className="landing-pricing-header">
              <span>Service</span>
              <span>{pricingInterval === 'monthly' ? 'Monthly' : 'Quarterly'}</span>
            </div>
            {[
              { plan: 'coach', name: 'AI Coach', monthly: '$7.99', quarterly: '$17.99' },
              { plan: 'nutrition', name: 'AI Nutrition', monthly: '$7.99', quarterly: '$17.99' },
              { plan: 'coach_nutrition', name: 'AI Coach + AI Nutrition', monthly: '$11.99', quarterly: '$29.99' },
              { plan: 'engine', name: 'AI Year of the Engine', monthly: '$29.99', quarterly: '$74.99', note: '(AI Coach and AI Nutrition included)' },
              { plan: 'programming', name: 'AI Programming', monthly: '$29.99', quarterly: '$74.99', note: '(AI Coach and AI Nutrition included)' },
              { plan: 'all_access', name: 'All Access', monthly: '$49.99', quarterly: '$119.99', note: '(AI Coach, AI Programming, YoE and AI Nutrition)' },
            ].map(p => (
              <div
                key={p.plan}
                className="landing-pricing-row"
              >
                <div>
                  <span className="landing-pricing-name">{p.name}</span>
                  {p.note && <div className="landing-pricing-note">{p.note}</div>}
                </div>
                <span className="landing-pricing-amount">
                  {pricingInterval === 'monthly' ? p.monthly : p.quarterly}
                </span>
              </div>
            ))}


          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="landing-faq">
        <div className="landing-container">
          <h2 className="landing-section-title">Frequently Asked Questions</h2>
          <div className="landing-faq-list">
            {FAQ_ITEMS.map((item, i) => (
              <div
                key={i}
                className={'landing-faq-item ' + (openFaq === i ? 'open' : '')}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <div className="landing-faq-question">
                  <span>{item.q}</span>
                  <svg className="landing-faq-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                {openFaq === i && <div className="landing-faq-answer">{item.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Final CTA ===== */}
      <section className="landing-footer-cta">
        <h2>Stop Doing Someone Else's Workout.</h2>
        <p style={{ fontSize: 17, color: 'var(--text-dim)', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.6 }}>
          Meet the coach that learns who you are, measures what matters, and adapts as you improve.
        </p>
        <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
      </section>

      <footer className="landing-footer">
        <GainsLogo />
      </footer>
    </div>
  );
}
