export type ProfileSection = 'lifts' | 'skills' | 'conditioning' | 'equipment';

const PROFILE_HREF = '/profile';

const GENERIC_TEMPLATES: string[] = [
  `I can be more precise once you [complete your profile](${PROFILE_HREF}) — you'll also get your free fitness analysis.`,
  `I'd tailor this more specifically with your [full profile filled in](${PROFILE_HREF}) — it unlocks your free fitness analysis too.`,
  `This would be more personalized once your [profile is complete](${PROFILE_HREF}) — and your profile generates a free fitness analysis.`,
  `I'd give you a sharper answer once you [finish your profile](${PROFILE_HREF}) — you'll also get your free fitness analysis.`,
];

const SINGLE_TEMPLATES: Record<ProfileSection, string[]> = {
  lifts: [
    `I can be more precise about load once I know your [1RMs](${PROFILE_HREF}) — your profile also generates a free fitness analysis.`,
    `I'd tailor this better with your [strength numbers](${PROFILE_HREF}) — your profile also produces a free fitness analysis.`,
    `This gets more specific once I have your [lifts](${PROFILE_HREF}) — and your profile unlocks a free fitness analysis.`,
  ],
  skills: [
    `I can be more personalized once I know your [skill levels](${PROFILE_HREF}) — your profile also generates a free fitness analysis.`,
    `I'd tailor progressions more precisely with your [skills filled in](${PROFILE_HREF}) — your profile also produces a free fitness analysis.`,
    `This gets more specific once I know your [skills](${PROFILE_HREF}) — and your profile unlocks a free fitness analysis.`,
  ],
  conditioning: [
    `I can be more precise with your [conditioning benchmarks](${PROFILE_HREF}) — your profile also generates a free fitness analysis.`,
    `I'd tailor pacing better with your [benchmark times](${PROFILE_HREF}) — your profile also produces a free fitness analysis.`,
    `This gets more specific once I have your [conditioning numbers](${PROFILE_HREF}) — and your profile unlocks a free fitness analysis.`,
  ],
  equipment: [
    `I can be more specific to your setup once you add your [equipment](${PROFILE_HREF}) — your profile also generates a free fitness analysis.`,
    `I'd tailor this to what you have if you [fill in your equipment](${PROFILE_HREF}) — your profile also produces a free fitness analysis.`,
    `This gets more specific with your [equipment list](${PROFILE_HREF}) — and your profile unlocks a free fitness analysis.`,
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Returns a conversational one-liner (markdown) to append to an AI response,
 * or null if no nudge should render.
 *
 * - 0 missing → null
 * - 1 missing → section-specific template
 * - 2+ missing → generic "complete your profile" template
 */
export function pickNudgeTemplate(missingSections: ProfileSection[]): string | null {
  if (!missingSections || missingSections.length === 0) return null;
  if (missingSections.length === 1) {
    return pickRandom(SINGLE_TEMPLATES[missingSections[0]]);
  }
  return pickRandom(GENERIC_TEMPLATES);
}
