-- Add coaching_intent column to engine_day_types for AI coach context injection.
-- Each row gets a structured description: Structure, Primary Stimulus,
-- Primary/Secondary Adaptations, and System Role.

ALTER TABLE engine_day_types ADD COLUMN IF NOT EXISTS coaching_intent text;

UPDATE engine_day_types SET coaching_intent =
  'Structure: Single continuous maximal effort (typically 10 minutes)' || chr(10) ||
  'Primary Stimulus: Measurement of current aerobic performance' || chr(10) ||
  'Primary Adaptations: None (diagnostic only)' || chr(10) ||
  'System Role: Establishes and periodically recalibrates your reference performance. All other targets are derived from your time trial result.'
WHERE id = 'time_trial';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Short maximal efforts (~30 seconds), long rest (~2-3 minutes), low total volume' || chr(10) ||
  'Primary Stimulus: Fast glycolytic ATP production' || chr(10) ||
  'Primary Adaptations: Glycolytic power, increased anaerobic enzyme activity' || chr(10) ||
  'Secondary Adaptations: High-threshold motor unit recruitment, lactate tolerance, neuromuscular coordination' || chr(10) ||
  'System Role: Raises anaerobic ceiling; used sparingly'
WHERE id = 'anaerobic';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Continuous Zone 2 work (20-90+ minutes), fixed low intensity (~70%)' || chr(10) ||
  'Primary Stimulus: Sustained oxidative metabolism' || chr(10) ||
  'Primary Adaptations: Mitochondrial biogenesis, capillary density, increased oxidative enzyme activity' || chr(10) ||
  'Secondary Adaptations: Fat oxidation efficiency, stroke volume support, autonomic balance' || chr(10) ||
  'System Role: Aerobic foundation that supports all other training'
WHERE id = 'endurance';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Long severe intervals (e.g., 4x4 minutes), equal work-to-rest ratio, pace derived from time trial' || chr(10) ||
  'Primary Stimulus: Sustained near-maximal oxygen uptake' || chr(10) ||
  'Primary Adaptations: Increased VO2max, increased maximal stroke volume, improved oxygen extraction' || chr(10) ||
  'Secondary Adaptations: Severe-domain pacing skill, aerobic power repeatability' || chr(10) ||
  'System Role: Raises the aerobic ceiling that all other work draws from'
WHERE id = 'max_aerobic_power';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Sustained efforts at lactate threshold intensity' || chr(10) ||
  'Primary Stimulus: Threshold power maintenance' || chr(10) ||
  'Primary Adaptations: Increased lactate threshold, improved clearance efficiency' || chr(10) ||
  'System Role: Builds the bridge between aerobic base and high-intensity work'
WHERE id = 'threshold';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Continuous Zone 2 with very short max-effort bursts (~7 seconds) every several minutes' || chr(10) ||
  'Primary Stimulus: Oxidative work with brief phosphagen perturbations' || chr(10) ||
  'Primary Adaptations: Aerobic base maintenance, faster oxygen uptake kinetics' || chr(10) ||
  'Secondary Adaptations: PCr resynthesis efficiency, neural sharpness, fast-fiber aerobic contribution' || chr(10) ||
  'System Role: Preserves responsiveness during high-volume aerobic phases'
WHERE id = 'polarized';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Variable pacing structures that test output consistency as demands change' || chr(10) ||
  'Primary Stimulus: Pacing control under variable demands' || chr(10) ||
  'Primary Adaptations: Output consistency, adaptive pacing skill' || chr(10) ||
  'System Role: Pacing intelligence under unpredictable load'
WHERE id = 'rocket_races_a';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Variable pacing structures that test output consistency as demands change' || chr(10) ||
  'Primary Stimulus: Pacing control under variable demands' || chr(10) ||
  'Primary Adaptations: Output consistency, adaptive pacing skill' || chr(10) ||
  'System Role: Pacing intelligence under unpredictable load'
WHERE id = 'rocket_races_b';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Zone 2 base with short, controlled pace increases (~60 seconds), continuous execution' || chr(10) ||
  'Primary Stimulus: Mild, repeatable glycolytic engagement' || chr(10) ||
  'Primary Adaptations: Lactate clearance efficiency, metabolic flexibility' || chr(10) ||
  'Secondary Adaptations: Improved steady-state resilience, faster return to oxidative dominance' || chr(10) ||
  'System Role: Bridges base to threshold without breakdown'
WHERE id = 'flux';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Paired or clustered aerobic-power intervals, short rests, incomplete recovery' || chr(10) ||
  'Primary Stimulus: Sustained severe-domain work under density' || chr(10) ||
  'Primary Adaptations: Aerobic power durability, incomplete-recovery tolerance' || chr(10) ||
  'Secondary Adaptations: Lactate clearance under density, psychological tolerance of continuous strain' || chr(10) ||
  'System Role: Core CrossFit / HYROX conditioning builder'
WHERE id = 'hybrid_aerobic';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Anaerobic repeats (~60 seconds and/or ~15 seconds), incomplete recovery, often paired formats' || chr(10) ||
  'Primary Stimulus: Glycolytic power under fatigue' || chr(10) ||
  'Primary Adaptations: Anaerobic repeatability, glycolytic tolerance' || chr(10) ||
  'Secondary Adaptations: Fast-fiber fatigue resistance, neuromuscular resilience' || chr(10) ||
  'System Role: Sharp, high-cost anaerobic development'
