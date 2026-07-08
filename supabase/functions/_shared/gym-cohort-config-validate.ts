/**
 * gym-cohort-config-validate.ts — the writable-field whitelist + validation for
 * the gym-cohort-config endpoint (the owner-brief write path).
 *
 * Pure + DB-free (unit-testable). Only PROVIDED keys are written (partial
 * update). Rejects rather than silently drops — notably a non-canonical
 * equipment key, which the envelope's equipmentMap would read as "gym doesn't
 * own it" and quietly block every future generation (the 2026-07-07 seed-row
 * lesson). Bookkeeping columns (last_attempt_at / attempt_count /
 * next_attempt_at) are intentionally NOT writable.
 */

import { ALL_EQUIPMENT_KEYS } from "./tier-status.ts";

const CANONICAL_EQUIPMENT = new Set<string>(ALL_EQUIPMENT_KEYS);
const TARGET_LEVELS = new Set(["beginner", "intermediate", "advanced"]);
const UNITS = new Set(["lbs", "kg"]);

export interface ConfigInput {
  days_per_week?: unknown;
  session_length_minutes?: unknown;
  equipment?: unknown;
  target_level?: unknown;
  do_not_program?: unknown;
  units?: unknown;
  goal_text?: unknown;
  strategy?: unknown;
  active?: unknown;
}

export function buildConfigPatch(
  config: ConfigInput,
): { patch?: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};

  if (config.days_per_week !== undefined) {
    const d = config.days_per_week;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 3 || d > 6) {
      return { error: "days_per_week must be an integer 3-6" };
    }
    patch.days_per_week = d;
  }
  if (config.session_length_minutes !== undefined) {
    const s = config.session_length_minutes;
    if (s !== null && (typeof s !== "number" || !Number.isFinite(s) || s < 20 || s > 180)) {
      return { error: "session_length_minutes must be null or 20-180" };
    }
    patch.session_length_minutes = s;
  }
  if (config.equipment !== undefined) {
    if (!Array.isArray(config.equipment) || config.equipment.some((e) => typeof e !== "string")) {
      return { error: "equipment must be a string array" };
    }
    const keys = (config.equipment as string[]).map((e) => e.trim());
    const unknown = keys.filter((k) => !CANONICAL_EQUIPMENT.has(k));
    if (unknown.length > 0) {
      return { error: `unknown equipment key(s): ${unknown.join(", ")}. Canonical: ${ALL_EQUIPMENT_KEYS.join(", ")}` };
    }
    patch.equipment = keys;
  }
  if (config.target_level !== undefined) {
    if (typeof config.target_level !== "string" || !TARGET_LEVELS.has(config.target_level)) {
      return { error: "target_level must be beginner|intermediate|advanced" };
    }
    patch.target_level = config.target_level;
  }
  if (config.do_not_program !== undefined) {
    if (!Array.isArray(config.do_not_program) || config.do_not_program.some((e) => typeof e !== "string")) {
      return { error: "do_not_program must be a string array" };
    }
    patch.do_not_program = (config.do_not_program as string[]).map((s) => s.trim()).filter(Boolean);
  }
  if (config.units !== undefined) {
    if (typeof config.units !== "string" || !UNITS.has(config.units)) {
      return { error: "units must be lbs|kg" };
    }
    patch.units = config.units;
  }
  if (config.goal_text !== undefined) {
    if (config.goal_text !== null && typeof config.goal_text !== "string") {
      return { error: "goal_text must be a string or null" };
    }
    patch.goal_text = config.goal_text === null ? null : (config.goal_text as string).slice(0, 4000);
  }
  if (config.strategy !== undefined) {
    // Shape-checked lightly here; the envelope builder is the semantic reader
    // (clamps slider values, resolves the split). Reject non-objects so a
    // stringified-JSON mistake can't be stored as a jsonb string.
    if (config.strategy !== null && (typeof config.strategy !== "object" || Array.isArray(config.strategy))) {
      return { error: "strategy must be an object or null" };
    }
    patch.strategy = config.strategy;
  }
  if (config.active !== undefined) {
    if (typeof config.active !== "boolean") return { error: "active must be a boolean" };
    patch.active = config.active;
  }

  if (Object.keys(patch).length === 0) return { error: "config has no writable fields" };
  return { patch };
}
