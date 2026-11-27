/**
 * mainsite-clean.ts — one main site entry reduced to the workout itself.
 *
 * The library holds every CrossFit main site workout from 2001 to 2025, one
 * entry each: a header (date, category, movements), the workout, and then
 * whatever the page carried after it — "Post time to comments", links to old
 * dates, scaling options, coaching notes, hero tributes, photo credits.
 *
 * The composer is shown real main site metcons as examples of what a
 * well-written workout looks like: format, layout, how movements are paired
 * and how reps and loads are stated (founder, 2026-11-27: "We're using the
 * workouts to show what well-written workouts look like"). For that it needs
 * the workout and its name, nothing else.
 *
 * Plain text rules, no AI. Run ONCE; the cleaned text is stored beside the
 * original, which is never changed. Founder's rulings on what is cut:
 * scaling information — all of it; tribute paragraphs — all of it.
 */

export interface CleanedWorkout {
  /** yyyy-mm-dd from the entry's header, or null. */
  date: string | null;
  /** "For Time" | "AMRAP" | "Tabata" | "EMOM". */
  kind: string;
  /** The workout's own name when it has one ("Fran", "BSU"). */
  name: string | null;
  /** The workout, as plain text. */
  text: string;
}

/** The four kinds that are metcons. "Strength" and "Other" are not examples. */
export const METCON_KINDS = ["For Time", "AMRAP", "Tabata", "EMOM"] as const;

/** Where the workout ends when one of these starts a line. */
const END_AT_LINE = new RegExp(
  "^\\s*(?:[*_\"“”\\[]*\\s*)?(?:" + [
    "Post\\b", "Compare\\b", "Sc(?:r)?oll (?:for|to)\\b", "Related\\b", "Scaling\\b", "Scaled\\b", "Beginner\\b", "Intermediate\\b",
    "Resources\\b", "Find a\\b", "Coaching cues\\b", "Stimulus\\b", "Featured photo\\b", "Notes?\\b", "View the\\b",
    "Visit the\\b", "Enlarge\\b", "If you\\b", "Beat\\b", "In honor\\b", "In memory\\b", "Tips\\b", "Video\\b", "Thanks\\b",
    "First posted\\b", "Strategy\\b", "Honor\\b", "To learn\\b", "Watch\\b", "Read\\b", "Download\\b", "Photo\\b",
    "Today's\\b", "Today’s\\b", "This (?:workout|Hero|is)\\b", "Use the\\b", "Go to\\b", "See\\b", "Click\\b",
    "It's expected\\b", "Submit\\b", "Share\\b", "Report\\b", "Can you beat\\b", "Scale\\b", "For a downloadable\\b",
    "Guest Programmer\\b", "Part [A-Z]: [A-Z][a-z]+ [A-Z]", "CrossFit Games Open [\\d.]+ workout instructions",
  ].join("|") + ")",
  "i",
);
/** A rule of dashes or bullets: the page furniture below the workout. */
const END_AT_RULE = /^\s*(?:-{3,}|_{3,}|•|\*{3,})/;
/** These end the workout wherever they appear, even mid-line. */
const END_INLINE = /\s*(?:(?:Post|Submit|Share|Report)\b[^\n.]{0,90}?to (?:the )?\[?comments|Compare (?:to|results|your)\b|Scroll for scaling|Can you beat\b|Scale as needed)/i;
/** "In honor of X" before the workout: the dedication goes, the workout stays. */
const DEDICATION = /^\s*In (?:honor|memory) of\b[^\n]*\n/i;
/** A line of other people's results: two or more clock times after names. */
const RESULTS_LINE = /[A-Z][a-z]+ [A-Z][A-Za-z.'-]+[^\n]{0,12}\d{1,2}:\d{2}.*\d{1,2}:\d{2}/;
/** An italic paragraph (a tribute) or an italic date line. */
const ITALIC_LINE = /^\s*_.+_?\s*$/;

function stripMarkup(s: string): string {
  return s
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1") // html links
    .replace(/<[^>]+>/g, "") // any other tag
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1") // markdown links
    .replace(/\[\s*(?:wmv|mov|HD mov|video|mp4)\s*\]/gi, "") // leftover video tags
    .replace(/\*\*|__/g, "") // bold
    .replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,:;]|$)/g, "$1$2") // italics
    .replace(/\[\s*\]/g, "") // an emptied link
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ");
}

/** A first line that is only a name: bold, quoted, or a linked title. */
function nameOf(rawFirstLine: string): string | null {
  const t = rawFirstLine.trim();
  const bold = t.match(/^["“]?\*\*(.+?)\*\*["”]?[.:]?$/);
  if (bold) return stripMarkup(bold[1]).trim() || null;
  const linked = t.match(/^\[([^\]]+)\]\([^)]*\)[.:]?$/);
  if (linked) return stripMarkup(linked[1]).trim() || null;
  const quoted = t.match(/^["“]([^"”]{2,40})["”][.:]?$/);
  if (quoted) return quoted[1].trim();
  return null;
}

/**
 * Clean one entry. Null when it is not a metcon, has no workout text, or
 * nothing usable is left. Pure.
 */
export function cleanMainsiteWorkout(content: string): CleanedWorkout | null {
  const src = content ?? "";
  const kind = (src.match(/^Category:\s*(.+)$/m)?.[1] ?? "").trim();
  if (!(METCON_KINDS as readonly string[]).includes(kind)) return null;
  const at = src.indexOf("WOD:");
  if (at < 0) return null;
  let body = src.slice(at + 4).replace(/\u00a0/g, " ");
  body = body.replace(DEDICATION, "");
  // Links can run over several lines, so they are flattened before the text is split.
  body = body
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1");
  // A "Guest Programmer" banner and the rule under it sit above the workout.
  body = body.replace(/^\s*Guest Programmer\b[^\n]*\n(?:\s*[*_-]{3,}\s*\n)?/i, "");

  // Anything after an inline ending ("… Post time to comments.") goes.
  const inline = body.search(END_INLINE);
  if (inline >= 0) body = body.slice(0, inline);

  const rawLines = body.split("\n");
  const firstRaw = rawLines.find((l) => l.trim() !== "") ?? "";
  const name = nameOf(firstRaw);

  const kept: string[] = [];
  let seenWork = false;
  for (const raw of rawLines) {
    const line = stripMarkup(raw).trim();
    if (line === "") { if (kept.length && kept[kept.length - 1] !== "") kept.push(""); continue; }
    // The name line is kept as the first line; the rules below apply after it.
    const isNameLine = !seenWork && name != null && raw === firstRaw;
    // An italic line is a date or a tribute: a short one is skipped, a long one ends the workout.
    if (ITALIC_LINE.test(raw.trim())) { if (raw.trim().length > 80) break; continue; }
    if (seenWork && RESULTS_LINE.test(line)) break;
    if (!isNameLine && (END_AT_RULE.test(raw) || END_AT_LINE.test(line))) {
      // Page furniture ABOVE the workout (a "Guest Programmer" line) is skipped, not an ending.
      if (!seenWork || (kept.length <= 1 && name != null)) { if (/^Guest Programmer\b/i.test(line)) continue; }
      break;
    }
    kept.push(line);
    seenWork = true;
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // A name alone, or nothing, is not a workout.
  const withoutName = name && text.startsWith(name) ? text.slice(name.length).trim() : text;
  if (withoutName.length < 6) return null;

  const date = src.match(/^Date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  return { date, kind, name, text };
}