WHERE id = 'hybrid_anaerobic';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Continuous aerobic work with repeated flux surges that progressively increase in intensity' || chr(10) ||
  'Primary Stimulus: Increasing glycolytic load without full recovery' || chr(10) ||
  'Primary Adaptations: Threshold durability, clearance under rising metabolic stress' || chr(10) ||
  'Secondary Adaptations: Resistance to HR drift, psychological tolerance of sustained discomfort' || chr(10) ||
  'System Role: Threshold-bridge and late-base progression tool'
WHERE id = 'flux_stages';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Repeated intervals with fixed duration, intensity increases each round' || chr(10) ||
  'Primary Stimulus: Escalating aerobic to glycolytic demand' || chr(10) ||
  'Primary Adaptations: Aerobic-glycolytic transition control, tolerance of rising metabolic stress' || chr(10) ||
  'Secondary Adaptations: Pacing intelligence, reduced early overpacing tendencies' || chr(10) ||
  'System Role: Transitional robustness builder'
WHERE id = 'ascending';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Fixed pace, increasing work duration each round, variants include ascending or descending rest' || chr(10) ||
  'Primary Stimulus: Accumulated aerobic fatigue' || chr(10) ||
  'Primary Adaptations: Aerobic durability, resistance to fatigue accumulation' || chr(10) ||
  'Secondary Adaptations: Threshold staying power, cardiac drift resistance' || chr(10) ||
  'System Role: Quiet, high-payoff durability builder'
WHERE id = 'devour';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Pace and duration both increase each round' || chr(10) ||
  'Primary Stimulus: Compound aerobic-threshold stress' || chr(10) ||
  'Primary Adaptations: Integrated aerobic-threshold robustness' || chr(10) ||
  'Secondary Adaptations: Late-workout composure, improved pacing judgment' || chr(10) ||
  'System Role: Advanced durability progression'
WHERE id = 'ascending_devour';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Fixed pace and duration, rest decreases each round' || chr(10) ||
  'Primary Stimulus: Clearance under shrinking recovery' || chr(10) ||
  'Primary Adaptations: Aerobic density tolerance, clearance efficiency' || chr(10) ||
  'Secondary Adaptations: Improved VO2 maintenance between efforts' || chr(10) ||
  'System Role: Density-focused durability work'
WHERE id = 'descending_devour';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Long escalating density, multiple phases, no clear reset' || chr(10) ||
  'Primary Stimulus: Prolonged aerobic-glycolytic erosion' || chr(10) ||
  'Primary Adaptations: None primary (expression-focused)' || chr(10) ||
  'Secondary Adaptations: Pacing discipline, psychological endurance, late-stage durability' || chr(10) ||
  'System Role: MetCon simulation and psychological rehearsal'
WHERE id = 'infinity';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Progressive aerobic ramp, long steady segment, short-rest aerobic power finish' || chr(10) ||
  'Primary Stimulus: Layered aerobic fatigue into power expression' || chr(10) ||
  'Primary Adaptations: Aerobic durability into aerobic power under fatigue' || chr(10) ||
  'Secondary Adaptations: Transition handling, late-session output resilience' || chr(10) ||
  'System Role: CrossFit-specific durability builder'
WHERE id = 'towers';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Anaerobic bursts, aerobic clearing, rising-density aerobic power finish' || chr(10) ||
  'Primary Stimulus: Late-stage power expression under fatigue' || chr(10) ||
  'Primary Adaptations: None primary (expression-focused)' || chr(10) ||
  'Secondary Adaptations: Clearance under residual glycolysis, psychological resilience' || chr(10) ||
  'System Role: "Who has energy left?" simulator'
WHERE id = 'afterburner';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Very short maximal efforts with long relative rest, followed by aerobic power work' || chr(10) ||
  'Primary Stimulus: Phosphagen priming into aerobic expression' || chr(10) ||
  'Primary Adaptations: Faster VO2 kinetics, improved aerobic power efficiency' || chr(10) ||
  'Secondary Adaptations: Neural readiness, cleaner early-interval output' || chr(10) ||
  'System Role: High-ROI aerobic builder with low recovery cost'
WHERE id = 'atomic';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Anaerobic to aerobic to anaerobic to aerobic; no system gets full recovery' || chr(10) ||
  'Primary Stimulus: Full-system integration' || chr(10) ||
  'Primary Adaptations: None (verification, not development)' || chr(10) ||
  'Secondary Adaptations: Coordination of all energy systems, competition confidence' || chr(10) ||
  'System Role: Final audit of conditioning completeness'
WHERE id = 'synthesis';

UPDATE engine_day_types SET coaching_intent =
  'Structure: Variable work-to-rest ratio, pace derived from time trial, duration from 30 seconds to several minutes' || chr(10) ||
  'Primary Stimulus: Sustained multi-energy-system energy demands' || chr(10) ||
  'Primary Adaptations: Increased VO2max, increased maximal stroke volume, improved glycolytic sustainability, improved oxygen extraction' || chr(10) ||
  'Secondary Adaptations: Severe-domain pacing skill, aerobic power repeatability' || chr(10) ||
  'System Role: Raises the ceiling of all energy systems'
WHERE id = 'interval';
