// deno test supabase/functions/_shared/profile-update_test.ts --no-check --allow-env
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyEquipmentChange, applyProposalToProfile, buildProposeProfileUpdateTool, PROFILE_UPDATE_PROMPT, validateProfileProposal } from "./profile-update.ts";
import { ALL_EQUIPMENT_KEYS } from "./tier-status.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

/** One athlete_profiles row (or none), with the calls recorded. */
function fakeSupa(row: Any | null) {
  const db = { row: row ? { ...row } : null, writes: [] as Any[] };
  const supa = {
    from(_t: string) {
      let op = "select"; let payload: Any = null;
      const run = () => {
        if (op === "select") return { data: db.row ? { goal: db.row.goal, equipment: db.row.equipment } : null, error: null };
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

// ── Session length on the card (2026-11-23) ────────────────────────────────

Deno.test("session length: only the slider's values (30 to 120 by 15) can be proposed", () => {
  for (const ok of [30, 45, 60, 75, 90, 105, 120]) assertEquals(validateProfileProposal({ session_length_minutes: ok }), []);
  for (const bad of [0, 15, 29, 40, 50, 121, 135, 45.5]) assert(validateProfileProposal({ session_length_minutes: bad }).length === 1, String(bad));
  const tool = buildProposeProfileUpdateTool(SNAPSHOT);
  assertEquals(tool.input_schema.properties.session_length_minutes.enum, [30, 45, 60, 75, 90, 105, 120]);
});

Deno.test("session length is written to the profile and reported as changed", async () => {
  const { db, supa } = fakeSupa({ goal: "Get strong", session_length_minutes: 60 });
  const r = await applyProposalToProfile(supa, "u", SNAPSHOT, { session_length_minutes: 45 });
  assertEquals(r.error, null); assertEquals(r.changed, { session: true });
  assertEquals(db.row.session_length_minutes, 45);
  assertEquals(db.row.goal, "Get strong"); // the goal is not where a session length goes
});

Deno.test("a session length that slipped past validation is refused at apply, nothing written", async () => {
  const { db, supa } = fakeSupa({ goal: "x", session_length_minutes: 60 });
  const r = await applyProposalToProfile(supa, "u", SNAPSHOT, { session_length_minutes: 50 });
  assert(r.error); assertEquals(db.writes, []); assertEquals(db.row.session_length_minutes, 60);
});

Deno.test("the coach is told the session length on file (60 when none is saved) and to propose the field, never goal text", () => {
  assert(buildProposeProfileUpdateTool({ ...SNAPSHOT, session_length_minutes: 45 }).description.includes("session_length_minutes=45;"));
  assert(buildProposeProfileUpdateTool(SNAPSHOT).description.includes("session_length_minutes=unset (60 is used);"));
  assert(PROFILE_UPDATE_PROMPT.includes("NEVER write a session length into goal_append"));
  assert(PROFILE_UPDATE_PROMPT.includes("days per week, goal or session length RE-PLANS"));
});

// ── Equipment on the card (2026-11-23) ─────────────────────────────────────

Deno.test("equipment: only checklist keys, and never the same key in both lists", () => {
  assertEquals(validateProfileProposal({ equipment_dont_have: ["rower"], equipment_have: ["ski_erg"] }), []);
  assert(validateProfileProposal({ equipment_dont_have: ["rowing machine"] })[0].includes("Unknown equipment key"));
  assert(validateProfileProposal({ equipment_have: ["rower"], equipment_dont_have: ["rower"] })[0].includes("cannot be in both"));
  // deno-lint-ignore no-explicit-any
  assert(validateProfileProposal({ equipment_have: "rower" as any }).some((p) => p.includes("must be a list")));
  assert(validateProfileProposal({ equipment_have: [] }).length === 1); // an empty list is no change
  const tool = buildProposeProfileUpdateTool(SNAPSHOT);
  assertEquals(tool.input_schema.properties.equipment_have.items.enum, [...ALL_EQUIPMENT_KEYS]);
  assertEquals(tool.input_schema.properties.equipment_dont_have.items.enum, [...ALL_EQUIPMENT_KEYS]);
  assert(tool.input_schema.properties.equipment_have.description.includes("rope = Climbing Rope"));
});

Deno.test("equipment: only the named keys change, on the FULL record (a key never unticked counts as owned)", () => {
  // A partial stored record: rings unticked, most keys absent.
  const next = applyEquipmentChange({ rings: false, barbell: true }, ["rings"], ["rower", "sled"]);
  assertEquals(Object.keys(next).sort(), [...ALL_EQUIPMENT_KEYS].sort()); // no key left missing
  assertEquals([next.rings, next.rower, next.sled], [true, false, false]);
  const untouched = ALL_EQUIPMENT_KEYS.filter((k) => !["rings", "rower", "sled"].includes(k));
  assert(untouched.every((k) => next[k] === true));
  // A never-reviewed (empty) record: everything owned except what the card names.
  const fromEmpty = applyEquipmentChange({}, [], ["ghd"]);
  assertEquals(ALL_EQUIPMENT_KEYS.filter((k) => fromEmpty[k] === false), ["ghd"]);
  // An explicit false the card did not name stays false.
  assertEquals(applyEquipmentChange({ pegboard: false, rower: true }, [], ["rower"]).pegboard, false);
});

Deno.test("equipment is applied to the record AS IT IS NOW and reported as changed", async () => {
  // The athlete unticked the pegboard on the profile page after the card was drawn.
  const { db, supa } = fakeSupa({ goal: "x", equipment: { pegboard: false, rower: true, ski_erg: false } });
  const r = await applyProposalToProfile(supa, "u", { ...SNAPSHOT, equipment: { rower: true } }, { equipment_dont_have: ["rower"], equipment_have: ["ski_erg"] });
  assertEquals(r.error, null); assertEquals(r.changed, { equipment: true });
  assertEquals([db.row.equipment.rower, db.row.equipment.ski_erg, db.row.equipment.pegboard, db.row.equipment.barbell], [false, true, false, true]);
  assertEquals(Object.keys(db.row.equipment).length, ALL_EQUIPMENT_KEYS.length);
});

Deno.test("the coach sees what is unticked, by the profile's own labels, and is not sent to the profile page for equipment", () => {
  const d = buildProposeProfileUpdateTool({ ...SNAPSHOT, equipment: { rope: false, barbell: true } }).description;
  assert(d.includes('UNTICKED (everything else on the checklist counts as owned)=["Climbing Rope"]'));
  assert(buildProposeProfileUpdateTool(SNAPSHOT).description.includes("counts as owned)=[]"));
  assert(PROFILE_UPDATE_PROMPT.includes("never send the athlete to the profile page or a human for it"));
});

Deno.test("the coach's own instructions in chat no longer route equipment to the checklist or 'the next generation'", () => {
  const chat = Deno.readTextFileSync(new URL("../chat/index.ts", import.meta.url));
  assert(!chat.includes("equipment via the profile's equipment checklist"));
  assert(!chat.includes("until they untick it"));
  assert(!chat.includes("equipment and injury changes apply to the next generation"));
  assert(chat.includes("(days, goal, session length and equipment via propose_profile_update)"));
});

// ── The whole goal (2026-11-23) ────────────────────────────────────────────

Deno.test("the coach is shown the WHOLE goal: text past character 400 (where additions land) is there", () => {
  const goal = "Compete at regionals. ".repeat(30) + "Nov 2026 update: strict HSPU first.";
  assert(goal.length > 600);
  const d = buildProposeProfileUpdateTool({ ...SNAPSHOT, goal }).description;
  assert(d.includes("Nov 2026 update: strict HSPU first."));
  assert(d.includes(goal.slice(0, 60)));
});
