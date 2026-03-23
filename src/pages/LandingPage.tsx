import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

const FAQ_ITEMS = [
  {
    q: 'What sources does WodWisdom use?',
    a: 'WodWisdom is built on hundreds of articles from the CrossFit Journal, exercise physiology textbooks, and the CrossFit Kids Training Guide. Every answer includes source citations so you can verify the information.',
  },
  {
    q: 'Is this an official CrossFit product?',
    a: 'No. WodWisdom is an independent tool built by coaches, for coaches. It uses publicly available CrossFit educational materials as its knowledge base.',
  },
  {
    q: 'Can I try it before paying?',
    a: 'Yes! Every new account gets 3 free questions so you can see the quality of answers before committing to a subscription.',
  },
  {
    q: "What's the difference between the Coach and Gym plans?",
    a: 'The Coach plan is for individuals. The Gym plan includes up to 3 coach seats so you can invite your coaching staff, plus a management dashboard to add and remove team members.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. There are no contracts or commitments. You can cancel your subscription at any time and retain access through the end of your billing period.',
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
              <p>Ask anything about training, nutrition, movement, or recovery. Get answers from an AI that speaks your language — not generic fitness advice. Pacing strategy, movement cues, scaling options, competition prep, skills practice. Whatever you need, just ask.</p>
              <p>Share your current training and get it optimized. Build a nutrition plan using your own data. The AI understands context — it doesn't just answer questions, it coaches.</p>
              <p><strong>Science mode</strong> — Want a comprehensive overview of carbohydrate metabolism? How calcium ion concentration affects muscle contractions? Switch to science mode — a separate AI trained on biochemistry and physiology — and go as deep as you want.</p>
            </div>
            <div className="landing-offering-card">
              <h3>AI Programming</h3>
              <p><strong>Stop following someone else's program. Get the program that follows you.</strong></p>
              <p>Any AI can write a program. This is different. Our AI was trained on the CrossFit methodology and millions of historical workout data points — then it learns everything about you before writing a single rep.</p>
              <p>Enter your 1RMs, skill levels, and conditioning data. The AI analyzes your fitness in depth, identifies your limiters, and builds a personalized 20-day program — warm-ups, mobility, skills work, strength blocks, and metcons assembled specifically for you.</p>
              <p><strong>Coached every session</strong> — Every training day opens with the intent behind the session — the why behind every set and rep. Every block comes with coaching cues, movement standards, and common faults to avoid. It's like having a coach by your side every time you train. And if you have questions before you start, just ask — the AI is already there.</p>
              <p><strong>Ongoing and adaptive</strong></p>
              <ul>
                <li>Traveling with only a hotel gym? Tell the AI. Your program updates for those days.</li>
                <li>Prepping for a competition and need to drill specific skills? The AI tells you exactly where to insert them.</li>
                <li>Log results and the AI adjusts. Demonstrate proficiency and receive harder progressions.</li>
                <li>Each month, your profile is reviewed and your evaluation updated. Over time, your assessments tell the story of your development as an athlete.</li>
              </ul>
            </div>
            <div className="landing-offering-card">
              <h3>The Year of the Engine</h3>
              <p>Engine isn't one parameter — it's many. Aerobic capacity. Anaerobic power. Threshold. Efficiency. Repeatability. These don't increase in lockstep, and your training history determines where each one starts. Treating them as a single system means dragging weak links along and holding strong ones back.</p>
              <p>Forcing everyone into the same program doesn't make sense. So we don't.</p>
              <p><strong>Year of the Engine AI</strong></p>
              <p>The Year of the Engine is built on 20 distinct training frameworks, each independently targeting a specific adaptation. Machine learning calibrates every session precisely to you — not just the program, but every individual interval and every personal target within it.</p>
              <p>High aerobic capacity? You'll get aggressive goals. Building anaerobic power? Each session ramps as you progress. You always know what you're trying to hit and why — before the clock starts.</p>
              <p>Once it does, the app becomes your pacing coach. Goals, countdowns, and round context stay front and center through fatigue so you execute the plan and get exactly the stimulus you need.</p>
              <p>No one-size-fits-all program can deliver this. Year of the Engine does.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-pricing">
        <div className="landing-container">
          <h2 className="landing-section-title">Simple pricing</h2>
          <p className="landing-section-sub">Start with 3 free questions. Upgrade when you're ready.</p>
          <div className="landing-pricing-grid">
            <div className="landing-pricing-card">
              <h3>Coach</h3>
              <div className="landing-price">$7.99<span>/mo</span></div>
              <ul className="landing-pricing-features">
                <li>Unlimited questions</li>
                <li>Full source library</li>
                <li>Bookmarks & summaries</li>
                <li>Search history</li>
              </ul>
              <button className="landing-cta" onClick={goToSignup}>Try it Free</button>
            </div>
            <div className="landing-pricing-card featured">
              <div className="landing-pricing-badge">Best for teams</div>
              <h3>Gym</h3>
              <div className="landing-price">$24.99<span>/mo</span></div>
              <ul className="landing-pricing-features">
                <li>Everything in Coach</li>
                <li>Up to 3 coach seats</li>
                <li>Gym dashboard</li>
                <li>Invite & manage coaches</li>
              </ul>
              <button className="landing-cta" onClick={goToSignup}>Try it Free</button>
            </div>
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

      {/* ===== Footer CTA ===== */}
      <section className="landing-footer-cta">
        <h2>The best coaches never stop learning.</h2>
        <button className="landing-cta" onClick={goToSignup}>Try it Free</button>
      </section>

      <footer className="landing-footer">
        <GainsLogo />
      </footer>
    </div>
  );
}
