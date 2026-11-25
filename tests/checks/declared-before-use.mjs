/**
 * Nothing new may be used before it is declared.
 *
 * Why (2026-11-25): a piece of page state was declared below a function that
 * read it, and that function ran as soon as the page opened. The page crashed
 * for every member with an unwritten week. The type check does not catch it.
 *
 * A lint rule finds every "used before it was defined" in src/. Most of the
 * existing ones are harmless (a handler that only runs on a click, a style
 * constant below its component), so they are listed in a baseline. ANY NEW
 * one fails this check: either declare it first, or, if it is truly only
 * used later, add it to the baseline in the same change with a reason.
 *
 *   node tests/checks/declared-before-use.mjs            check
 *   node tests/checks/declared-before-use.mjs --update   rewrite the baseline
 */
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

const BASELINE = new URL('./declared-before-use.baseline.json', import.meta.url);
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false, variables: true, typedefs: false, ignoreTypeReferences: true }] },
  }],
});

const results = await eslint.lintFiles(['src']);
const found = new Set();
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId !== '@typescript-eslint/no-use-before-define') continue;
    const name = /'([^']+)'/.exec(m.message)?.[1] ?? m.message;
    found.add(`${relative(process.cwd(), r.filePath)}::${name}`);
  }
}
const current = [...found].sort();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`baseline written: ${current.length} entries`);
  process.exit(0);
}

const baseline = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : []);
const fresh = current.filter((k) => !baseline.has(k));
if (fresh.length > 0) {
  console.error('USED BEFORE IT IS DECLARED (new):');
  for (const k of fresh) console.error('  ' + k.replace('::', '  →  '));
  console.error('\nDeclare it above its first use. If it is only ever used later (a click handler, an effect),');
  console.error('add it to tests/checks/declared-before-use.baseline.json in this change and say why in the PR.');
  process.exit(1);
}
console.log(`declared-before-use: ok (${current.length} known, 0 new)`);
