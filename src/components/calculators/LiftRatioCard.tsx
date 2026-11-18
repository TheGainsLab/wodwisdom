import { parsePositive } from '../../lib/calculators/bands';
import { computeLiftRatio, type LiftRatioCalculator } from '../../lib/calculators/liftRatios';
import { CalcCard, NumberField, ResultPanel } from './CalculatorParts';
import { useCalculatorUsed } from '../../lib/calculators/useCalculatorUsed';
import { useSharedLift } from '../../lib/calculators/sharedLifts';

/** One lift-vs-lift ratio: two numbers in, ratio and reading out. Each box
 *  shares its value with the same lift on the other cards. */
export default function LiftRatioCard({ calc }: { calc: LiftRatioCalculator }) {
  const [a, setA] = useSharedLift(calc.liftAKey);
  const [b, setB] = useSharedLift(calc.liftBKey);
  const result = computeLiftRatio(calc, parsePositive(a), parsePositive(b));
  useCalculatorUsed(calc.id, result?.band ?? null);

  return (
    <CalcCard
      id={calc.id}
      title={calc.title}
      blurb={`Enter your best ${calc.liftA.toLowerCase()} and ${calc.liftB.toLowerCase()}, both in pounds or both in kilos. Target ratio: ${calc.target.toFixed(2)}.`}
    >
      <div className="calc-fields">
        <NumberField id={`${calc.id}-a`} label={calc.liftA} value={a} onChange={setA} placeholder="e.g. 185" />
        <NumberField id={`${calc.id}-b`} label={calc.liftB} value={b} onChange={setB} placeholder="e.g. 315" />
      </div>
      {result && (
        <ResultPanel
          ratio={result.ratio}
          target={result.target}
          deviation={result.deviation}
          band={result.band}
          label={result.reading.label}
          detail={result.reading.detail}
          lowLabel={`${calc.liftA} low`}
          highLabel={`${calc.liftA} high`}
        />
      )}
    </CalcCard>
  );
}
