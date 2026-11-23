"""Step 3 runner: make the AI's judgment repeatable.

For each workout it sends the SAME fixed prompt (the 12 axis definitions)
and that workout's fact sheet to the SAME exact model several times, each
as an independent request, averages the drafts, and records everything that
produced the result. A stored result is never re-drafted: the same workout,
under the same prompt, model and facts, always returns the same vector.

Usage:
    python runner.py --definitions axis-definitions.md \
                     --facts fact-sheets.json --out vectors.json
    python runner.py ... --stub        # no API calls; exercises the mechanics

Inputs
    --definitions  text file: the axis definitions and instructions (step 1)
    --facts        JSON object: {workout_id: fact sheet (string or object)}
Output
    --out          JSON store, one record per workout (also written as .csv)

Credentials: the Anthropic SDK's normal resolution (ANTHROPIC_API_KEY, or an
`ant auth login` profile). None are needed with --stub.
"""
import argparse
import concurrent.futures
import csv
import datetime
import hashlib
import itertools
import json
import random
import sys

RUNNER_VERSION = "runner-1"
MODEL = "claude-opus-5-5"   # exact ID; changing it changes every cache key
EFFORT = "high"             # set explicitly; this model's default is medium
N_DRAFTS = 5
MAX_ATTEMPTS_PER_DRAFT = 3
SUM_TOLERANCE = 0.5         # a draft must sum to 100 within this
CONCURRENCY = 4

AXES = [
    "olympic_lifting", "powerlifting_strength", "posterior_chain",
    "upper_body_pressing", "gymnastics_pulling", "gymnastics_pressing",
    "midline", "skill_coordination", "squat_cycling", "aerobic_capacity",
    "anaerobic_capacity", "mixed_modal_conditioning",
]
SCHEMA = {
    "type": "object",
    "properties": {a: {"type": "number"} for a in AXES},
    "required": AXES,
    "additionalProperties": False,
}
OUTPUT_RULE = (
    "\n\nReturn one JSON object with exactly these twelve keys, each a "
    "number from 0 to 100, summing to 100: " + ", ".join(AXES) + "."
)


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def canonical(obj):
    return obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True, ensure_ascii=False)


def check_draft(d):
    """Return a cleaned draft, or raise ValueError saying why it is unusable."""
    if not isinstance(d, dict) or set(d) != set(AXES):
        raise ValueError("wrong set of axes")
    v = {}
    for a in AXES:
        x = d[a]
        if isinstance(x, bool) or not isinstance(x, (int, float)) or x < 0:
            raise ValueError(f"{a} is not a non-negative number")
        v[a] = float(x)
    total = sum(v.values())
    if abs(total - 100) > SUM_TOLERANCE:
        raise ValueError(f"sums to {total:g}, not 100")
    return {a: x * 100 / total for a, x in v.items()}   # remove the rounding remainder only


def distance(a, b):
    return sum(abs(a[x] - b[x]) for x in AXES) / 2


def summarise(drafts):
    n = len(drafts)
    mean = {a: sum(d[a] for d in drafts) / n for a in AXES}
    sd = {a: (sum((d[a] - mean[a]) ** 2 for d in drafts) / n) ** 0.5 for a in AXES}
    pairs = [distance(x, y) for x, y in itertools.combinations(drafts, 2)]
    return {
        "vector": {a: round(mean[a], 2) for a in AXES},
        "axis_sd": {a: round(sd[a], 2) for a in AXES},
        # how far apart two independent drafts of this workout sit: the noise
        "draft_spread": round(sum(pairs) / len(pairs), 2) if pairs else 0.0,
        "draft_spread_max": round(max(pairs), 2) if pairs else 0.0,
    }


# ---------------------------------------------------------------- judges

class ModelJudge:
    """One independent request per draft. Nothing is shared between drafts."""

    def __init__(self):
        import anthropic
        self.anthropic = anthropic
        self.client = anthropic.Anthropic()

    def draft(self, system, facts):
        r = self.client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
            # the definitions are identical on every call, so cache them
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": facts}],
            # on by default for this model: a declined request is re-run on a
            # fallback model inside the same call. A draft served by any model
            # other than MODEL is discarded below, because a repeatable result
            # needs one fixed model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if r.stop_reason == "refusal":
            raise ValueError("the model declined the request")
        if r.model != MODEL:
            raise ValueError(f"served by {r.model}, not {MODEL}")
        if r.stop_reason != "end_turn":
            raise ValueError(f"stopped early: {r.stop_reason}")
        text = next(b.text for b in r.content if b.type == "text")
        return json.loads(text)


