import {
  IMPLAUSIBLE_PCT,
  formatGamesValue,
  pctBucket,
  scoreGamesTest,
  type GamesTest,
  type Sex,
  type WeightUnit,
} from '../../lib/calculators/gamesBenchmarks';
import { useCalculatorUsed } from '../../lib/calculators/useCalculatorUsed';

/**
 * One "you vs Games athletes" result: a bar filled to the athlete's percent
 * of the Games average, the average it is measured against, and where the
 * number would sit in the field. `value` is in the test's stored unit
 * (pounds or seconds); null renders nothing.
 */
export default function GamesBar({ test, sex, unit, value, showLabel = true }: {
  test: GamesTest;
  sex: Sex;
  unit: WeightUnit;
  value: number | null;
  showLabel?: boolean;
}) {
  const result = scoreGamesTest(test, sex, value, unit);
  const implausible = result != null && result.pct > IMPLAUSIBLE_PCT;
  useCalculatorUsed(`games_${test.id}`, result && !implausible ? pctBucket(result.pct) : null);
  if (!result) return null;

  if (implausible) {
    return (
      <p className="calc-warning" role="alert">
        {showLabel ? `${test.label}: ` : ''}that is far beyond any Games result. Check the number{test.kind === 'weight' ? ' and the pounds / kilos switch' : ''}.
      </p>
    );
  }

  const pct = Math.round(result.pct * 100);
  const stat = result.stat;
  return (
    <div className="calc-bar-row" role="status" aria-live="polite">
      <div className="calc-bar-head">
        {showLabel && <span className="calc-bar-label">{test.label}</span>}
        <span className="calc-bar-pct">{pct}%</span>
      </div>
      <div
        className="calc-bar-track"
        role="img"
        aria-label={`${pct}% of the Games average`}
      >
        <span className={`calc-bar-fill${pct >= 100 ? ' is-full' : ''}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="calc-bar-meta">
        Games average {formatGamesValue(test, stat.mean, unit)} · {stat.n} athletes
      </div>
      {result.placementText && <div className="calc-bar-place">{result.placementText}</div>}
      {stat.note && <div className="calc-bar-note">{stat.note}</div>}
    </div>
  );
}
