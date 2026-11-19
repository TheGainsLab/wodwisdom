import { Fragment, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { QAHeader } from '../components/QAShared';
import { CALCULATOR_GROUPS } from '../components/calculators/registry';
import '../features.css';
import '../qa.css';
import '../calculators.css';

/**
 * Public calculators (/calculators): free, no account, no AI calls —
 * everything is computed in the browser and nothing typed here is saved.
 * Renders in both the signed-out and signed-in trees, like /examples.
 * The calculators themselves come from the registry, so adding one never
 * touches this page.
 */

const EVAL_SIGNUP = '/auth?signup=1&next=/profile';

function EvaluationLink({ signedIn, className }: { signedIn: boolean; className: string }) {
  return signedIn
    ? <Link to="/profile" className={className}>Open Your Evaluation</Link>
    : <Link to={EVAL_SIGNUP} className={className}>Get Your Free Evaluation</Link>;
}

export default function CalculatorsPage({ signedIn = false }: { signedIn?: boolean }) {
  useEffect(() => {
    document.body.classList.add('feature-body');
    document.title = 'Free Training Calculators | The Gains Lab';
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, []);

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <section className="feature-hero" style={{ paddingBottom: 36 }}>
        <h1 className="feature-hero-title">Training Calculators</h1>
        <p className="feature-hero-sub">
          Enter your numbers and see what they say about your training.
        </p>
        <p className="calc-hero-cta">
          Want the full picture?{' '}
          <EvaluationLink signedIn={signedIn} className="calc-inline-link" />
        </p>
      </section>

      <div className="calc-container">
        {CALCULATOR_GROUPS.map((group) => (
          <Fragment key={group.id}>
            <div className="calc-group-head">
              <h2 className="calc-group-title">{group.title}</h2>
              <p className="calc-group-intro">{group.intro}</p>
              {group.source && <p className="calc-group-source">{group.source}</p>}
              {group.controls?.()}
            </div>
            <div className="calc-grid">
              {group.calculators.map((c) => <Fragment key={c.id}>{c.render()}</Fragment>)}
            </div>
          </Fragment>
        ))}

        <div className="qa-cta-card" style={{ margin: '48px 0 0' }}>
          <h2 className="calc-cta-title">These are single numbers. Your evaluation looks at all of them.</h2>
          <p className="qa-cta-text">
            The free evaluation collects more data (your lifts, skills, conditioning and goals) and uses a frontier AI
            to analyze it. It's like a one-to-one coaching evaluation, probably more comprehensive, and free.
          </p>
          <EvaluationLink signedIn={signedIn} className="feature-cta qa-cta-btn" />
          {!signedIn && (
            <p className="calc-cta-foot">No credit card. Yours to keep.</p>
          )}
        </div>
      </div>
    </div>
  );
}
