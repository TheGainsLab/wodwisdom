// deno test supabase/functions/_shared/profile-update_test.ts --no-check --allow-env
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyProposalToProfile, buildProposeProfileUpdateTool, PROFILE_UPDATE_PROMPT, validateProfileProposal } from "./profile-update.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

/** One athlete_profiles row (or none), with the calls recorded. */
function fakeSupa(row: Any | null) {
  const db = { row: row ? { ...row } : null, writes: [] as Any[] };
  const supa = {
    from(_t: string) {
      let op = "select"; let payload: Any = null;
      const run = () => {
        if (op === "select") return { data: db.row ? { goal: db.row.goal } : null, error: null };
        if (op === "update") { db.writes.push({ op, payload }); if (!db.row) return { data: [], error: null }; Object.assign(db.row, payload); return { data: [{ user_id: "u" }], error: null }; }
        db.writes.push({ op, payload }); db.row = { ...(db.row ?? {}), ...payload }; return { data: [{ user_id: "u" }], error: null };
      };
      const chain: Any = {
        select() { return chain; }, eq() { return chain; },
        update(p: Any) { op = "update"; payload = p; return chain; },
        upsert(p: Any) { op = "upsert"; payload = p; return chain; },
        maybeSingle() { return Promise.resolve(run()); },
        then(res: Any, rej: Any) { return Promise.resolve(run()).then(res, rej); },
      };
      return chain;
    },
  } as Any;
  return { db, supa };
}
const SNAPSHOT = { days_per_week: 4, goal: "Get strong", injuries_constraints: null };

Deno.test("days per week: only 2 to 6 can be proposed", () => {
  assertEquals(validateProfileProposal({ days_per_week: 4 }), []);
  assert(validateProfileProposal({ days_per_week: 1 }).length === 1);
  assert(validateProfileProposal({ days_per_week: 7 }).length === 1);
  const tool = buildProposeProfileUpdateTool(SNAPSHOT);
  assertEquals([tool.input_schema.properties.days_per_week.minimum, tool.input_schema.properties.days_per_week.maximum], [2, 6]);
});

Deno.test("the coach is shown the athlete's FULL injury note, not the first 200 characters", () => {
  const note = "Left knee: no running. ".repeat(12) + "ALSO right shoulder: no overhead pressing.";
  assert(note.length > 200);
  assert(buildProposeProfileUpdateTool({ ...SNAPSHOT, injuries_constraints: note }).description.includes("ALSO right shoulder: no overhead pressing."));
});

Deno.test("a goal addition goes onto the goal AS IT IS NOW, and to the Engine's copy too", async () => {
  // The athlete edited their goal after the card was drawn from SNAPSHOT.
  const { db, supa } = fakeSupa({ goal: "Get strong and fix my snatch", engine_goal: "Get strong" });
  const r = await applyProposalToProfile(supa, "u", SNAPSHOT, { goal_append: "Nov 2026: hold 5 sets of strict HSPU" });
  assertEquals(r.error, null); assertEquals(r.changed, { goal: true });
  assertEquals(db.row.goal, "Get strong and fix my snatch\n\nNov 2026: hold 5 sets of strict HSPU");
  assertEquals(db.row.engine_goal, db.row.goal);
});

Deno.test("days and injuries are written and reported as changed", async () => {
  const { db, supa } = fakeSupa({ goal: null });
  const r = await applyProposalToProfile(supa, "u", SNAPSHOT, { days_per_week: 3, injuries_replace: " Runner's knee, no running " });
  assertEquals(r.changed, { days: true, injuries: true });
  assertEquals([db.row.days_per_week, db.row.injuries_constraints], [3, "Runner's knee, no running"]);
});

Deno.test("no profile row: one is created, so 'Applied' is never shown for nothing", async () => {
  const { db, supa } = fakeSupa(null);
  const r = await applyProposalToProfile(supa, "u", SNAPSHOT, { days_per_week: 5 });
  assertEquals(r.error, null);
  assertEquals(db.writes.map((w: Any) => w.op), ["update", "upsert"]);
  assertEquals([db.row.user_id, db.row.days_per_week], ["u", 5]);
});

Deno.test("nothing to apply is an error, not a silent success", async () => {
  const { supa } = fakeSupa({ goal: "x" });
  assertEquals((await applyProposalToProfile(supa, "u", SNAPSHOT, {})).error, "Nothing to apply.");
});

Deno.test("the coach's instructions no longer say 'next generated month' or send a rebuild to a human", () => {
  assert(!PROFILE_UPDATE_PROMPT.includes("NEXT generated month"));
  assert(!PROFILE_UPDATE_PROMPT.includes("goes through a human"));
  assert(PROFILE_UPDATE_PROMPT.includes("RE-PLANS the weeks of the current month that are not written yet"));
});
