/**
 * Conversational nudge templates appended to assistant responses by the
 * chat-nudge-classify pipeline.
 *
 * Tier 1 ("basics") nudges fire when the user hasn't filled their basics yet
 * and the answer would have been more personalized with that data.
 *
 * Tier 2 nudges fire when basics are present but lifts/skills/conditioning
 * are missing and the answer would have been sharper with that data.
 *
 * Tier 3 (training context + equipment) is not nudged in chat — that lives
 * on the profile page itself.
 */

export type ProfileSection = 'basics' | 'lifts' | 'skills' | 'conditioning';

const PROFILE_HREF = '/profile';

// Tier 1 — basics. Fires when the user has nothing in their profile yet.
const BASICS_TEMPLATES: string[] = [
  `I can tailor this to you in about 60 seconds — [add the basics](${PROFILE_HREF}) (age, weight, gender) and every answer gets sharper.`,
  `Quick win: [60 seconds of basics](${PROFILE_HREF}) (age, weight, gender) and I can be more specific to you from here on.`,
  `I'd be more precise with your [basics filled in](${PROFILE_HREF}) — takes a minute, and your answers get noticeably better.`,
  `Drop in your [age, weight, and gender](${PROFILE_HREF}) and I can target this to you specifically.`,
];

// Tier 2 — generic when ≥ 2 sections are missing and relevant.
const T2_GENERIC_TEMPLATES: string[] = [
  `I can be more precise once you [complete your profile](${PROFILE_HREF}) — you'll also get your free fitness analysis.`,
  `I'd tailor this more specifically with your [full profile filled in](${PROFILE_HREF}) — it unlocks your free fitness analysis too.`,
  `This would be more personalized once your [profile is complete](${PROFILE_HREF}) — and your profile generates a free fitness analysis.`,
  `I'd give you a sharper answer once you [finish your profile](${PROFILE_HREF}) — you'll also get your free fitness analysis.`,
];

// Tier 2 — single section variants.
const T2_SINGLE_TEMPLATES: Record<Exclude<ProfileSection, 'basics'>, string[]> = {
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
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Picks a conversational one-liner (markdown) to append to an AI response,
 * or null if nothing should render.
 *
 * Sections come from the classifier and are scoped to a single tier:
 *   - ['basics'] (or any list containing 'basics') → T1 template
 *   - 1 T2 section → section-specific T2 template
 *   - 2+ T2 sections → generic T2 template
 *   - empty → null
 */
export function pickNudgeTemplate(missingSections: ProfileSection[]): string | null {
  if (!missingSections || missingSections.length === 0) return null;

  // T1 always wins if present — basics are the foundation.
  if (missingSections.includes('basics')) {
    return pickRandom(BASICS_TEMPLATES);
  }

  const t2Sections = missingSections.filter(
    (s): s is Exclude<ProfileSection, 'basics'> => s !== 'basics'
  );

  if (t2Sections.length === 0) return null;
  if (t2Sections.length === 1) {
    return pickRandom(T2_SINGLE_TEMPLATES[t2Sections[0]]);
  }
  return pickRandom(T2_GENERIC_TEMPLATES);
}
