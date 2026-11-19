import type { ReactNode } from 'react';
import EnergySystemCard from './EnergySystemCard';
import LiftsCard from './LiftsCard';
import TimedTestsCard from './TimedTestsCard';
import TestYourselfControls from './TestYourselfControls';

/**
 * The sections of /calculators, in page order.
 *
 * To add something:
 *  - another Games test: one entry in GAMES_TESTS
 *    (src/lib/calculators/gamesBenchmarks.ts) — it appears in its card;
 *  - another lift ratio: one entry in LIFT_RATIO_CALCULATORS
 *    (src/lib/calculators/liftRatios.ts) — it appears under "Your ratios";
 *  - anything else: put the maths in src/lib/calculators/, build a card from
 *    the pieces in CalculatorParts.tsx, and add it to a group below.
 */
export interface CalculatorGroup {
  id: string;
  title: string;
  intro: string;
  /** Switches that apply to every card in the group. */
  controls?: () => ReactNode;
  /** Small print under the intro (e.g. where the data comes from). */
  source?: string;
  calculators: Array<{ id: string; render: () => ReactNode }>;
}

export const CALCULATOR_GROUPS: CalculatorGroup[] = [
  {
    id: 'energy_systems',
    title: 'Energy systems',
    intro: 'Where your engine leans: toward short, high-power efforts or long, sustained ones.',
    calculators: [
      { id: 'energy_system', render: () => <EnergySystemCard /> },
    ],
  },
  {
    id: 'test_yourself',
    title: 'Test yourself',
    intro: 'Compare yourself using real data from live competition.',
    source: 'CrossFit Games athletes, recent seasons.',
    controls: () => <TestYourselfControls />,
    calculators: [
      { id: 'your_lifts', render: () => <LiftsCard /> },
      {
        id: 'tests_rowing',
        render: () => <TimedTestsCard group="rowing" title="Rowing" blurb="Your best times on a rower, as minutes and seconds (for example 3:25). The 1,000 m is measured; the 2,000 m and 5,000 m are estimated from it." />,
      },
      {
        id: 'tests_gymnastics',
        render: () => <TimedTestsCard group="gymnastics" title="Gymnastics" blurb="Enter times as minutes and seconds (for example 1:05)." />,
      },
    ],
  },
];
