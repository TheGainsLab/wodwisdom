/**
 * equipment-labels.ts — the member-facing name of each equipment key, as the
 * profile page's checklist shows it (EQUIPMENT_GROUPS in AthletePage.tsx).
 *
 * Why (2026-11-23): the coach's profile card can now change equipment, and
 * the coach is shown what the member has and has unticked. Both must use the
 * names the member sees on their profile, not snake_case keys. Pure, no
 * imports: the app's card (src/components/ProfileUpdateCard.tsx) imports it
 * too. equipment-labels_test.ts fails if the profile page's labels drift.
 */
export const EQUIPMENT_LABELS: Record<string, string> = {
  // Cardio
  rower: "Rower",
  assault_bike: "Assault/Echo Bike",
  ski_erg: "Ski Erg",
  treadmill: "Treadmill",
  jump_rope: "Jump Rope",
  // Barbell & Weights
  barbell: "Barbell & Plates",
  dumbbells: "Dumbbells",
  kettlebells: "Kettlebells",
  bench: "Bench",
  // Gymnastics
  pull_up_bar: "Pull-Up Bar",
  rings: "Rings",
  rope: "Climbing Rope",
  ghd: "GHD",
  parallettes: "Parallettes",
  pegboard: "Pegboard",
  // Other
  box: "Plyo Box",
  wall_ball: "Wall Ball",
  sled: "Sled/Prowler",
  blocks: "Lifting Blocks",
  bands: "Resistance Bands",
};

/** The label for a key; an unknown key reads as its words. */
export function equipmentLabel(key: string): string {
  return EQUIPMENT_LABELS[key] ?? key.replace(/_/g, " ");
}
