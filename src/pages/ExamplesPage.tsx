import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EXAMPLES_TABS,
  EXAMPLES_TAB_ORDER,
  EXAMPLE_ENTRIES,
  EXAMPLE_WALKTHROUGHS,
  type ExamplesTab,
} from '../lib/examplesLibrary';
import { QAHeader } from '../components/QAShared';
import { useEntitlements } from '../hooks/useEntitlements';
import '../features.css';
import '../qa.css';

function isExamplesTab(v: string | null): v is ExamplesTab {
  return v !== null && v in EXAMPLES_TABS;
}

// Each tab's ask, placed once — right where its walkthrough story lands.
const CTA_PROMPTS: Record<ExamplesTab, string> = {
  evaluations:
    'You just read the whole thing. Yours takes about five minutes — free, no credit card, and yours to keep.',
  programming:
    'Everything above was generated for one athlete. Yours starts from the same free evaluation — no credit card, yours to keep.',
  engine:
    'That’s one athlete’s data. See where you stand first — the evaluation is free, takes about five minutes, and it’s yours to keep.',
  analytics:
    'Every chart above started as one athlete logging one workout. Yours starts with the free evaluation — no credit card, yours to keep.',
};

const CTA_SECONDARY: Record<ExamplesTab, { to: string; label: string }> = {
  evaluations: { to: '/features/programs', label: 'Explore AI Programming →' },
  programming: { to: '/features/programs', label: 'Explore AI Programming →' },
  engine: { to: '/features/engine', label: 'Explore AI Year of the Engine →' },
  analytics: { to: '/features/programs', label: 'Explore AI Programming →' },
};

function TabCta({ tab, signedIn }: { tab: ExamplesTab; signedIn: boolean }) {
  const secondary = CTA_SECONDARY[tab];
  // Session-scoped; empty set (never selling) while signed out or loading.
  const ent = useEntitlements();
  if (signedIn) {
    const fullyEntitled = ent.loading || ent.isAdmin || (ent.hasFeature('programming') && ent.hasEngineAccess);
    if (fullyEntitled) {
      // Nothing to sell — the quiet pointer home.
      return (
        <div className="qa-cta-card" style={{ margin: '0 0 56px' }}>
          <p className="qa-cta-text">
            Your own evaluation lives in your profile — and every session you log sharpens the picture.
          </p>
          <Link to="/profile" className="feature-cta qa-cta-btn">Open your profile</Link>
          <div style={{ marginTop: 16 }}>
            <Link to={secondary.to} style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
              {secondary.label}
            </Link>
          </div>
        </div>
      );
    }
    // Signed in but not (fully) subscribed: the funnel's next step is a
    // plan, not a profile tour. /pricing routes their buy through the
    // account-tied checkout.
    return (
      <div className="qa-cta-card" style={{ margin: '0 0 56px' }}>
        <p className="qa-cta-text">
          Everything above comes with a plan — built from your evaluation and profile, adjusted every time you log.
        </p>
        <Link to="/pricing" className="feature-cta qa-cta-btn">Choose Your Plan →</Link>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '14px 0 0' }}>
          or <Link to="/profile" style={{ color: 'var(--accent)', fontWeight: 600 }}>open your profile</Link>
        </p>
      </div>
    );
  }
  // Signed out: two intents, two buttons — the eval hook (solid, primary)
  // and the ready-to-buy door (outlined → /pricing, which works signed in
  // or out). The grey line serves returning eval-holders, who otherwise
  // get asked to redo a step they finished (the outreach-email audience).
  return (
    <div className="qa-cta-card" style={{ margin: '0 0 56px' }}>
      <p className="qa-cta-text">{CTA_PROMPTS[tab]}</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/auth?signup=1&next=/profile" className="feature-cta qa-cta-btn">
          Get Your Free Evaluation
        </Link>
        <Link
          to="/pricing"
          style={{ display: 'inline-block', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 9, padding: '13px 20px', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box', alignSelf: 'center' }}
        >
          Choose Your Plan →
        </Link>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '14px 0 0' }}>
        Already did the evaluation?{' '}
        <Link to="/auth?next=/profile" style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in</Link>
        {' '}— it’s waiting in your profile.
      </p>
    </div>
  );
}

