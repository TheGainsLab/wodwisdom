# Engine day types — structured guidance (APPROVED 2026-11-10)

Purpose: give the sequencer structured facts per day type so readiness, the
novelty budget and the hard/easy mix read data, not prose. The existing
`coaching_intent` text stays as authored (the sequencer quotes its spirit to
athletes). This draft proposes THREE new columns on `engine_day_types` (tier dropped,
see below):

- `class` — `develop` (training stimulus the sequencer may prescribe to move a
  weakness, repeat, and dose) or `assess` (a readout: never prescribed to fix
  a gap, never softened; passing one may count as readiness evidence)
- `trains` — energy systems / qualities the day loads (AB aerobic base,
  AP aerobic power, LT lactate threshold, GL glycolytic, PH phosphagen;
  DEN density, DUR durability, PAC pacing, PSY psychological, INT integration)
- `prerequisites` — day-type ids that must be demonstrated first (graph edges)

`recovery_cost` was considered and DROPPED (decided 2026-11-10): the
sequencer infers cost from the envelope and intent text, as it does today.

Readiness definition (DECIDED 2026-11-10): a prerequisite is demonstrated
when the athlete has completed ≥2 scored sessions of that type, rolled up
across modalities, at ANY ratio. Quality is not gated for now; the ratio
threshold (e.g. ≥ 0.90) is a later tightening if the data warrants. Tier-1
types have no prerequisites, so month one is unaffected.

Review notes on the existing `coaching_intent` text:
- `rocket_races_b` carried a verbatim copy of A's intent. APPROVED rewrite
  (goes in the migration): "Structure: the same intervals as Rocket Races A,
  re-raced at tighter rest | Primary Stimulus: Pacing control with less
  recovery | Primary Adaptations: None (consistency check) | System Role:
  Readout of pacing repeatability."
- Everything else reads correctly against its envelope. No other edits proposed.
- `is_support_day` was set only on `ascending`, undocumented — dropped (decided).

| Type | Class | Trains | Prerequisites | Sequencer guidance (one line) |
|---|---|---|---|---|
| time_trial | assess | AB/AP readout | — | Scheduled monthly; insert extra only on a strong signal (layoff, modality change, paces contradicting baseline). |
| endurance | develop | AB | — | The root. First answer to a weak aerobic base; safe at high volume; pairs well after a hard day. |
| max_aerobic_power | develop | AP | — | Raises the aerobic ceiling; 2–3 exposures per month in base phases. |
| threshold | develop | LT | — | Bridge from base to intensity; the fix for a lagging LT before any bridge type. |
| anaerobic | develop | GL | — | Use sparingly; long rests; never on consecutive days or the day after a max effort. |
| interval | develop | AP, LT, GL | — | Generalist; the default when no system is clearly behind. |
| polarized | develop | AB, PH | — | Base maintenance with neural sharpness during high-volume phases. |
| flux | develop | LT, AB→DEN | endurance, threshold | Clearance work; more surges = more LT dose without a harder day. |
| flux_stages | develop | LT→DUR, PSY | flux, threshold | Threshold durability under rising stress; progression of flux. |
| ascending | develop | AP→GL, PAC | anaerobic | Anti-overpacing tool; prescribe when early-round fade is the pattern. |
| rocket_races_a | develop | PAC | max_aerobic_power | PAIRING RULE (founder, 2026-11-10): any week containing Rocket Races A must also contain Rocket Races B, same intervals, only the rest adjusted. A without B in the week is invalid. |
| rocket_races_b | assess | PAC | rocket_races_a | The B of the pair: inherits A's rounds, work and pace; only rest changes (tighter). Never scheduled without A in the same week. |
| hybrid_aerobic | develop | AP→DUR, DEN | max_aerobic_power, flux | Core mixed-modal builder; aerobic power under density. |
| hybrid_anaerobic | develop | GL→DUR | anaerobic | Glycolytic repeatability; sharp and costly; space from anaerobic days. |
| devour | develop | AB, LT→DUR | anaerobic, max_aerobic_power | Quiet durability builder; good weekly anchor once ready. |
| ascending_devour | develop | AB+LT→DUR | devour, ascending | Pace and duration both climb; advanced durability. |
| descending_devour | develop | AB→DEN | devour | Shrinking rest; density tolerance. |
| towers | develop | AB→AP→DUR | devour, max_aerobic_power | Durability into power under fatigue; late builder. |
| atomic | develop | PH→AP | max_aerobic_power, polarized | High-ROI aerobic builder with low recovery cost; useful in heavy outside-load weeks. |
| infinity | assess | INT, PAC, PSY | hybrid_aerobic, devour, flux_stages | Expression rehearsal; a readout, not a fix; rare. |
| afterburner | assess | GL+AP→INT, PSY | anaerobic, towers | "Who has energy left"; expression readout; rare. |
| synthesis | assess | INT (all) | all develop types | Final audit; verification only; never prescribed to develop anything. |

Pairing rule (decided 2026-11-10): in any week where Rocket Races A appears,
Rocket Races B must appear in the same week with the same intervals and only
the rest time adjusted. This becomes a validator rule in `validateProposal`
(reject a block that schedules A without B in the week, or B whose rounds /
work / pace differ from its A) and a line in the sequencer prompt.

Apportioning develop vs assess (DECIDED 2026-11-10):
- The time trial is ALWAYS the first day of every month. Fixed, pinned,
  never moved or replaced by the sequencer. Additional time trials may be
  inserted on a strong signal, but the month-opening one does not change.
- Rocket Races B exists only as A's pair in the same week (rule above).
- Other assess types (infinity, afterburner, synthesis): at most one per
  month, and only once every prerequisite is demonstrated. A race-prep goal
  may raise this to two in the final month before the event.
- Everything else in the month is develop days chosen by the sequencer.

Tier (DECIDED 2026-11-10): not stored. Tier is implied by prerequisite
depth; the tier names in the competency graph (Foundation, Bridges,
Integration, Expression) are not athlete-facing vocabulary and are not
introduced. Columns to add: `class`, `trains`, `prerequisites`
— three columns, final.

Table APPROVED 2026-11-10 with four prerequisite changes (ascending →
anaerobic; polarized → none; hybrid_anaerobic → anaerobic; devour →
anaerobic, max_aerobic_power). This document is now the spec for the migration.

Decided: readiness = completed twice at any ratio; `rocket_races_b` intent
rewrite (above); the A/B pairing rule; time trial pinned to day one of
every month; tier not stored; `is_support_day` DROPPED in the migration
(a relic: set true on `ascending` by hand, undefined, nothing depends on it).
