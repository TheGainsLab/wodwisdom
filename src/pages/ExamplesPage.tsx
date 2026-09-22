import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EXAMPLES_TABS,
  EXAMPLES_TAB_ORDER,
  EXAMPLE_ENTRIES,
  type ExamplesTab,
} from '../lib/examplesLibrary';
import { QAHeader } from '../components/QAShared';
import '../features.css';
import '../qa.css';

function isExamplesTab(v: string | null): v is ExamplesTab {
  return v !== null && v in EXAMPLES_TABS;
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
        </div>

        <div className="qa-cta-card">
          <p className="qa-cta-text">
            {signedIn
              ? 'Your own evaluation lives in your profile — and every session you log sharpens the picture.'
              : 'The evaluation is where yours starts. It’s free, takes a few minutes, and it’s yours to keep.'}
          </p>
          <Link
            to={signedIn ? '/profile' : '/auth?signup=1&next=/profile'}
            className="feature-cta qa-cta-btn"
          >
            {signedIn ? 'Open your profile' : 'Get Your Free Evaluation'}
          </Link>
        </div>
      </div>
    </div>
  );
}
