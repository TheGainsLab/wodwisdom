/**
 * Golden AthleteModel regression suite (deterministic foundation).
 *
 *   verify:   deno test supabase/functions/_shared/golden-athletes_test.ts --allow-read
 *   regen:    UPDATE_GOLDENS=1 deno test ... --allow-read --allow-write
 *
 * Each golden-athletes/<name>.json is self-contained (profile + competition +
 * expected_model). The test recomputes the model FROM the golden's own inputs
 * and asserts it equals the stored expected_model — so any change to
 * buildAthleteModel / thresholds surfaces as a reviewable diff. See
 * golden-athletes/README.md. (LLM layers are guarded by invariants, not here.)
 */

import { assertEquals } from "jsr:@std/assert";
import {
  type AthleteModelCompetitionInput,
  buildAthleteModel,
  profileStaticFromRow,
  type RawProfileRow,
} from "./athlete-model.ts";
import { ALL_FIXTURES, type ProfileFixture } from "./fixtures/profile-fixtures.ts";

const DIR = new URL("./golden-athletes/", import.meta.url);
const UPDATE = Deno.env.get("UPDATE_GOLDENS") === "1";

/** The exact competition slice buildAthleteModel reads — frozen into the golden
 *  so the snapshot stays deterministic (no live Tier 4 fetch). */
function competitionSlice(
  bundle: ProfileFixture["bundle"],
): AthleteModelCompetitionInput | null {
  if (!bundle) return null;
  return {
    competition_summary: bundle.competition_summary,
    power_profile: bundle.power_profile ?? null,
    movement_affinity: bundle.movement_affinity,
  };
}

interface GoldenAthlete {
  name: string;
  description: string;
  profile: RawProfileRow;
  competition: AthleteModelCompetitionInput | null;
  expected_model: ReturnType<typeof buildAthleteModel>;
}

for (const fx of ALL_FIXTURES) {
  Deno.test(`golden model: ${fx.name}`, async () => {
    const path = new URL(`${fx.name}.json`, DIR);

    if (UPDATE) {
      const competition = competitionSlice(fx.bundle);
      const golden: GoldenAthlete = {
        name: fx.name,
        description: `${fx.description} (SYNTHETIC test fixture — NOT real athlete data)`,
        profile: fx.profileRow as RawProfileRow,
        competition,
        expected_model: buildAthleteModel(profileStaticFromRow(fx.profileRow as RawProfileRow), competition),
      };
      await Deno.writeTextFile(path, JSON.stringify(golden, null, 2) + "\n");
      return;
    }

    const golden = JSON.parse(await Deno.readTextFile(path)) as GoldenAthlete;
    // Recompute from the golden's OWN inputs (self-contained) and assert it
    // matches the committed expected_model. assertEquals is order-independent.
    const recomputed = buildAthleteModel(
      profileStaticFromRow(golden.profile),
      golden.competition,
    );
    assertEquals(recomputed, golden.expected_model);
  });
}
