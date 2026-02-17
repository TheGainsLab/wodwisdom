import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
            <span className="landing-logo">W</span>
            <span className="landing-brand-name">WodWisdom</span>
          </div>
          <nav className="landing-nav">
            <a href="#how-it-works">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="landing-signin-btn" onClick={goToAuth}>Sign In</button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="landing-hero">
        <h1 className="landing-hero-title">Fitness intelligence.</h1>
        <p className="landing-hero-sub">
          Every journal article, seminar, and study guide — trained into one AI, available 24/7.
        </p>
        <button className="landing-cta" onClick={goToAuth}>Get Started Free</button>
      </section>

      {/* ===== Explainer ===== */}
      <section className="landing-explainer">
        <div className="landing-container">
          <h2 className="landing-section-title">Bigger brains, bigger gains</h2>
          <div className="landing-explainer-grid">
            <p>
              Every CrossFit journal article, seminar, and study guide, trained into one AI.{' '}
              A coach who has learned everything and never forgets a word — and never sleeps.{' '}
              The information you need all in one place. No need to dig around online or flip through social media reels for a cue or a hint. It's all here.
            </p>
            <p>
              Flip on Science Mode and go deeper. We trained WodWisdom on graduate-level physiology
              texts — so when you want to geek out and get technical, it's there.
            </p>
          </div>
        </div>
      </section>

      {/* ===== See It In Action ===== */}
      <section className="landing-demo">
        <div className="landing-container">
          <h2 className="landing-section-title">See it in action</h2>
          <div className="landing-demo-grid">
            {/* Athlete demo */}
            <div className="landing-demo-card">
              <span className="landing-demo-label">Athlete</span>
              <div className="landing-demo-q">
                <div className="msg-body user">What are the points of performance for the overhead squat?</div>
              </div>
              <div className="landing-demo-a">
                <div className="msg-header">
                  <span className="msg-avatar">W</span>
                </div>
                <div className="msg-body assistant">
                  <p>
                    The overhead squat demands <strong>midline stabilization</strong> and active shoulders above
                    everything else. The bar sits slightly behind the head with arms locked out, armpits facing
                    forward, and the shoulder blades pulled together and down. Your stance should be just outside
                    shoulder width with toes turned out about 30 degrees.
                  </p>
                  <p>
                    As you descend, push your knees out over your toes, keep your chest tall, and drive your
                    weight through your heels. The bar should stay over the midfoot throughout the entire range of
                    motion — if it drifts forward, you lose it. Full depth means the hip crease passes below the
                    top of the knee while maintaining a neutral spine. Glassman calls this movement the
                    "ultimate core exercise" because any deficiency in stability or mobility is immediately exposed.
                  </p>
                </div>
                <div className="sources-bar">
                  <span className="sources-label">Sources</span>
                  <span className="source-chip">CrossFit Journal — The Overhead Squat</span>
                </div>
              </div>
            </div>
            {/* Coach demo */}
            <div className="landing-demo-card">
              <span className="landing-demo-label">Coach</span>
              <div className="landing-demo-q">
                <div className="msg-body user">How should I scale thrusters for a class with mixed experience levels?</div>
              </div>
              <div className="landing-demo-a">
                <div className="msg-header">
                  <span className="msg-avatar">W</span>
                </div>
                <div className="msg-body assistant">
                  <p>
                    Think in <strong>three tiers</strong> based on movement competency, not just strength.
                    Newer athletes should use a PVC pipe or training bar and focus on hitting full depth with an
                    upright torso — the front squat to push press is the progression. If they can't maintain
                    midline stability under load, the weight is too heavy regardless of what's prescribed.
                  </p>
                  <p>
                    Intermediate athletes can load the barbell but should stay at a weight where they can complete
                    at least 5 reps unbroken with good mechanics. Advanced athletes work at the prescribed load.
                    The key coaching cue across all levels: <strong>"elbows high and outside, drive through the
                    heels, press as you stand."</strong> This keeps the movement connected and prevents the common
                    fault of pressing early and losing the squat.
                  </p>
                </div>
                <div className="sources-bar">
                  <span className="sources-label">Sources</span>
                  <span className="source-chip">CrossFit Level 2 Training Guide</span>
                  <span className="source-chip">CrossFit Journal — Scaling</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Who It's For ===== */}
      <section className="landing-audience">
        <div className="landing-container">
          <h2 className="landing-section-title">Built for the CrossFit community</h2>
          <div className="landing-audience-grid">
            <div className="landing-audience-card">
              <div className="landing-audience-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>
              </div>
              <h3>Coaches</h3>
              <p>You're the intelligence layer between the workouts and the athletes. Coaches turn a program turn it into a personalized experience — pacing guidance, movement cues, scaling, warm-ups, the works. WodWisdom gives you instant access to the full methodology so you can deliver outstanding training every time. Walk into every class prepared.</p>
            </div>
            <div className="landing-audience-card">
              <div className="landing-audience-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
              </div>
              <h3>Athletes</h3>
              <p>Your program was built by a great coach. But it's built for everyone, not for you. WodWisdom turns a program into your program. Get personalized pacing guidance, warm-up and mobility work, and scaling options that match your level. Ask it to review your performance and suggest work you can do on your own. Same program, better results.</p>
            </div>
            <div className="landing-audience-card">
              <div className="landing-audience-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              </div>
              <h3>Gym Owners</h3>
              <p>Fitness and helping others are your passion and your livelihood. WodWisdom handles the details that separate an average gym from a great one — and that keep members coming back. Review programming, generate class briefings, write warm-ups and cool-downs, surface movement cues your coaches can use on the spot. Add up to three coaches to your account so your entire team has full access to the knowledge base. Make every class excellent.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== How It Works ===== */}
      <section id="how-it-works" className="landing-steps">
        <div className="landing-container">
          <h2 className="landing-section-title">How it works</h2>
          <div className="landing-steps-grid">
            <div className="landing-step">
              <h3>You ask</h3>
              <p>Ask anything related to fitness, training, nutrition, programming and more. General questions, specific questions, any questions. Review workouts. Nutrition planning. Anything and everything health and fitness.</p>
            </div>
            <div className="landing-step">
              <h3>We search</h3>
              <p>Our AI is trained to search thousands of journal articles, study guides, seminar content and more. Flip on science mode and gain access to graduate level anatomy, physiology and biochemistry.</p>
            </div>
            <div className="landing-step">
              <h3>You get the answer</h3>
              <p>Get a clear, sourced answer. WodWisdom thoroughly answers your question, and sources every article so you can dig in further. Need a quick answer? Click summarize and get a bulleted list. Bookmark it for easy reference, and fire away with follow up questions.</p>
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
              <div className="landing-price">$4.99<span>/mo</span></div>
              <ul className="landing-pricing-features">
                <li>Unlimited questions</li>
                <li>Full source library</li>
                <li>Bookmarks & summaries</li>
                <li>Search history</li>
              </ul>
              <button className="landing-cta" onClick={goToAuth}>Start Free Trial</button>
            </div>
            <div className="landing-pricing-card featured">
              <div className="landing-pricing-badge">Best for teams</div>
              <h3>Gym</h3>
              <div className="landing-price">$19.99<span>/mo</span></div>
              <ul className="landing-pricing-features">
                <li>Everything in Coach</li>
                <li>Up to 3 coach seats</li>
                <li>Gym dashboard</li>
                <li>Invite & manage coaches</li>
              </ul>
              <button className="landing-cta" onClick={goToAuth}>Start Free Trial</button>
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
        <button className="landing-cta" onClick={goToAuth}>Get Started Free</button>
      </section>

      <footer className="landing-footer">
        WodWisdom
      </footer>
    </div>
  );
}
