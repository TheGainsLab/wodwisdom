import { useState } from 'react';
import { parsePositive } from '../../lib/calculators/bands';
import {
  BALANCED_RATIO,
  ENERGY_MACHINES,
  UNIT_LABELS,
  computeEnergySystem,
  machineById,
  type EnergyUnit,
} from '../../lib/calculators/energySystem';
import { CalcCard, NumberField, ResultPanel, SelectField } from './CalculatorParts';
import { useCalculatorUsed } from '../../lib/calculators/useCalculatorUsed';

const UNIT_SUFFIX: Record<EnergyUnit, string> = { watts: 'W', meters: 'm', calories: 'cal' };

/** 30-second max ÷ 10-minute time trial, in watts, against a balanced 2.6. */
export default function EnergySystemCard() {
  const [machineId, setMachineId] = useState(ENERGY_MACHINES[0].id);
  const [unit, setUnit] = useState<EnergyUnit>('watts');
  const [sprint, setSprint] = useState('');
  const [trial, setTrial] = useState('');

  const machine = machineById(machineId);

  const changeMachine = (id: string) => {
    setMachineId(id);
    if (!machineById(id).units.includes(unit)) setUnit('watts');
  };

  const outcome = computeEnergySystem(machine, unit, parsePositive(sprint), parsePositive(trial));
  const result = outcome.ok ? outcome.result : null;
  useCalculatorUsed('energy_system', result?.band ?? null);

  const valueLabel = unit === 'watts' ? 'average watts' : `total ${UNIT_LABELS[unit].toLowerCase()}`;

  return (
    <CalcCard
      id="energy_system"
      title="Energy Systems Calculator"
      blurb={`Compare an all-out 30 seconds with a max-effort 10-minute time trial on the same machine. A balanced athlete's 30-second power is about ${BALANCED_RATIO}× their 10-minute power.`}
    >
      <div className="calc-fields">
        <SelectField
          id="energy-machine"
          label="Machine"
          value={machineId}
          onChange={changeMachine}
          options={ENERGY_MACHINES.map((m) => ({ value: m.id, label: m.label }))}
        />
        <SelectField
          id="energy-unit"
          label="Score entered in"
          value={unit}
          onChange={(v) => setUnit(v as EnergyUnit)}
          options={machine.units.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
        />
      </div>
      {unit === 'calories' && (
        <p className="calc-note">
          Whole calories are coarse over 30 seconds. {machine.units.includes('meters') ? 'Watts or meters give' : 'Watts give'} a more precise result.
        </p>
      )}
      <div className="calc-fields">
        <NumberField
          id="energy-sprint"
          label={`30-second max effort (${valueLabel})`}
          value={sprint}
          onChange={setSprint}
          suffix={UNIT_SUFFIX[unit]}
        />
        <NumberField
          id="energy-trial"
          label={`10-minute time trial (${valueLabel})`}
          value={trial}
          onChange={setTrial}
          suffix={UNIT_SUFFIX[unit]}
        />
      </div>

      {!outcome.ok && outcome.reason === 'sprint_not_higher' && (
        <p className="calc-warning" role="alert">
          Your 30-second power works out no higher than your 10-minute power. Check both numbers and the unit.
        </p>
      )}
      {!outcome.ok && outcome.reason === 'unconvertible' && (
        <p className="calc-warning" role="alert">
          Those numbers are too low to convert to watts. Check both numbers and the unit.
        </p>
      )}

      {result && (
        <ResultPanel
          ratio={result.ratio}
          target={result.target}
          deviation={result.deviation}
          band={result.band}
          label={result.reading.label}
          detail={result.reading.detail}
          lowLabel="Oxidative"
          highLabel="Glycolytic"
        >
          <div className="calc-result-watts">
            <span>30 seconds: <strong>{Math.round(result.sprintWatts)} W</strong></span>
            <span>10 minutes: <strong>{Math.round(result.trialWatts)} W</strong></span>
          </div>
        </ResultPanel>
      )}
    </CalcCard>
  );
}
