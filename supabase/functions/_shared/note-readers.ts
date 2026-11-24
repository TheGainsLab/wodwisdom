/**
 * note-readers.ts — who reads a "tell your coach" note, said truthfully for
 * ONE athlete. PURE and import-free: the coach (server) and the app's screens
 * use the same sentences.
 *
 * Why (2026-11-24): the coach, the note card, the notes box and the Engine
 * dashboard all said the Engine would read a note "for its next block" or
 * "within days". The Engine reads notes in exactly one place, the AI
 * sequencer (run-resequence.ts), which runs only for athletes who switched AI
 * Sequencing on, and only from their second Engine month (month one is a
 * fixed assessment: engine-readiness.ts sequencerGate). On 2026-11-24, 52 of
 * 61 Engine members had it off: told "the Engine will go easier", they would
 * get the same sessions.
 */

export interface NoteReaderFacts {
  hasProgramming: boolean;
  hasEngine: boolean;
  /** athlete_profiles.engine_ai_sequencing === true */
  aiSequencing: boolean;
}

export const PROGRAMMING_READS = "AI Programming reads it the next time it writes a week for you.";
export const ENGINE_READS =
  "The Engine reads it when it picks your next block. Month one is a fixed assessment, so that starts from your second month.";
export const ENGINE_FIXED_ORDER =
  "Your Engine sessions follow a fixed order, so a note doesn't change them. Turn on AI Sequencing in Settings and the Engine will use it.";
export const NOTHING_READS_YET = "It's kept on your account and used when you start a program.";

/** The sentences for this athlete, in order. Never empty. */
export function noteReadByLines(f: NoteReaderFacts): string[] {
  const out: string[] = [];
  if (f.hasProgramming) out.push(PROGRAMMING_READS);
  if (f.hasEngine) out.push(f.aiSequencing ? ENGINE_READS : ENGINE_FIXED_ORDER);
  if (out.length === 0) out.push(NOTHING_READS_YET);
  return out;
}

export const noteReadBy = (f: NoteReaderFacts): string => noteReadByLines(f).join(" ");
