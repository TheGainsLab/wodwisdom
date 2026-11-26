/**
 * engine-screen-targets.ts — what the AI Coach is told about today's Engine
 * targets. Import-free.
 *
 * THE RULE (2026-11-26): the coach quotes the athlete's SCREEN. The Engine day
 * page sends the rows of its "Workout Details" section, built by the same
 * function that draws them (src/lib/engineBreakdown.ts), and the coach is told
 * those rows are the authority.
 *
 * Before this the coach was sent ONE duration-weighted average, told it was
 * "AUTHORITATIVE… the number on the athlete's screen", and told that if the
 * athlete questioned it to explain it "rather than proposing a different
 * number". The average was never on the screen. A member wrote in: "there
 * have been discrepancies between the paces advised in the Workout Details
 * section and the AI advice… which should I follow?"
 */

const MAX_LINES = 80;
const MAX_LINE = 160;

/** The rows the page sent, made safe to place in a prompt: strings only,
 *  control characters removed, bounded in number and length. */
export function cleanScreenTargets(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    // deno-lint-ignore no-control-regex
    const line = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LINE);
    if (line) out.push(line);
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

/** A short stable key for a set of rows, so a cached answer is only reused
 *  for the same screen. */
export function screenTargetsKey(lines: string[]): string {
  let h = 5381;
  for (const ch of lines.join("\n")) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

/**
 * The targets section of the Engine day dossier. Returns "" when the page sent
 * neither rows nor an average (the caller then says no target is available).
 */
export function screenTargetsBlock(lines: string[], averagePace: number | null, units: string | null): string {
  if (lines.length > 0) {
    return (
      `\nTODAY'S TARGETS, EXACTLY AS SHOWN ON THE ATHLETE'S SCREEN (the "Workout Details" section of this day, one line per part, in order):\n` +
      lines.map((l) => `  ${l}`).join("\n") +
      `\nTHE SCREEN IS THE AUTHORITY. When you give pacing, give THESE numbers, part by part, exactly as written. ` +
      `Parts differ on purpose: never blend them into one pace for the session, never round one into another, and never give a number that is not in the lines above. ` +
      `A part marked "Max Effort" has no number: say it is all-out. A part shown as a percentage or "—" has no computed target on the screen: say so and do not invent one. ` +
      `If the athlete tells you their screen shows something different from these lines, their screen is right: say so plainly and coach to what they see. ` +
      `You may explain where targets come from (their time-trial baseline scaled to each part's intended intensity, adjusted by recent performance). ` +
      `Do not derive pacing from the raw time-trial baseline.`
    );
  }
  if (averagePace != null) {
    const unit = units ? ` ${units}/min` : " per minute";
    return (
      `\nTODAY'S AVERAGE TARGET: ${Number(averagePace.toFixed(2))}${unit}, averaged across all of today's work. ` +
      `This is NOT a number on the athlete's screen. Their screen ("Workout Details" on this day) shows a target for each part of the session, and parts can differ from this average. ` +
      `THE SCREEN IS THE AUTHORITY: tell the athlete to pace each part by the target shown beside it on their screen, and use this average only to describe the session's overall level. ` +
      `Never present it as the pace for a specific interval. If the athlete quotes a number from their screen, that number is right.`
    );
  }
  return "";
}
