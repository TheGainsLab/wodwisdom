import type { ReactNode } from 'react';
import { LIFT_RATIO_CALCULATORS } from '../../lib/calculators/liftRatios';
import LiftRatioCard from './LiftRatioCard';
import EnergySystemCard from './EnergySystemCard';

/**
 * The calculators on /calculators, in page order, grouped under a heading.
 *
 * To add one:
 *  - another lift ratio: add an entry to LIFT_RATIO_CALCULATORS
 *    (src/lib/calculators/liftRatios.ts) — it appears here on its own;
 *  - anything else: put the maths in src/lib/calculators/, build a card from
 *    the pieces in CalculatorParts.tsx, and add it to a group below.
 */
export interface CalculatorGroup {
  id: string;
  title: string;
  intro: string;
  calculators: Array<{ id: string; render: () => ReactNode }>;
}

export const CALCULATOR_GROUPS: CalculatorGroup[] = [
  {
    id: 'energy_systems',
    title: 'Energy Systems Calculator',
    intro: 'Where your engine leans: toward short, high-power efforts or long, sustained ones.',
    calculators: [
      { id: 'energy_system', render: () => <EnergySystemCard /> },
    ],
  },
  {
    id: 'lifting',
    title: 'Lifting ratios',
    intro: 'How your Olympic lifts compare with your strength, and with each other. Enter a lift once and it fills in everywhere it is used.',
    calculators: LIFT_RATIO_CALCULATORS.map((calc) => ({
      id: calc.id,
      render: () => <LiftRatioCard calc={calc} />,
    })),
  },
];
