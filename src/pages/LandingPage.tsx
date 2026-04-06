import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Can I try it before paying?',
    a: 'Yes! Every new account gets 3 free questions so you can see the quality of answers before committing to a subscription.',
  },
  {
    q: "What's the difference between the plans?",
    a: 'AI Coach gives you unlimited AI-powered coaching questions. Year of the Engine and AI Programming are full training programs that include AI Coach. All Access bundles everything together at a discount.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. There are no contracts or commitments. You can cancel your subscription at any time and retain access through the end of your billing period.',
  },
  {
    q: 'If I sign up for Year of the Engine, do I get AI Coach and Nutrition for free?',
    a: <>Yes. All <strong>Year of the Engine</strong> subscribers also get access to the <strong>AI Coach</strong> feature with 10 questions a day and the <strong>Nutrition</strong> feature with unlimited usage at no additional cost.</>,
  },
  {
    q: 'If I sign up for AI Programming, do I get access to AI Coach and Nutrition for free?',
    a: <>Yes. All <strong>AI Programming</strong> subscribers also get access to the <strong>AI Coach</strong> feature with 20 questions a day and the <strong>Nutrition</strong> feature with unlimited usage at no additional cost.</>,
  },
  {
    q: 'What is included in the All Access membership?',
    a: <>All Access members get access to <strong>AI Programming</strong>, <strong>Year of the Engine</strong>, <strong>AI Coach</strong>, and <strong>Nutrition</strong>. All of this for under $50 a month.</>,
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

      {/* ===== How to Work With Us ===== */}
      <section className="landing-explainer">
        <div className="landing-container">
          <h2 className="landing-section-title">What we offer</h2>
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
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-pricing">
        <div className="landing-container">
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
          <h2 className="landing-section-title">Frequently asked questions</h2>
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
