import { useState } from 'react';
import { gamesTestsIn, parseTime, type GamesTest, type Sex, type WeightUnit } from '../../lib/calculators/gamesBenchmarks';
import { useSharedChoice } from '../../lib/calculators/sharedLifts';
import { CalcCard, NumberField } from './CalculatorParts';
import GamesBar from './GamesBar';

/** A card of timed tests (rowing, gymnastics): one time box and one bar per test. */

function TimedTestRow({ test, sex, unit }: { test: GamesTest; sex: Sex; unit: WeightUnit }) {
  const [raw, setRaw] = useState('');
  return (
    <div className="calc-test-row">
      <NumberField
        id={`test-${test.id}`}
        label={`${test.label} (${test.higherIsBetter ? 'longest hold' : 'your time'})`}
        value={raw}
        onChange={setRaw}
        placeholder="m:ss"
        inputMode="text"
      />
      <GamesBar test={test} sex={sex} unit={unit} value={parseTime(raw)} showLabel={false} />
    </div>
  );
}

export default function TimedTestsCard({ group, title, blurb }: { group: GamesTest['group']; title: string; blurb: string }) {
  const [sex] = useSharedChoice<Sex>('pref:sex', 'men');
  const [unit] = useSharedChoice<WeightUnit>('pref:unit', 'lb');
  return (
    <CalcCard id={`tests_${group}`} title={title} blurb={blurb}>
      {gamesTestsIn(group).map((t) => <TimedTestRow key={t.id} test={t} sex={sex} unit={unit} />)}
    </CalcCard>
  );
}
