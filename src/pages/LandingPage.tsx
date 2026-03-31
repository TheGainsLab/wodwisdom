import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What sources does WodWisdom use?',
    a: 'WodWisdom is built on hundreds of articles from the CrossFit Journal, exercise physiology textbooks, and the CrossFit Kids Training Guide. Every answer includes source citations so you can verify the information.',
  },
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
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const goToAuth = () => navigate('/auth');
  const goToSignup = () => navigate('/auth?signup=1');

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
          We trained an AI on the CrossFit methodology — every study guide, journal article, and seminar.
          It knows your lifts, your skills, your engine, and your nutrition. It builds your program,
          coaches every session, and gets smarter every time you train.
        </p>
        <p className="landing-hero-tagline">
          This isn't a program you follow. It's a program that follows you.
        </p>
        <div className="landing-hero-ctas">
          <button className="landing-cta" onClick={goToSignup}>Try it Free</button>
          <Link to="/features" className="landing-cta landing-cta-outline">See How It Works</Link>
        </div>
      </section>

      {/* ===== How to Work With Us ===== */}
      <section className="landing-explainer">
        <div className="landing-container">
          <h2 className="landing-section-title">How to Work With Us</h2>
          <div className="landing-offerings-grid">
            <div className="landing-offering-card">
              <h3>AI Coach</h3>
              <p className="landing-offering-tagline">The brain of a Level 4 coach, available any time</p>
              <p>Get answers you can trust, grounded in the methodology. Want to nerd out on something? Flip on science mode and talk with an AI trained on physiology and biochemistry.</p>
              <Link to="/features/coaching" className="landing-offering-learn-more">Learn more &rarr;</Link>
            </div>
            <div className="landing-offering-card">
              <h3>AI Programming</h3>
              <p className="landing-offering-tagline">Stop following someone else's program. Get the program that follows you.</p>
              <p>The AI learns your lifts, skills, and conditioning, then builds a personalized program — warm-ups through metcons — with coaching cues for every session. Log results and it adapts. The program follows you.</p>
              <Link to="/features/programs" className="landing-offering-learn-more">Learn more &rarr;</Link>
            </div>
            <div className="landing-offering-card">
              <h3>Year of the Engine</h3>
              <p className="landing-offering-tagline">The best conditioning program, calibrated to you</p>
              <p>The app learns your Engine and sets a custom target for every training day. Machine learning targets each energy system independently. The app coaches you through each session in real time with pacing targets. Analytics show your Engine in unmatched detail.</p>
              <Link to="/features/engine" className="landing-offering-learn-more">Learn more &rarr;</Link>
            </div>
            <div className="landing-offering-card">
              <h3>Nutrition</h3>
              <p className="landing-offering-tagline">Track your fuel as easily as you track your training</p>
              <p>Log meals with photos, barcodes, or by searching a database of millions of foods and restaurant menus. Build templates for your go-to meals and track macros against your targets.</p>
              <Link to="/features/nutrition" className="landing-offering-learn-more">Learn more &rarr;</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-pricing">
        <div className="landing-container">
          <div className="landing-pricing-table">
            <div className="landing-pricing-header">
              <span>Service</span>
              <span>Monthly</span>
            </div>
            <div className="landing-pricing-row">
              <span className="landing-pricing-name">AI Coach</span>
              <span className="landing-pricing-amount">$7.99</span>
            </div>
            <div className="landing-pricing-row">
              <span className="landing-pricing-name">Year of the Engine</span>
              <span className="landing-pricing-amount">$29.99</span>
            </div>
            <div className="landing-pricing-note">(AI Coach included)</div>
            <div className="landing-pricing-row">
              <span className="landing-pricing-name">AI Programming</span>
              <span className="landing-pricing-amount">$29.99</span>
            </div>
            <div className="landing-pricing-note">(AI Coach included)</div>
            <div className="landing-pricing-row">
              <span className="landing-pricing-name">All Access</span>
              <span className="landing-pricing-amount">$49.99</span>
            </div>
            <div className="landing-pricing-note">(AI Coach, YoE and AI Programming)</div>
            <button className="landing-cta" onClick={goToSignup} style={{marginTop: '28px', width: '100%'}}>Try it Free</button>
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