class StubJudge:
    """No API. A noisy but valid judge, for testing the runner itself."""

    def draft(self, system, facts):
        rng = random.Random()                        # fresh noise every call
        base = random.Random(sha(facts))             # same workout, same centre
        centre = [base.random() ** 3 for _ in AXES]
        raw = [max(0.0, c + rng.gauss(0, 0.03)) for c in centre]
        t = sum(raw)
        return {a: 100 * x / t for a, x in zip(AXES, raw)}


# ---------------------------------------------------------------- run

def judge_workout(judge, system, facts_text):
    """Collect N_DRAFTS valid, independent drafts for one workout."""
    drafts, failures = [], []

    def one(_):
        last = None
        for _attempt in range(MAX_ATTEMPTS_PER_DRAFT):
            try:
                return check_draft(judge.draft(system, facts_text)), None
            except (ValueError, json.JSONDecodeError, StopIteration) as e:
                last = str(e)
        return None, last

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for d, err in pool.map(one, range(N_DRAFTS)):
            if d is not None:
                drafts.append(d)
            else:
                failures.append(err)
    if len(drafts) < N_DRAFTS:
        raise RuntimeError(f"only {len(drafts)} of {N_DRAFTS} drafts usable: {failures}")
    return drafts


def run(definitions_path, facts_path, out_path, stub=False):
    system = open(definitions_path, encoding="utf-8").read().rstrip() + OUTPUT_RULE
    facts = json.load(open(facts_path, encoding="utf-8"))
    prompt_hash = sha(system + json.dumps(SCHEMA, sort_keys=True))
    model = "stub" if stub else MODEL
    try:
        store = json.load(open(out_path, encoding="utf-8"))
    except FileNotFoundError:
        store = {}
    judge = StubJudge() if stub else ModelJudge()
    done = reused = failed = 0
    for wid, sheet in facts.items():
        text = canonical(sheet)
        key = "|".join([prompt_hash, model, EFFORT, str(N_DRAFTS), RUNNER_VERSION, sha(text)])
        rec = store.get(wid)
        if rec and rec.get("key") == key:
            reused += 1          # already judged under exactly these conditions
            continue
        try:
            drafts = judge_workout(judge, system, text)
        except Exception as e:   # one workout failing must not lose the others
            failed += 1
            print(f"FAILED {wid}: {e}", file=sys.stderr)
            continue
        store[wid] = {
            "key": key,
            **summarise(drafts),
            "drafts": [{a: round(d[a], 2) for a in AXES} for d in drafts],
            "provenance": {
                "runner_version": RUNNER_VERSION,
                "model": model,
                "effort": EFFORT,
                "n_drafts": N_DRAFTS,
                "prompt_hash": prompt_hash,
                "facts_hash": sha(text),
                "definitions_file": definitions_path,
                "judged_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            },
        }
        done += 1
        json.dump(store, open(out_path, "w", encoding="utf-8"), indent=1)   # save as we go
    with open(out_path.rsplit(".", 1)[0] + ".csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["workout"] + AXES + ["draft_spread", "model", "prompt_hash", "facts_hash"])
        for wid, rec in store.items():
            p = rec["provenance"]
            w.writerow([wid] + [rec["vector"][a] for a in AXES]
                       + [rec["draft_spread"], p["model"], p["prompt_hash"], p["facts_hash"]])
    spreads = [r["draft_spread"] for r in store.values()]
    print(f"judged {done}, reused {reused}, failed {failed}; "
          f"mean draft spread {sum(spreads) / len(spreads):.1f}" if spreads else "nothing stored")
    return store


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--definitions", required=True)
    ap.add_argument("--facts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stub", action="store_true", help="no API calls; test the mechanics")
    a = ap.parse_args()
    run(a.definitions, a.facts, a.out, stub=a.stub)
