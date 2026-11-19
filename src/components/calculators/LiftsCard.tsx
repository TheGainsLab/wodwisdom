import { parsePositive } from '../../lib/calculators/bands';
import { gamesTestsIn, toPounds, type Sex, type WeightUnit } from '../../lib/calculators/gamesBenchmarks';
import { LIFT_RATIO_CALCULATORS, computeLiftRatio, type LiftKey, type LiftRatioCalculator } from '../../lib/calculators/liftRatios';
import { useSharedChoice, useSharedLift } from '../../lib/calculators/sharedLifts';
import { useCalculatorUsed } from '../../lib/calculators/useCalculatorUsed';
import { CalcCard, NumberField, ResultPanel } from './CalculatorParts';
import GamesBar from './GamesBar';

/**
 * "Your lifts": each lift is entered ONCE, and everything that uses it
 * appears below — a bar against Games athletes for each lift entered, and
 * each ratio as soon as both of its lifts are in.
 */

const LIFT_TESTS = gamesTestsIn('lifts');

function LiftInput({ liftKey, label, unit }: { liftKey: LiftKey; label: string; unit: WeightUnit }) {
  const [value, setValue] = useSharedLift(liftKey);
  return <NumberField id={`lift-${liftKey}`} label={label} value={value} onChange={setValue} suffix={unit} />;
}

function RatioResult({ calc, a, b }: { calc: LiftRatioCalculator; a: number | null; b: number | null }) {
  const result = computeLiftRatio(calc, a, b);
  useCalculatorUsed(calc.id, result?.band ?? null);
  if (!result) return null;
  return (
    <ResultPanel
      title={calc.title}
      ratio={result.ratio}
      target={result.target}
      deviation={result.deviation}
      band={result.band}
      label={result.reading.label}
      detail={result.reading.detail}
      lowLabel={`${calc.liftA} low`}
      highLabel={`${calc.liftA} high`}
    />
  );
}

export default function LiftsCard() {
  const [sex] = useSharedChoice<Sex>('pref:sex', 'men');
  const [unit] = useSharedChoice<WeightUnit>('pref:unit', 'lb');
  const lifts: Record<LiftKey, number | null> = {
    back_squat: parsePositive(useSharedLift('back_squat')[0]),
    front_squat: parsePositive(useSharedLift('front_squat')[0]),
    strict_press: parsePositive(useSharedLift('strict_press')[0]),
    deadlift: parsePositive(useSharedLift('deadlift')[0]),
    snatch: parsePositive(useSharedLift('snatch')[0]),
    clean_jerk: parsePositive(useSharedLift('clean_jerk')[0]),
  };
  const anyLift = Object.values(lifts).some((v) => v != null);
  const anyRatio = LIFT_RATIO_CALCULATORS.some((c) => lifts[c.liftAKey] != null && lifts[c.liftBKey] != null);

  return (
    <CalcCard
      id="your_lifts"
      title="Your lifts"
      blurb="Enter your best lifts once. Fill in as many as you know."
    >
      <div className="calc-fields calc-fields-3">
        {LIFT_TESTS.map((t) => <LiftInput key={t.id} liftKey={t.liftKey!} label={t.label} unit={unit} />)}
      </div>

      <h3 className="calc-sub">Against Games athletes</h3>
      {anyLift ? (
        <div className="calc-bars">
          {LIFT_TESTS.map((t) => {
            const v = lifts[t.liftKey!];
            return <GamesBar key={t.id} test={t} sex={sex} unit={unit} value={v == null ? null : toPounds(v, unit)} />;
          })}
        </div>
      ) : (
        <p className="calc-empty">Enter a lift to see how it compares.</p>
      )}

      <h3 className="calc-sub">Your ratios</h3>
      {anyRatio ? (
        LIFT_RATIO_CALCULATORS.map((c) => <RatioResult key={c.id} calc={c} a={lifts[c.liftAKey]} b={lifts[c.liftBKey]} />)
      ) : (
        <p className="calc-empty">
          Enter a back squat with a snatch or a clean &amp; jerk (or both Olympic lifts) to see how they compare.
        </p>
      )}
    </CalcCard>
  );
}
