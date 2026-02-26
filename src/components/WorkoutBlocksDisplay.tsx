/**
 * Renders workout text split into delineated blocks (Warm-up, Skills, Strength, Metcon, Cool down).
 * Falls back to raw text if parsing fails or format doesn't match.
 */

const BLOCK_LABELS = ['Warm-up', 'Skills', 'Strength', 'Metcon', 'Cool down'] as const;

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
 * Parse Skills block content into a header (e.g. "4 sets") and bullet items.
 * Returns null if the content already has newlines (let existing logic handle it).
 */
function parseSkillsContent(content: string): { header: string | null; items: string[] } | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) return null; // already multi-line, existing rendering is fine

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
                <div className="workout-block-label">{b.label}</div>
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

        const lines = b.content.split('\n').map(l => l.trim()).filter(Boolean);
        return (
          <div key={i} className="workout-block">
            <div className="workout-block-label">{b.label}</div>
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
