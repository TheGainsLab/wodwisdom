#!/usr/bin/env node
// Regenerates everything derived from the knowledge ingestion contract:
//   1. the chart-shape block inside src/data/knowledge/ingestion-prompt.md
//      (between the chart-shapes markers), from chart-templates.json
//   2. supabase/functions/_shared/knowledge-ingestion-prompt.ts, from the md
//   3. supabase/functions/_shared/knowledge-chart-templates.ts, from the JSON
//      (build.py reads the JSON directly)
// Run after any edit to ingestion-prompt.md or chart-templates.json:
//   node scripts/sync-ingestion-prompt.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = join(root, "src/data/knowledge/ingestion-prompt.md");

// ── 1. chart-shape bullets into the md, between markers ─────────────────
const templates = JSON.parse(readFileSync(join(root, "src/data/knowledge/chart-templates.json"), "utf8"));
delete templates._comment;
const bullets = Object.entries(templates)
  .map(([name, t]) => {
    const example = t.example.length ? `\`${JSON.stringify(t.example)}\`` : "";
    const doc = t.doc ? `${example ? " — " : ""}${t.doc}` : "";
    return `- \`${name}\`: ${example}${doc}`;
  })
  .join("\n");
const START = "<!-- chart-shapes:start — generated from chart-templates.json by scripts/sync-ingestion-prompt.mjs; edit the JSON, not this block -->";
const END = "<!-- chart-shapes:end -->";
let md = readFileSync(mdPath, "utf8");
const a = md.indexOf(START);
const b = md.indexOf(END);
if (a === -1 || b === -1 || b < a) {
  console.error("chart-shapes markers missing or malformed in ingestion-prompt.md");
  process.exit(1);
}
md = md.slice(0, a + START.length) + "\n" + bullets + "\n" + md.slice(b);
writeFileSync(mdPath, md);

// ── 2. the prompt as a TS module for the ingest function ────────────────
writeFileSync(
  join(root, "supabase/functions/_shared/knowledge-ingestion-prompt.ts"),
  `// GENERATED FILE — do not edit by hand.
// Source of truth: src/data/knowledge/ingestion-prompt.md
// Regenerate with: node scripts/sync-ingestion-prompt.mjs

export const KNOWLEDGE_INGESTION_PROMPT: string = ${JSON.stringify(md)};
`,
);

// ── 3. the chart-shape spec as a TS module for the validator ────────────
const spec = Object.fromEntries(
  Object.entries(templates).map(([name, t]) => [name, { shape: t.shape, shape_text: t.shape_text }]),
);
writeFileSync(
  join(root, "supabase/functions/_shared/knowledge-chart-templates.ts"),
  `// GENERATED FILE — do not edit by hand.
// Source of truth: src/data/knowledge/chart-templates.json
// Regenerate with: node scripts/sync-ingestion-prompt.mjs
// shape tokens: 'string' | 'number' | 'any' (key present); a nested array
// means every element matches the inner shape; shape null = not validated.

export interface ChartTemplateSpec {
  shape: Record<string, unknown> | null;
  shape_text: string;
}

export const CHART_TEMPLATES: Record<string, ChartTemplateSpec> = ${JSON.stringify(spec, null, 2)};
`,
);
console.log(
  `synced: md chart-shapes block (${Object.keys(templates).length} templates), ` +
  `knowledge-ingestion-prompt.ts (${md.length} chars), knowledge-chart-templates.ts`,
);
