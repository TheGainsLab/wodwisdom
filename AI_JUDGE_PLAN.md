# AI Judge — Movement Assessment Plan (Phase 1)

## What This Is

A **digital judge and rep counter** for movements. Point a camera at an
athlete, and the system answers three questions per rep:

1. **Did it count?** (rep segmentation)
2. **Was it a good rep?** (movement standards met or not)
3. **How many were good?** ("47/50 — 3 no-reps, too shallow")

It is a judge, not a coach. It asserts measurable facts about a rep
("hips got below knees", "knees straightened before the elbows pulled").
It does **not** suggest technique changes, correct form, or interpret the
lift. That distinction is the whole design: a judge evaluates a small set
of standards; a coach critiques the entire trajectory.

This is also a top-of-funnel product — a fun "show me 50 good reps in a
minute" challenge that hooks users and feeds an athlete history that
bridges into our larger tracking/coaching products.

## Core Insight

**A movement standard is one of two things:**

| Type | Question | Example | Phase |
|---|---|---|---|
| `joint_angle` (instant) | At the rep's extreme, is a joint angle past a threshold? | Squat depth: hip below knee | 1 |
| `joint_event` (ordering) | Did joint event A happen before/with joint event B? | Power clean: knees straight before elbows drop | 1 |
| `object_event` | Did an implement/target event happen? | Wall-ball hit the line; bar locked overhead | 2 (needs object model) |

The instant check is just the degenerate case of event detection (one
event, one threshold). So the engine needs only two primitives:

```
detect_event(signal, condition) -> timestamp        # when did X happen
assert(predicate over event timestamps / values)    # was the standard met
```

Every standard we will ever write — depth, lockout, full extension, clean
sequencing, deadlift hip/shoulder timing — is one of those. The engine is
a **event detector + predicate evaluator over joint-angle time series**,
and it is movement-agnostic. Adding a movement means adding a *spec*, not
writing a new worker.

This is also why "complex" lifts are in scope for Phase 1: judging "hips
below knees" on a snatch is the *same measurement* as on an air squat —
the bar is overhead and doesn't occlude the legs. We are judging one
position, not interpreting the lift.

## Vision System

**MediaPipe Pose Landmarker (BlazePose, 33 landmarks)** for both ends.

The deciding factor is **topology parity**, not raw accuracy:

- **Client (MediaPipe Tasks JS):** live on-screen count + provisional
  good/no-rep — the fun, instant-gratification loop.
- **Server (MediaPipe Python):** the *authoritative* score that gets
  stored, is leaderboard-eligible, and can be **re-scored** against new
  rule versions. Server wins on disagreement; that disagreement becomes a
  test case.

Both ends run the **same rule spec** over the **same 33-landmark schema**,
so a standard is written once and behaves identically client and server.
Mixing model families (e.g. server COCO-17 vs client BlazePose-33) would
force every standard to be ported and re-tuned twice — not worth it.

- Use MediaPipe **3D world landmarks** (metric-ish x/y/z), not raw pixel
  coordinates, so joint angles survive camera tilt.
- Server uses `pose_landmarker_heavy`; client uses `lite`/`full`.

**Back-pocket upgrade:** if coach-vs-app disagreement data later shows we
need more server accuracy, swap the *server* to RTMPose/ViTPose — but only
after mapping its 17 keypoints onto our 33-point spec. Not a starting
point.

### Where this stack reaches its limit

The boundary is **not** "simple vs complex movements." It is **"is the
standard a body angle or an object event."**

- 🟢 **Body-angle standards** (depth, lockout, extension, sequencing) →
  judgeable everywhere, snatch and clean included.
- 🟡 **Object/target standards** (wall-ball line, bar lockout overhead,
  rope passes) → pose can't see the object; needs a second signal (object
  detection). Phase 2.
- 🔴 **Continuous technique critique** (the snatch turnover, bar path
  coaching) → out of scope by design; that's the coach, not the judge.

## Capture Requirements (load-bearing)

No model fixes a bad camera angle — the capture instructions do.

- **Stand sideways to the camera** (sagittal plane). This is what makes
  hip-below-knee reliable; any single-camera 2D-ish system has
  foreshortening error otherwise.
- **Full body + feet visible**, good lighting, single person in frame.
- **Record at 60fps where possible.** Timing standards like "knees
  straight before elbows drop" can be a ~50ms gap — ~1.5 frames at 30fps
  (borderline), comfortable at 60fps. Frame rate determines whether a
  given temporal standard is judgeable at all.

## Movement Spec Format

A movement is declarative config, not code. Example specs:

```yaml
movement: air_squat
signal_defs:
  hip_angle:  angle(shoulder, hip, knee)
  knee_angle: angle(hip, knee, ankle)
rep_cycle:
  signal: hip_angle
  pattern: [top, bottom, top]      # valley-peak detection
  min_amplitude: 40deg             # gate to reject bobbing / false reps
standards:
  - id: depth
    type: joint_angle
    assert: hip_angle <= 90deg  at rep_bottom
  - id: lockout
    type: joint_angle
    assert: knee_angle >= 170deg at rep_top
```

