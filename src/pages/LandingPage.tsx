import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

/** Inline styled plan name — bold + accent color, used throughout FAQs */
const PN: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <strong style={{ color: 'var(--accent)' }}>{children}</strong>
);

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
        <h1 className="landing-hero-title">The program that follows you.</h1>
        <p className="landing-hero-sub">
          We trained an AI on the CrossFit methodology: study guides, journal articles, seminars and more. This is the AI that speaks your language. Share some basic info and the AI builds a program tailored exactly to you, coaches every session and learns as you log your results, maximizing the impact of every training session.
        </p>
      </section>

      {/* ===== Divider ===== */}
      <div className="landing-container" style={{ padding: '0 24px' }}>
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
      </div>

      {/* ===== How to Work With Us ===== */}
      <section className="landing-explainer">
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

      <footer className="landing-footer">
        <GainsLogo />
      </footer>
    </div>
  );
}