/**
 * Public proof page (/examples): real evaluations, program excerpts, and
 * Engine analytics behind the product pages' "see real…" links. One page,
 * tabbed; ?tab= deep-links so each product page lands on its own evidence.
 * Coach answers stay at /qa — the fourth tab links there rather than
 * duplicating that library.
 */
export default function ExamplesPage({ signedIn = false }: { signedIn?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: ExamplesTab = isExamplesTab(tabParam) ? tabParam : 'evaluations';

  useEffect(() => {
    document.body.classList.add('feature-body');
    document.title = 'Real Examples | The Gains Lab';
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, []);

  const entries = EXAMPLE_ENTRIES.filter((e) => e.tab === tab);
  const walkthrough = EXAMPLE_WALKTHROUGHS[tab];

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <section className="feature-hero" style={{ paddingBottom: 36 }}>
        <h1 className="feature-hero-title">See it for real.</h1>
        <p className="feature-hero-sub">
          Real evaluations, real programming, real Engine analytics — actual outputs, not marketing mockups.
        </p>
      </section>

      <div className="feature-container" style={{ paddingBottom: 80 }}>
        <div className="qa-chips" role="tablist" aria-label="Example categories">
          {EXAMPLES_TAB_ORDER.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`qa-chip${tab === t ? ' active' : ''}`}
              onClick={() => setSearchParams({ tab: t }, { replace: true })}
            >
              {EXAMPLES_TABS[t]}
            </button>
          ))}
          <Link to="/qa" className="qa-chip" style={{ textDecoration: 'none' }}>
            Coach Answers →
          </Link>
        </div>

        <div style={{ maxWidth: 720, margin: '36px auto 0' }}>
          {walkthrough && (
            <section style={{ marginBottom: 56 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px', color: 'var(--text)' }}>
                {walkthrough.title}
              </h2>
              <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.55, margin: '0 0 28px' }}>
                {walkthrough.intro}
              </p>
              {walkthrough.steps.map((s, i) => (
                <figure key={s.image} style={{ margin: '0 0 40px' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--text)' }}>
                    <span style={{ color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginRight: 8 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.title}
                  </h3>
                  <figcaption style={{ color: 'var(--text-dim)', fontSize: 14.5, lineHeight: 1.55, margin: '0 0 14px' }}>
                    {/* Captions carry \n\n paragraph breaks (founder copy). */}
                    {s.caption.split('\n\n').map((para, j) => (
                      <p key={j} style={{ margin: j === 0 ? 0 : '10px 0 0' }}>{para}</p>
                    ))}
                  </figcaption>
                  <img src={s.image} alt={s.alt} loading="lazy" className="feature-img" style={{ maxWidth: 420 }} />
                </figure>
              ))}
            </section>
          )}
          <TabCta tab={tab} signedIn={signedIn} />
          {entries.map((e) => (
            <figure key={e.image} style={{ margin: '0 0 48px' }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', color: 'var(--text)' }}>
                {e.title}
              </h3>
              <figcaption style={{ color: 'var(--text-dim)', fontSize: 14.5, lineHeight: 1.55, margin: '0 0 14px' }}>
                {e.caption}
              </figcaption>
              <img src={e.image} alt={e.alt} loading="lazy" className="feature-img" />
            </figure>
          ))}
          {/* Slim repeat for readers who scrolled past the card; the
              evaluations tab has no gallery, so it already ends on the card. */}
          {!signedIn && entries.length > 0 && (
            <p style={{ textAlign: 'center', fontSize: 15, color: 'var(--text-dim)', margin: '8px 0 0' }}>
              Ready to see yours?{' '}
              <Link to="/auth?signup=1&next=/profile" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
                Get your free evaluation &rarr;
              </Link>
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
