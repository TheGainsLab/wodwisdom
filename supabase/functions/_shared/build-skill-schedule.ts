/**
 * Build a 12×5 skill schedule grid from ranked priorities.
 *
 * Assigns one skill to each (week, day) slot, ensuring:
 * - Top 2 priorities appear 2x/week (non-consecutive days) in build weeks
 * - Lower priorities appear 1x/week
 * - Deload weeks (4, 8, 12) only use top 2 skills at 1x each
 * - Same skill never on consecutive day numbers
 * - Remaining slots filled by rotating through lower-priority skills
 */

import type { SkillPriority } from "./skill-priorities.ts";

export interface SkillSlot {
  week: number;
  day: number;
  skill: string;
  displayName: string;
  level: string;
}

const DELOAD_WEEKS = new Set([4, 8, 12]);
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export function dayName(dayNum: number): string {
  return DAY_NAMES[dayNum - 1] ?? `Day${dayNum}`;
}

/**
 * Build the full skill schedule.
 *
 * @param priorities  Sorted output from rankSkillPriorities()
 * @param totalWeeks  Number of weeks (default 12)
 * @param daysPerWeek Number of training days per week (default 5)
 */
export function buildSkillSchedule(
  priorities: SkillPriority[],
  totalWeeks = 12,
  daysPerWeek = 5,
): SkillSlot[] {
  if (priorities.length === 0) return [];

  // Collect advanced/maintenance skills as fallback fillers
  // (these are skills NOT in priorities — they were filtered out as advanced)
  // We don't have them here, so if we run out of priorities we cycle back.

  const schedule: SkillSlot[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const isDeload = DELOAD_WEEKS.has(week);
    const slots: (SkillSlot | null)[] = new Array(daysPerWeek).fill(null);

    // Track which skills have been placed this week and on which days
    const placedSkills = new Map<string, number[]>(); // skill → day indices

    // Phase 1: Place priority skills according to their maxPerWeek
    for (const p of priorities) {
      const maxThisWeek = isDeload
        ? (p.maxPerWeek >= 2 ? 1 : 0)  // deload: top skills 1x, others 0x
        : p.maxPerWeek;

      if (maxThisWeek === 0) continue;

      let placed = 0;
      for (let d = 0; d < daysPerWeek && placed < maxThisWeek; d++) {
        if (slots[d] !== null) continue;

        // Check non-consecutive: this skill can't be on day d if it was on d-1
        const prevDays = placedSkills.get(p.skill) ?? [];
        if (prevDays.some((pd) => Math.abs(pd - d) === 1)) continue;

        slots[d] = {
          week,
          day: d + 1,
          skill: p.skill,
          displayName: p.displayName,
          level: p.level,
        };
        placedSkills.set(p.skill, [...prevDays, d]);
        placed++;
      }
    }

    // Phase 2: Fill remaining empty slots by cycling through priorities
    // Use a rotating index so lower-priority skills get spread across weeks
    const rotateOffset = (week - 1) % Math.max(priorities.length, 1);

    for (let d = 0; d < daysPerWeek; d++) {
      if (slots[d] !== null) continue;
      if (isDeload) {
        // On deload, leave unfilled slots empty — fewer skill sessions
        // But we need at least something, so use top priority as fallback
        const fallback = priorities[0];
        const prevDays = placedSkills.get(fallback.skill) ?? [];
        if (!prevDays.some((pd) => Math.abs(pd - d) === 1)) {
          slots[d] = {
            week,
            day: d + 1,
            skill: fallback.skill,
            displayName: fallback.displayName,
            level: fallback.level,
          };
          placedSkills.set(fallback.skill, [...prevDays, d]);
        }
        continue;
      }

      // Try each priority starting from rotated offset
      for (let i = 0; i < priorities.length; i++) {
        const p = priorities[(i + rotateOffset) % priorities.length];
        const prevDays = placedSkills.get(p.skill) ?? [];

        // Don't exceed 2x for any skill in a week
        if (prevDays.length >= 2) continue;
        // Non-consecutive check
        if (prevDays.some((pd) => Math.abs(pd - d) === 1)) continue;

        slots[d] = {
          week,
          day: d + 1,
          skill: p.skill,
          displayName: p.displayName,
          level: p.level,
        };
        placedSkills.set(p.skill, [...prevDays, d]);
        break;
      }

      // If still unfilled (very unlikely unless only 1-2 skills),
      // allow a skill to appear a 3rd time as last resort
      if (slots[d] === null && priorities.length > 0) {
        for (const p of priorities) {
          const prevDays = placedSkills.get(p.skill) ?? [];
          if (prevDays.some((pd) => Math.abs(pd - d) === 1)) continue;
          slots[d] = {
            week,
            day: d + 1,
            skill: p.skill,
            displayName: p.displayName,
            level: p.level,
          };
          placedSkills.set(p.skill, [...prevDays, d]);
          break;
        }
      }
    }

    // Push all filled slots
    for (const slot of slots) {
      if (slot) schedule.push(slot);
    }
  }

  return schedule;
}

/**
 * Format the schedule as a string block for prompt injection.
 */
export function formatScheduleForPrompt(schedule: SkillSlot[]): string {
  const lines: string[] = [];
  let currentWeek = 0;

  for (const slot of schedule) {
    if (slot.week !== currentWeek) {
      currentWeek = slot.week;
      if (lines.length > 0) lines.push(""); // blank line between weeks
      const phase = DELOAD_WEEKS.has(slot.week) ? "deload" : "build";
      lines.push(`Week ${slot.week} (${phase}):`);
    }
    lines.push(`  ${dayName(slot.day)}: ${slot.displayName} (athlete level: ${slot.level})`);
  }

  return lines.join("\n");
}
