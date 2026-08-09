/**
 * Fa fallire la CI se il payload iniziale del tag script supera il budget.
 *
 * "Leggero" era la premessa del progetto: senza un test che la difenda, la
 * prima dipendenza comoda la fa evaporare senza che nessuno se ne accorga.
 *
 * Si misura solo ciò che il browser scarica PRIMA di poter registrare i tool:
 * l'entry e i chunk che importa staticamente. I profili e il polyfill sono
 * dietro `import()` dinamico e arrivano dopo, quindi non contano.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BUDGET_BYTES = 8 * 1024;
const CDN_DIR = 'packages/browser/dist/cdn';
const ENTRY = join(CDN_DIR, 'auto.js');

if (!existsSync(ENTRY)) {
  console.error(`${ENTRY} non esiste: lanciare prima "npm run build".`);
  process.exit(1);
}

/** Import statici, ricorsivamente. `import(...)` dinamico è escluso di proposito. */
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

console.log('payload iniziale:');
for (const f of initial) console.log(`  ${f.padEnd(42)} ${String(gzip(f)).padStart(6)} B gzip`);
console.log('caricato dopo (import dinamico):');
for (const f of lazy) console.log(`  ${f.padEnd(42)} ${String(gzip(f)).padStart(6)} B gzip`);

console.log(`\niniziale ${initialBytes} B / budget ${BUDGET_BYTES} B  (lazy: ${lazyBytes} B)`);

if (initialBytes > BUDGET_BYTES) {
  console.error(`\nBUDGET SFORATO di ${initialBytes - BUDGET_BYTES} byte gzip.`);
  process.exit(1);
}
console.log(`OK: ${BUDGET_BYTES - initialBytes} byte di margine.`);
