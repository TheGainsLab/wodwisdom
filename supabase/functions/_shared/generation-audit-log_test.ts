/**
 * generation-audit-log_test.ts — the pure halves of the audit trail:
 * findings-only gating and failure flattening. (The insert itself is a
 * best-effort supabase write, exercised by the pipeline.)
 */

import { assertEquals } from "jsr:@std/assert";
import { auditEntryHasSignal, formatAuditFailuresForLog } from "./generation-audit-log.ts";

const base = { user_id: "u", stage: "metcons" as const };

Deno.test("clean unretried outcomes carry no signal — no row is written", () => {
  assertEquals(auditEntryHasSignal({ ...base }), false);
  assertEquals(auditEntryHasSignal({ ...base, violations: [], warnings: [] }), false);
});

Deno.test("violations, warnings, and retry-even-if-clean each earn a row", () => {
  assertEquals(auditEntryHasSignal({ ...base, violations: ["v"] }), true);
  assertEquals(auditEntryHasSignal({ ...base, warnings: ["w"] }), true);
  // Retry frequency is itself a signal: a retry that then passed clean still logs.
  assertEquals(auditEntryHasSignal({ ...base, retried: true }), true);
});

Deno.test("structured audit failures flatten to rule-prefixed lines", () => {
  const lines = formatAuditFailuresForLog([
    { rule: "metcon_one_piece", passed: false, violations: ["W1D2 has two pieces", "W3D1 empty"] },
    { rule: "plate_math_safe", passed: false, violations: ["W2D4 load 187 not plate-loadable"] },
  ]);
  assertEquals(lines, [
    "metcon_one_piece: W1D2 has two pieces",
    "metcon_one_piece: W3D1 empty",
    "plate_math_safe: W2D4 load 187 not plate-loadable",
  ]);
});

Deno.test("unknown failure shapes are stringified, never dropped", () => {
  const lines = formatAuditFailuresForLog([{ weird: true }]);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].startsWith("unknown_rule: "), true);
});
