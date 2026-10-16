#!/usr/bin/env node
// Regenerates supabase/functions/_shared/knowledge-ingestion-prompt.ts from
// the canonical src/data/knowledge/ingestion-prompt.md. Run after any edit to
// the prompt so the ingest-paper function and the repo contract never drift:
//   node scripts/sync-ingestion-prompt.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(root, "src/data/knowledge/ingestion-prompt.md"), "utf8");
const out = `// GENERATED FILE — do not edit by hand.
// Source of truth: src/data/knowledge/ingestion-prompt.md
// Regenerate with: node scripts/sync-ingestion-prompt.mjs

export const KNOWLEDGE_INGESTION_PROMPT: string = ${JSON.stringify(md)};
`;
writeFileSync(join(root, "supabase/functions/_shared/knowledge-ingestion-prompt.ts"), out);
console.log("knowledge-ingestion-prompt.ts regenerated,", md.length, "chars");