```yaml
movement: power_clean
signal_defs:
  hip_angle:   angle(shoulder, hip, knee)
  knee_angle:  angle(hip, knee, ankle)
  elbow_angle: angle(shoulder, elbow, wrist)
events:
  knee_extended: first frame where knee_angle >= 170deg
  elbows_drop:   first frame where d/dt(elbow_angle) < 0 sustained N frames
standards:
  - id: no_early_arm_pull
    type: joint_event
    assert: knee_extended.t < elbows_drop.t     # else: no-rep (early pull)
```

### Engine accuracy notes (where accuracy leaks)

1. **Hysteresis, not bare thresholds.** Raw landmarks jitter and will
   cross any single threshold repeatedly, firing phantom events. Detect
   events on a *smoothed* signal, and require sustained *angular velocity*
   for "drops"/"straightens" (flexing for N frames), not a one-frame dip.
2. **Normalize angles in world coords**, never raw pixel-y, so camera tilt
   doesn't move the threshold.
3. **Rep segmentation uses a min-amplitude gate** so small bobs between
   reps don't get counted.
4. **Store per-rep results, not just aggregates** — otherwise "9/10" can't
   be computed, displayed, or debugged against a coach's call.

## Architecture

```
Mobile / Web (Vite + React, React Router 7)   <-- NOTE: not Next.js
        |  live count via MediaPipe Tasks JS (fun loop)
        v
Supabase Storage  (video upload)
        v
Assessment Job row created  (reuse existing async-job pattern:
                             cf. program-job-status, profile-analysis-status)
        v
Python Worker  (NEW infra — the one genuinely new piece)
   MediaPipe Pose (heavy) -> keypoint time series
        v
Rules Engine  (event detector + predicate evaluator; spec-driven)
        v
Results stored (assessment + per-rep rows)
        v
App displays results / history / leaderboard
```

**Reused, already in production:**
- Supabase: auth, DB, storage, job tracking. No new database.
- ~70 Supabase **Edge Functions** (Deno/TS) including a proven async-job
  status pattern to model the assessment job on.
- Vercel deploy of the Vite + React app for assessment/results screens.

**Genuinely new:**
- A **Python worker host** (e.g. Cloud Run / Fly / Modal) running
  MediaPipe + the rules engine. There is no long-running Python service
  today — the existing `scripts/*.py` are one-off ingestion scripts.

> Doc correction vs. earlier draft: the app is **Vite + React (React
> Router 7)**, not Next.js. There are no server-side API routes; the
> assessment and results screens are client routes.

## Data Model (sketch)

```
movement_assessments
  id              uuid pk
  user_id         uuid fk
  movement_id     text            -- 'air_squat', 'power_clean', ...
  spec_version    text            -- which rule version judged this
  video_path      text            -- supabase storage
  status          text            -- queued | processing | done | failed
  total_reps      int             -- attempts detected
  valid_reps      int             -- standards met
  depth_pct       numeric         -- aggregate display metrics
  lockout_pct     numeric
  consistency_pct numeric
  created_at      timestamptz

assessment_reps
  id              uuid pk
  assessment_id   uuid fk
  rep_index       int
  valid           bool
  failed_standard text            -- 'depth' | 'lockout' | null
  metrics         jsonb           -- { hip_angle_min, knee_angle_max, ... }
  start_t         numeric         -- timestamps into the video
  bottom_t        numeric
  end_t           numeric
```

Storing `spec_version` per assessment + raw per-rep metrics is what lets
us **re-score old videos** against improved rules and measure ourselves
against coach labels over time.

## Phase 1 Success Criteria

Measured against a human coach:

- Rep Count Accuracy **≥ 95%**
- Depth Accuracy **≥ 90%**
- Lockout Accuracy **≥ 95%**

No new movements until these are hit on the first movement(s).

## Phasing

- **Phase 1** — Spec-driven judge whose first specs are bodyweight,
  body-angle movements (air squat, push-up, press, etc.). Server is the
  authoritative scorer; client gives the live count. Hit the accuracy bar.
- **Phase 2** — Add the object-detection model for 🟡 standards (wall-ball
  line, overhead lockout). Same judge, second signal.
- **Out of scope** — Continuous technique coaching (the snatch turnover,
  bar-path correction). Separate, more technical endeavor.

## Open Decisions

1. Python worker host (Cloud Run vs Fly vs Modal) and whether GPU is
   needed for `pose_landmarker_heavy` at acceptable latency/cost.
2. Do we keep raw keypoint time series in storage (enables richer
   re-scoring) or only derived per-rep metrics (cheaper)?
3. Leaderboard scope for the "50 reps in a minute" challenge — global vs
   gym vs friends — and how no-reps are surfaced on it.
