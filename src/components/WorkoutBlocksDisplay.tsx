/**
 * Renders workout text split into delineated blocks (Warm-up, Skills, Strength, Metcon, Cool down).
 * Falls back to raw text if parsing fails or format doesn't match.
 */

const BLOCK_LABELS = ['Warm-up', 'Skills', 'Strength', 'Metcon', 'Cool down'] as const;

function blockDataAttr(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

interface ParsedBlock {
  label: string;
  content: string;
}

function parseWorkoutBlocks(text: string): ParsedBlock[] | null {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const blocks: ParsedBlock[] = [];
  const labelsToFind = BLOCK_LABELS.map((l) => ({
    label: l,
    needle: (l + ':').toLowerCase(),
  }));

  for (let i = 0; i < labelsToFind.length; i++) {
    const { label, needle } = labelsToFind[i];
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    const next = labelsToFind.slice(i + 1).find((x) => {
      const idx = lower.indexOf(x.needle, contentStart);
      return idx >= 0;
    });
    const end = next ? lower.indexOf(next.needle, contentStart) : text.length;
    const content = text.slice(contentStart, end).trim();
    blocks.push({ label, content });
  }

  if (blocks.length === 0) return null;
  return blocks;
}

/** Split on commas that aren't inside parentheses. */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * Parse any single-line block content into a header and bullet items.
 * Detects common workout formats (AMRAP, For Time, Rounds, Every X min, Tabata, etc.)
 * and splits comma-separated movements onto separate lines.
 * Returns null if content is already multi-line or cannot be meaningfully split.
 */
function parseBlockContent(content: string): { header: string | null; items: string[] } | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) return null; // already multi-line

  // Detect format headers: "3 Rounds For Time:", "AMRAP 12 min:", "21-15-9:", "Every 3 min x 5:", "Tabata:", etc.
  const headerPatterns = [
    /^(\d+\s+rounds?\s+for\s+time\b[^,]*?)[:,]\s*/i,
    /^(for\s+time\b[^,]*?)[:,]\s*/i,
    /^(AMRAP\s+\d+\s*(?:min(?:utes?)?)?[^,]*?)[:,]\s*/i,
    /^(E\d*MOM\s+\d+\s*(?:min(?:utes?)?)?[^,]*?)[:,]\s*/i,
    /^(every\s+\d+\s*(?:min(?:utes?)?|sec(?:onds?)?)\s*(?:x\s*\d+)?[^,]*?)[:,]\s*/i,
    /^(tabata\b[^,]*?)[:,]\s*/i,
    /^(\d+(?:[–-]\d+)+\b[^,]*?)[:,]\s*/i,  // e.g. "21-15-9:"
    /^(\d+\s*[×x]\s*\d+\b[^,]*?)[:,]\s*/i, // e.g. "5×3 Back Squat"
  ];

  let header: string | null = null;
  let remainder = content;

  for (const pat of headerPatterns) {
    const m = content.match(pat);
    if (m) {
      header = m[1].trim();
      remainder = content.slice(m[0].length).trim();
      break;
    }
  }

  const items = splitTopLevelCommas(remainder);
  if (items.length < 2 && !header) return null; // nothing to restructure

  return { header, items };
}

/**
 * Parse Skills block content into a header (e.g. "4 sets") and bullet items.
 * Returns null if the content already has newlines (let existing logic handle it).
 */
function parseSkillsContent(content: string): { header: string | null; items: string[] } | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length > 1) return null; // multi-line content — render as-is

  // Detect "N sets" prefix
  const setsMatch = content.match(/^(\d+\s+sets?)\b\s*/i);
  let header: string | null = null;
  let remainder = content;

  if (setsMatch) {
    header = setsMatch[1];
    remainder = content.slice(setsMatch[0].length);
  }

  const items = splitTopLevelCommas(remainder);
  if (items.length < 2 && !header) return null; // single item, no header — nothing to restructure

  return { header, items };
}

/**
 * Renders a single block's content with the same formatting used in WorkoutBlocksDisplay.
 * Useful when blocks are already separated (e.g. on the Start Workout page).
 */
export function BlockContent({ label, content }: { label: string; content: string }) {
  // Skills blocks: specialised EMOM / sets parsing
  if (label === 'Skills') {
    const parsed = parseSkillsContent(content);
    if (parsed) {
      return (
        <>
          {parsed.header && <div>{parsed.header}:</div>}
          <ul className="workout-block-lines">
            {parsed.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </>
      );
    }
  }

  // All blocks: split single-line content with detected format headers
  const generalParsed = parseBlockContent(content);
  if (generalParsed) {
    return (
      <>
        {generalParsed.header && <div>{generalParsed.header}:</div>}
        <ul className="workout-block-lines">
          {generalParsed.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      </>
    );
  }

  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return (
      <ul className="workout-block-lines">
        {lines.map((line, j) => (
          <li key={j}>{line}</li>
        ))}
      </ul>
    );
  }

  return <span>{content}</span>;
}

interface WorkoutBlocksDisplayProps {
  text: string;
  className?: string;
}

export default function WorkoutBlocksDisplay({ text, className = '' }: WorkoutBlocksDisplayProps) {
  const blocks = parseWorkoutBlocks(text);

  if (!blocks) {
    return (
      <div className={`workout-blocks-fallback ${className}`.trim()}>
        {text}
      </div>
    );
  }

  return (
    <div className={`workout-blocks ${className}`.trim()}>
      {blocks.map((b, i) => {
        // Skills blocks: parse "N sets" header + comma-separated movements
        if (b.label === 'Skills') {
          const parsed = parseSkillsContent(b.content);
          if (parsed) {
            return (
              <div key={i} className="workout-block">
                <div className="workout-block-label" data-block={blockDataAttr(b.label)}>{b.label}</div>
                <div className="workout-block-content">
                  {parsed.header && <div>{parsed.header}:</div>}
                  <ul className="workout-block-lines">
                    {parsed.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          }
        }

        // All blocks: try general single-line parsing (format header + comma split)
        const generalParsed = parseBlockContent(b.content);
        if (generalParsed) {
          return (
            <div key={i} className="workout-block">
              <div className="workout-block-label" data-block={blockDataAttr(b.label)}>{b.label}</div>
              <div className="workout-block-content">
                {generalParsed.header && <div>{generalParsed.header}:</div>}
                <ul className="workout-block-lines">
                  {generalParsed.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        }

        const lines = b.content.split('\n').map(l => l.trim()).filter(Boolean);
        return (
          <div key={i} className="workout-block">
            <div className="workout-block-label" data-block={blockDataAttr(b.label)}>{b.label}</div>
            <div className="workout-block-content">
              {lines.length > 1 ? (
                <ul className="workout-block-lines">
                  {lines.map((line, j) => (
                    <li key={j}>{line}</li>
                  ))}
                </ul>
              ) : (
                <span>{b.content}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
