// deno test supabase/functions/_shared/program-evidence_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summarizeEvidence, type EvidenceDay } from "./program-evidence.ts";

const now = new Date("2026-11-13T12:00:00Z");
const day = (week: number, day: number, status: EvidenceDay["status"], date: string | null, blocks: EvidenceDay["blocks"] = []): EvidenceDay => ({ week, day, status, date, blocks });
const mv = (o: Partial<EvidenceDay["blocks"][0]["movements"][0]> & { movement: string }) => ({ sets: 3, reps: 5, weight: null, unit: "kg", prescribed_weight: null, prescribed_reps: 5, rpe: null, skipped: false, skip_reason: null, ...o });

Deno.test("empty → empty", () => { assertEquals(summarizeEvidence([], now), ""); });

Deno.test("lifted vs prescribed, RPE, metcon result, skipped block with reason, not-done day", () => {
  const days = [
    day(1, 1, "logged", "2026-11-10", [
      { label: "Strength", type: "strength", rpe: 8, score: null, time_domain: null, notes: null, skipped: false, skip_reason: null,
        movements: [mv({ movement: "Back Squat", sets: 5, reps: 3, weight: 115, prescribed_weight: 110, rpe: 8 })] },
      { label: "Metcon", type: "metcon", rpe: null, score: "12:40", time_domain: "medium", notes: null, skipped: false, skip_reason: null, movements: [] },
      { label: "Accessory", type: "accessory", rpe: null, score: null, time_domain: null, notes: null, skipped: true, skip_reason: "no time", movements: [] },
    ]),
    day(1, 2, "not_done", null),
  ];
  const s = summarizeEvidence(days, now);
  assertEquals(s.includes("Back Squat 5×3 @ 115 kg (prescribed 110) RPE 8"), true);
  assertEquals(s.includes("result 12:40 (medium)"), true);
  assertEquals(s.includes("Accessory SKIPPED (no time)"), true);
  assertEquals(s.includes("W1D2: NOT DONE"), true);
  assertEquals(s.includes("1 day not done."), true);
  assertEquals(s.includes("Last logged"), false); // 3 days ago: no layoff line
});

Deno.test("a layoff of a week or more is named", () => {
  const s = summarizeEvidence([day(1, 1, "logged", "2026-10-30", [])], now);
  assertEquals(s.includes("Last logged 14 days ago."), true);
});
