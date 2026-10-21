import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import FeatureFooter from '../../components/FeatureFooter';
import '../../features.css';

/**
 * /features/research — the AI Research marketing page.
 *
 * No screenshots yet: the centerpiece is a styled excerpt of a REAL
 * Talk-to-the-Research exchange, because the product's pitch IS its output.
 * The excerpt below is condensed from an actual library answer (the
 * conditioning question, 2026-10) — edit it only against a real transcript.
 */

const bubble: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
  padding: '14px 16px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', textAlign: 'left',
};

export default function ResearchFeaturePage() {
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
        <span className="feature-hero-badge">AI Research</span>
        <h1 className="feature-hero-title">Talk to the Research.</h1>
        <p className="feature-hero-sub">
          A research library built for coaches and athletes. Every paper translated into plain
          coaching terms — and an AI that answers your questions from the papers, with citations.
          Reading is free.
        </p>
      </section>

      {/* The library */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>The papers, already read</h3>
              <p>
                Exercise science is written for journals, not gyms. We read each paper and translate
                it: what the study actually found, what it means for training — and just as
                important, what it <em>doesn&apos;t</em> mean.
              </p>
              <ul>
                <li>Plain-language headline and key findings for every paper</li>
                <li>The data, the charts, and the full citation — all on the page</li>
                <li>A coach&apos;s guide: what to do with it in the gym</li>
              </ul>
            </div>
            <div className="feature-screenshot" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={bubble}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>From a library entry</div>
                <strong style={{ color: 'var(--text)' }}>Doing aerobic training alongside strength training does not reduce strength or muscle gains, but it does blunt explosive-strength gains.</strong>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>Schumann et al. (2022) · Sports Medicine</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Talk to it */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Ask it anything</h3>
              <p>
                Type a question and the AI finds the papers that bear on it, reads them, and answers —
                naming its sources as it goes. One question can draw on several papers at once, and
                disagreements between studies are presented as disagreements, never blended away.
              </p>
            </div>
            <div className="feature-screenshot" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ ...bubble, background: 'var(--accent)', color: '#fff', border: 'none', alignSelf: 'flex-end', maxWidth: '85%' }}>
                I want to improve my conditioning — where do I start?
              </div>
              <div style={bubble}>
                The library has three papers that speak directly to this. <strong style={{ color: 'var(--text)' }}>Energy System Interaction</strong> establishes
                the landscape: a 10-second all-out effort is ~94% anaerobic, but by 2 minutes it&apos;s 63% aerobic.
                <strong style={{ color: 'var(--text)' }}> Short-term sprint interval vs. traditional endurance training</strong> showed
                6 sessions of 30-second sprints matched 90–120 minutes of steady work — with ~90% less volume.
                And <strong style={{ color: 'var(--text)' }}>Multiple Sprint Work</strong> adds that recovery between hard efforts is itself an
                aerobic process…
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Honesty */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Built to be trusted</h3>
              <p>
                Most AI will answer anything, sources or not. This one is bound to the library: every
                number it cites must name its paper, the papers&apos; own caveats are binding, and when
                the research doesn&apos;t cover your question, it says exactly that.
              </p>
              <ul>
                <li>Every claim cites its paper — tap through and check</li>
                <li>Anything beyond the papers is labeled as beyond the papers</li>
                <li>No invented studies, numbers, or quotes. Ever.</li>
              </ul>
            </div>
            <div className="feature-screenshot" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={bubble}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>The honesty rule, in action</div>
                &ldquo;The key caveat the authors are clear about: <strong style={{ color: 'var(--text)' }}>this is an open question, not a solved
                one.</strong> They raise it as a promising mechanism, not a validated programming tool.&rdquo;
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Reading is free</h2>
        <p className="feature-footer-details">
          Browse every paper with no account. Create a free account and the AI answers your first
          questions free. AI Research is $9.99/month for unlimited daily use — and it&apos;s included
          with All Access. Coaches: this one&apos;s built for you.
        </p>
        <div className="feature-footer-actions" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="feature-cta" onClick={() => { window.location.href = '/knowledge'; }}>Open the Library</button>
          <button className="feature-cta" onClick={() => { window.location.href = '/pricing'; }}>See Pricing</button>
        </div>
      </section>

      <FeatureFooter />
    </div>
  );
}
