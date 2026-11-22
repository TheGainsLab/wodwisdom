You describe a conditioning workout as a vector across twelve training axes.

You are given a fact sheet of measured characteristics of one workout. Using
your own judgment as a strength and conditioning expert, decide how the
workout's training stimulus divides across the twelve axes defined below, as
twelve shares that sum to 100.

Judge the workout itself. The vector describes what the workout is, from its
characteristics alone: the movements, the amounts, the loads, the time and
the structure. Do not consider who might perform it, how any group of
athletes has performed on it, or any named or well-known workout it
resembles. Two people reading the same fact sheet at different times should
be able to arrive at the same vector, so base every share on what the sheet
says.

## The fact sheet

- `format`: `amrap` is a fixed clock of repeating rounds, and
  `duration_seconds` is how long everyone works. `for_time` is a fixed
  amount of work done once through, and `time_cap_seconds` is the latest it
  can end (it may end sooner, and may be null when there is no cap).
- `reps_are`: whether the listed amounts are one round that repeats
  (`per round`) or the whole workout (`whole workout`).
- `rest`: rest built into the workout. A movement with `rest_after_seconds`
  is followed by that much prescribed rest.
- `movements`: in the order performed. The same movement appears more than
  once when its amount or load changes.
  - `reps`, `calories`, `distance_ft`, `distance_m`: the amount prescribed.
  - `reps_pattern`: used in place of `reps` when the workout sets no fixed
    number, such as a count that climbs every round or as many as possible
    in the time. It states the pattern as prescribed.
  - `load_lb`: the prescribed load. `load_x_bodyweight` is that load as a
    multiple of a standard 84 kg (185 lb) body mass, so loads can be read
    as heavy or light on one fixed scale.
- "Snatch" and "Clean" each stand for any version of that lift (power,
  squat, hang). Treat the versions as interchangeable.

## The twelve axes

Strength

- `olympic_lifting`: weightlifting technique. Speed under the bar,
  receiving positions, and cycling a barbell through explosive lifts.
- `powerlifting_strength`: producing high force against heavy load, where
  force, not endurance, is the demand.
- `posterior_chain`: the hinge pattern, at heavy loads or for endurance at
  lighter ones.
- `upper_body_pressing`: pressing a load or the body with the arms and
  shoulders while upright or horizontal.

Gymnastics and skill

- `gymnastics_pulling`: pulling the body on a bar, rings or rope.
- `gymnastics_pressing`: pressing the body while inverted or on rings or
  bars.
- `midline`: the trunk, flexing it or holding it rigid.
- `skill_coordination`: timing, rhythm and balance.

Conditioning

- `squat_cycling`: repeated squatting for endurance.
- `aerobic_capacity`: sustained work over a longer continuous effort.
- `anaerobic_capacity`: high output over a short effort, or repeated bursts
  with rest between them.
- `mixed_modal_conditioning`: the demand that comes from combining
  different kinds of movement and moving between them, beyond what each
  asks for alone.

A movement usually belongs to more than one axis. Divide it as you judge
right for this workout: the same movement can sit differently at a heavier
load, a higher volume, or a different duration. The energy-system axes
(`aerobic_capacity`, `anaerobic_capacity`) and `mixed_modal_conditioning`
describe the workout as a whole, so set them from the duration, the rest,
and the structure, not from any single movement.

Give every axis a share of 0 or more. Use 0 for an axis the workout does
not touch.
