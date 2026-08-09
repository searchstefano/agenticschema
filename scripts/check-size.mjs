/**
 * Two promises about the script-tag build, both checked against the built file
 * rather than the source. 0.1.1 shipped with neither holding, and neither was
 * visible from the TypeScript.
 *
 * 1. Every import in it resolves in a browser. A bare specifier has no resolver
 *    behind it without an import map, and a dynamic import built from a variable
 *    cannot be bundled at all because esbuild cannot see through it. Either one
 *    throws at runtime, gets swallowed, and leaves the adapter registering
 *    nothing at all.
 *
 * 2. It stays inside the size budget. "Lightweight" was the premise, and without
 *    a test defending it the first convenient dependency makes it untrue. The
 *    budget counts everything the browser downloads before the first tool can be
 *    registered, which is the whole directory: the profiles are needed on every
 *    single mapping, so splitting them out never deferred anything.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Measured at 26.9 KB after 0.1.2 folded the polyfill in, which is where most of
 * it goes: `@mcp-b/webmcp-polyfill` validates tool inputs through
 * `@cfworker/json-schema`. The headroom is for dependency bumps, not for new
 * features — if a change needs more than this, the number is the conversation.
 */
const BUDGET_BYTES = 30 * 1024;
const CDN_DIR = 'packages/browser/dist/cdn';
const ENTRY = join(CDN_DIR, 'auto.js');

if (!existsSync(ENTRY)) {
  console.error(`${ENTRY} is missing. Run "npm run build" first.`);
  process.exit(1);
}

const files = readdirSync(CDN_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(CDN_DIR, f));

// ---------------------------------------------------------------------------
// 1. Everything the bundle imports has to be reachable from a browser
// ---------------------------------------------------------------------------

/** `import x from "spec"`, `import "spec"`, `export ... from "spec"`. */
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;
/** `import(...)`, whatever the argument turns out to be. `import.meta` does not match. */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*([^)]*?)\s*\)/g;

const problems = [];

/** A specifier only resolves in a browser if it is relative and actually shipped. */
function checkSpecifier(file, spec, kind) {
  if (!spec.startsWith('.')) {
    problems.push(
      `${file}: ${kind} of bare specifier ${JSON.stringify(spec)} — a browser has no ` +
        `resolver for it. Bundle the dependency, or the import throws at runtime.`
    );
    return;
  }
  const target = join(CDN_DIR, basename(spec));
  if (!existsSync(target)) {
    problems.push(`${file}: ${kind} of ${JSON.stringify(spec)}, which is not in ${CDN_DIR}.`);
  }
}

for (const file of files) {
  const code = readFileSync(file, 'utf8');

  for (const [, spec] of code.matchAll(STATIC_IMPORT)) {
    checkSpecifier(file, spec, 'static import');
  }

  for (const [, arg] of code.matchAll(DYNAMIC_IMPORT)) {
    const literal = /^(["'])(.*)\1$/.exec(arg);
    if (!literal) {
      problems.push(
        `${file}: dynamic import(${arg}) is built from an expression, so esbuild left it ` +
          `unbundled. Pass the specifier as a string literal.`
      );
      continue;
    }
    checkSpecifier(file, literal[2], 'dynamic import');
  }
}

// The chunk graph is only correct when the entry is served from its real path.
// Relative imports resolve against the URL the module was loaded from, and the
// short CDN URL (/npm/@agenticschema/browser) is one directory short of it.
const relativeChunks = files.filter((f) => f !== ENTRY);
if (relativeChunks.length > 0) {
  problems.push(
    `${CDN_DIR} holds ${relativeChunks.length} file(s) besides the entry ` +
      `(${relativeChunks.map((f) => basename(f)).join(', ')}). The script-tag build has to be a ` +
      `single ` +
      `file: relative chunk imports break on the short CDN URL, which resolves them one ` +
      `directory too high.`
  );
}

if (problems.length > 0) {
  console.error('UNRESOLVABLE IMPORTS in the script-tag build:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Size budget
// ---------------------------------------------------------------------------

const gzip = (file) => gzipSync(readFileSync(file)).length;
const total = files.reduce((n, f) => n + gzip(f), 0);

console.log('downloaded before the first tool registers:');
for (const f of files) console.log(`  ${f.padEnd(42)} ${String(gzip(f)).padStart(6)} B gzip`);
console.log(`\ntotal ${total} B / budget ${BUDGET_BYTES} B`);

if (total > BUDGET_BYTES) {
  console.error(`\nOVER BUDGET by ${total - BUDGET_BYTES} gzipped bytes.`);
  process.exit(1);
}
console.log(`OK: ${BUDGET_BYTES - total} bytes to spare.`);
