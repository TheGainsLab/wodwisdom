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
      {blocks.map((b, i) => (
        <div key={i} className="workout-block">
          <div className="workout-block-label">{b.label}</div>
          <div className="workout-block-content">{b.content}</div>
        </div>
      ))}
    </div>
  );
}
