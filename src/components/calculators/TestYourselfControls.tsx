import type { Sex, WeightUnit } from '../../lib/calculators/gamesBenchmarks';
import { useSharedChoice } from '../../lib/calculators/sharedLifts';
import { Segmented } from './CalculatorParts';

/** Men / women and pounds / kilos for the whole "Test yourself" section. */
export default function TestYourselfControls() {
  const [sex, setSex] = useSharedChoice<Sex>('pref:sex', 'men');
  const [unit, setUnit] = useSharedChoice<WeightUnit>('pref:unit', 'lb');
  return (
    <div className="calc-controls">
      <Segmented
        label="Compare with"
        value={sex}
        onChange={setSex}
        options={[{ value: 'men', label: 'Men' }, { value: 'women', label: 'Women' }]}
      />
      <Segmented
        label="Weights in"
        value={unit}
        onChange={setUnit}
        options={[{ value: 'lb', label: 'Pounds' }, { value: 'kg', label: 'Kilos' }]}
      />
    </div>
  );
}
