/**
 * Fails the build when the initial script-tag payload goes over budget.
 *
 * "Lightweight" was the premise of the project. Without a test defending it, the
 * first convenient dependency makes it quietly untrue.
 *
 * Only what the browser downloads BEFORE it can register any tool counts here:
 * the entry and the chunks it imports statically. Profiles and the polyfill sit
 * behind a dynamic `import()` and arrive later, so they are excluded.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BUDGET_BYTES = 8 * 1024;
const CDN_DIR = 'packages/browser/dist/cdn';
const ENTRY = join(CDN_DIR, 'auto.js');

if (!existsSync(ENTRY)) {
  console.error(`${ENTRY} is missing. Run "npm run build" first.`);
  process.exit(1);
}

/** Static imports, followed recursively. Dynamic `import(...)` is excluded on purpose. */
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;

function collectStatic(entry, seen = new Set()) {
  if (seen.has(entry) || !existsSync(entry)) return seen;
  seen.add(entry);
  const code = readFileSync(entry, 'utf8');
  for (const match of code.matchAll(STATIC_IMPORT)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    collectStatic(join(dirname(entry), spec), seen);
  }
  return seen;
}

const initial = [...collectStatic(ENTRY)];
const all = readdirSync(CDN_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(CDN_DIR, f));
const lazy = all.filter((f) => !initial.includes(f));

const gzip = (file) => gzipSync(readFileSync(file)).length;
const total = (files) => files.reduce((n, f) => n + gzip(f), 0);

const initialBytes = total(initial);
const lazyBytes = total(lazy);

console.log('initial payload:');
for (const f of initial) console.log(`  ${f.padEnd(42)} ${String(gzip(f)).padStart(6)} B gzip`);
console.log('loaded later, on dynamic import:');
for (const f of lazy) console.log(`  ${f.padEnd(42)} ${String(gzip(f)).padStart(6)} B gzip`);

console.log(`\ninitial ${initialBytes} B / budget ${BUDGET_BYTES} B  (lazy: ${lazyBytes} B)`);

if (initialBytes > BUDGET_BYTES) {
  console.error(`\nOVER BUDGET by ${initialBytes - BUDGET_BYTES} gzipped bytes.`);
  process.exit(1);
}
console.log(`OK: ${BUDGET_BYTES - initialBytes} bytes to spare.`);
