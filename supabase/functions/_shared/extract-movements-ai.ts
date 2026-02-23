// AI-powered movement extraction for CrossFit workout text.
// Replaces regex extraction when accuracy matters (e.g. program analysis).
// Result is keyed by workout_id — never trust array order from Claude.

export interface LibraryEntry {
  canonical_name: string;
  display_name: string;
  modality: string;
  aliases: string[];
}

export interface WorkoutForExtraction {
  id: string;
  workout_text: string;
}

export interface ExtractedMovement {
  canonical: string;
  modality: string;
  load: string;
}

const SYSTEM_PROMPT = `You are a CrossFit workout parser. Your job is to extract movements from workout text.

For each workout, identify every distinct movement and return:
- canonical: the canonical name from the provided movement library (use exact spelling)
- modality: W (Weightlifting), G (Gymnastics), or M (Monostructural) — use the library's classification
- load: the prescribed weight or percentage if present (e.g. "135", "95/65", "@75%"), or "BW" if bodyweight

Rules:
- Match movements to the canonical names in the library. Use aliases to resolve abbreviations (e.g. "T2B" = "toes_to_bar", "DU" = "double_under", "Sq Clns" = "squat_clean").
- If a movement appears multiple times in the same workout (e.g. in a rep scheme like 21-15-9), count it once.
- If a movement is not in the library, still extract it with your best canonical name and classification.
- "Cal Row", "Row Cal", "Rowing Calories", "Row" all map to "row".
- Compound movements like "Burpee Box Jump Over" are a single movement, not two.
- Ignore rep counts, round counts, and time caps — extract only movements.

Return JSON only. No preamble, no markdown, no explanation.`;

function buildUserPrompt(
  workouts: WorkoutForExtraction[],
  library: LibraryEntry[]
): string {
  const libraryJson = JSON.stringify(
    library.map((e) => ({
      canonical_name: e.canonical_name,
      display_name: e.display_name,
      modality: e.modality,
      aliases: e.aliases,
    })),
    null,
    0
  );
  const workoutsJson = JSON.stringify(
    workouts.map((w) => ({ id: w.id, workout_text: w.workout_text })),
    null,
    0
  );
  return `Movement library:
${libraryJson}

Workouts to extract:
${workoutsJson}

For each workout, return the extracted movements. Format:
[
  {
    "workout_id": "...",
    "movements": [
      { "canonical": "...", "modality": "W" | "G" | "M", "load": "..." }
    ]
  }
]`;
}

/**
 * Filter out movements whose canonical is not in the library.
 * Returns filtered list and array of unrecognized canonicals.
 */
function validateAgainstLibrary(
  movements: ExtractedMovement[],
  libraryCanonicals: Set<string>
): { valid: ExtractedMovement[]; unrecognized: string[] } {
  const valid: ExtractedMovement[] = [];
  const unrecognized: string[] = [];
  for (const m of movements) {
    if (libraryCanonicals.has(m.canonical)) {
      valid.push(m);
    } else {
      if (!unrecognized.includes(m.canonical)) {
        unrecognized.push(m.canonical);
      }
    }
  }
  return { valid, unrecognized };
}

export interface ExtractionResult {
  movements: ExtractedMovement[][];
  notices: string[];
}

/**
 * Extract movements from workouts via Claude.
 * Returns { movements, notices } where movements is aligned by workout index (matched by workout_id).
 * Returns null on failure (caller should fall back to regex).
 */
export async function extractMovementsAI(
  workouts: WorkoutForExtraction[],
  library: LibraryEntry[],
  apiKey: string
): Promise<ExtractionResult | null> {
  if (workouts.length === 0) return { movements: [], notices: [] };
  if (library.length === 0) return null;

  const libraryCanonicals = new Set(library.map((e) => e.canonical_name));
  const userPrompt = buildUserPrompt(workouts, library);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      stream: false,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("extractMovementsAI API error:", err);
    return null;
  }

  const data = await resp.json();
  const rawText =
    data.content?.[0]?.text?.trim() || data.content?.[0]?.input?.trim() || "";

  let parsed: { workout_id: string; movements: { canonical: string; modality: string; load: string }[] }[];
  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
    parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      console.error("extractMovementsAI: response is not an array");
      return null;
    }
  } catch (e) {
    console.error("extractMovementsAI: failed to parse JSON", e);
    return null;
  }

  const notices: string[] = [];
  const allUnrecognized = new Set<string>();
  const byId = new Map<string, ExtractedMovement[]>();

  for (const item of parsed) {
    if (!item.workout_id || !Array.isArray(item.movements)) continue;

    const validated = item.movements
      .filter(
        (m: { canonical?: unknown; modality?: unknown }) =>
          typeof m.canonical === "string" && typeof m.modality === "string"
      )
      .map((m: { canonical: string; modality: string; load?: string }) => ({
        canonical: m.canonical,
        modality: m.modality,
        load: (m.load?.trim() || "") ? m.load.trim() : "BW",
      }));

    const { valid, unrecognized } = validateAgainstLibrary(validated, libraryCanonicals);
    byId.set(item.workout_id, valid);
    for (const c of unrecognized) allUnrecognized.add(c);
  }

  if (allUnrecognized.size > 0) {
    notices.push(
      `Unrecognized movements excluded from analysis: ${[...allUnrecognized].join(", ")}`
    );
  }

  const result: ExtractedMovement[][] = [];
  for (const w of workouts) {
    result.push(byId.get(w.id) ?? []);
  }

  return { movements: result, notices };
}
