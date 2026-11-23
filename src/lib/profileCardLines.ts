/**
 * What the coach's profile card (src/components/ProfileUpdateCard.tsx) shows
 * for an equipment change — pure, tested in tests/profileCardLines.test.ts.
 * Added 2026-11-23 with the card's session-length and equipment fields.
 */

/** Shown as the "old" session length when none is saved: the program is built
 *  to 60 minutes in that case, and the profile's slider shows 60. */
export const DEFAULT_SESSION_LENGTH_SHOWN = 60;

export interface EquipmentChangeLine {
  key: string;
  was: 'Have' | "Don't have";
  now: 'Have' | "Don't have";
}

/**
 * One line per equipment item the card names, in the order: marked as have,
 * then marked as don't have. `was` is read the way the profile page reads the
 * stored record: only an explicit false is "don't have".
 */
export function equipmentChangeLines(
  current: Record<string, unknown> | null | undefined,
  have: string[] | undefined,
  dontHave: string[] | undefined,
): EquipmentChangeLine[] {
  const was = (key: string) => (current?.[key] === false ? "Don't have" : 'Have') as EquipmentChangeLine['was'];
  return [
    ...(have ?? []).map(key => ({ key, was: was(key), now: 'Have' as const })),
    ...(dontHave ?? []).map(key => ({ key, was: was(key), now: "Don't have" as const })),
  ];
}
