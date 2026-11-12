/**
 * engine-switch — where an athlete lands when they change program (days per
 * week) mid-program. Pure; shared by the app's switchProgram and tests.
 *
 * Founder decision 2026-11-12: a switch takes effect at the NEXT WEEK
 * BOUNDARY. An athlete in month two, week two of the 3-day program who
 * switches to 4 days picks up at month two, week three of the 4-day
 * program. Earlier months are credited, never redone. Switching down works
 * the same way; the extra days already done stay as history.
 *
 * Week numbers run through the whole program (month m = weeks 4m-3..4m on
 * the main programs), so "the same week" is the same week_number in the new
 * mapping. Programs whose mappings carry no week numbers (or share none)
 * fall back to the old rule: pick up after the furthest completed position
 * in the new program, day 1 when there is none.
 */

export interface SwitchMappingRow {
  /** program_sequence_order */
  seq: number;
  month: number;
  /** week_number, program-wide; null when the mapping has none */
  week: number | null;
}

export interface SwitchLanding {
  /** engine_current_day to set in the new program */
  position: number;
  /** true when the landing was translated from the old program's week */
  carried: boolean;
  /** the week the athlete lands in, when known */
  week: number | null;
  reason: string;
}

/**
 * @param oldMapping        the program being left
 * @param oldMaxCompleted   furthest completed sequence position in it (0 = none)
 * @param newMapping        the program being joined
 * @param newMaxCompleted   furthest completed sequence position already in it (0 = none)
 */
export function translateSwitchPosition(
  oldMapping: SwitchMappingRow[],
  oldMaxCompleted: number,
  newMapping: SwitchMappingRow[],
  newMaxCompleted: number,
): SwitchLanding {
  const newSorted = [...newMapping].sort((a, b) => a.seq - b.seq);
  const lastSeq = newSorted.length ? newSorted[newSorted.length - 1].seq : 0;
  const clamp = (p: number) => (lastSeq > 0 ? Math.min(p, lastSeq) : p);
  const fallback = (why: string): SwitchLanding => ({
    position: clamp(newMaxCompleted + 1),
    carried: false,
    week: newSorted.find((r) => r.seq === clamp(newMaxCompleted + 1))?.week ?? null,
    reason: why,
  });

  if (oldMaxCompleted <= 0) return fallback("no progress in the previous program");

  // The week the athlete is in: the week of the furthest completed position.
  const oldRow = [...oldMapping].filter((r) => r.seq <= oldMaxCompleted).sort((a, b) => b.seq - a.seq)[0];
  if (!oldRow || oldRow.week == null) return fallback("previous program has no week numbers at that position");

  const targetWeek = oldRow.week + 1;
  const sameOrLater = newSorted.filter((r) => r.week != null && (r.week as number) >= targetWeek);
  if (sameOrLater.length === 0) {
    // Past the end of the new program's numbered weeks: land on its last position.
    if (newSorted.some((r) => r.week != null)) {
      return { position: Math.max(lastSeq, newMaxCompleted + 1), carried: true, week: newSorted[newSorted.length - 1].week, reason: `week ${targetWeek} is past the end of the new program; landing on its last day` };
    }
    return fallback("new program has no week numbers");
  }
  const first = sameOrLater[0]; // first position of the target week (or the next numbered week)
  // Never move an athlete backwards in a program they already progressed in.
  const position = Math.max(first.seq, newMaxCompleted + 1);
  return {
    position: clamp(position),
    carried: true,
    week: first.week,
    reason: `week ${oldRow.week} (month ${oldRow.month}) → first day of week ${first.week} (month ${first.month}) in the new program`,
  };
}
