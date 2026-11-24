/**
 * profile-effect-text.ts — the sentences that say what a profile change does
 * to an athlete's training, and when. PURE and import-free, so the coach's
 * card (server) and the Athlete Profile page (app) use the SAME words and
 * cannot drift apart (2026-11-24: the page only showed a green tick).
 *
 * `voice`: the coach speaks as "me" ("ask me there"); the page speaks about
 * the coach ("ask the coach there").
 */

export interface EffectFacts {
  hasProgramming: boolean;
  hasEngine: boolean;
  /** The athlete's live generated program, if any. */
  program: { weekly: boolean; outlineWeeksLeft: number } | null;
  /** Engine: has chosen a program / has AI sequencing on. */
  engineProgramChosen: boolean;
  engineSequencing: boolean;
}

export interface AppliedChange {
  days?: boolean;
  goal?: boolean;
  injuries?: boolean;
  session?: boolean;
  equipment?: boolean;
}

/** Sentences for the athlete, in order. Never empty when something changed. */
export function describeEffect(change: AppliedChange, f: EffectFacts, voice: "coach" | "page" = "coach"): string[] {
  const ask = voice === "page" ? "open it and ask the coach there" : "open it and ask me there";
  const out: string[] = [];
  const planChange = !!(change.days || change.goal || change.session);

  if (f.hasProgramming) {
    if (planChange) {
      if (!f.program) out.push("Your program will be built from it.");
      else if (f.program.weekly && f.program.outlineWeeksLeft > 0) {
        out.push("The weeks of this month that aren't written yet are re-planned from it when your next week is written. Weeks already written stay as they are.");
      } else {
        out.push(`It applies from your next month. Weeks already written stay as they are; to change one of those days, ${ask}.`);
      }
    }
    if (change.injuries) {
      out.push(f.program
        ? `Every week written from now on is checked against it. Weeks already written stay as they are; to change one of those days, ${ask}.`
        : "Your program will be built around it.");
    }
    if (change.equipment) {
      out.push(f.program
        ? `New weeks are written without the equipment you don't have. Weeks already written stay as they are; to change one of those days, ${ask}.`
        : "Your program will be built with the equipment you have.");
    }
  }

  if (f.hasEngine) {
    if (change.goal) {
      out.push(f.engineSequencing
        ? "The Engine uses it the next time it chooses your sessions."
        : "Your Engine sessions follow a fixed order, so this doesn't change them unless you turn on AI Sequencing.");
    }
    if (change.days) {
      out.push("This doesn't change your Engine week: Engine days per week come from your Engine program, which you can change with Switch Program.");
    }
  }

  // Engine-only: neither setting is read by the Engine. Say so rather than
  // leave "Saved to your profile" to imply a change to their training.
  if (f.hasEngine && !f.hasProgramming) {
    if (change.session) {
      out.push("This doesn't change your Engine sessions: session length is an AI Programming setting, and each Engine day has its own length.");
    }
    if (change.equipment) {
      out.push("This doesn't change your Engine days: you pick your machine when you open each Engine day.");
    }
  }

  if (out.length === 0) {
    out.push(f.hasProgramming || f.hasEngine ? "Saved to your profile." : "Saved to your profile. It's used when you start a program.");
  }
  return out;
}
