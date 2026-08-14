/**
 * What the corpus actually contains.
 *
 *   node scripts/corpus/report.mjs
 *
 * Deliberately independent of AgenticSchema. This scans the pages directly, so
 * it answers "what is on these pages" rather than "what does the library make of
 * them". The second question belongs to the corpus test, and answering both with
 * the same code would let a bug in the pipeline hide itself in the statistics.
 *
 * The number that matters most is how many pages carry nothing but furniture —
 * a WebSite, an Organization, a BreadcrumbList. Curating by vertical does not
 * guarantee markup, and a corpus that quietly excluded those pages would be
 * measuring the ceiling twice over.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(ROOT, 'corpus', 'corpus.lock.json');
const OUT = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'local');

/** Types that describe the page's chrome rather than its subject. */
const FURNITURE = new Set([
  'WebSite',
  'WebPage',
  'Organization',
  'BreadcrumbList',
  'ListItem',
  'SiteNavigationElement',
  'CollectionPage',
  'ItemList',
  'ImageObject',
  'SearchAction',
  'ReadAction',
]);

const LD_JSON = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Every `@type` in a blob, however deeply it is buried and however it is spelled. */
function typesIn(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) typesIn(item, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, inner] of Object.entries(value)) {
    if (key === '@type') {
      for (const t of Array.isArray(inner) ? inner : [inner]) {
        if (typeof t === 'string') found.add(t.replace(/^.*[/#:]/, ''));
      }
    } else {
      typesIn(inner, found);
    }
  }
  return found;
}

const pad = (s, n) => String(s).padEnd(n);
const bar = (n, max, width = 24) => '█'.repeat(Math.max(1, Math.round((n / max) * width)));

// ---------------------------------------------------------------------------

const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
const rows = [];

for (const page of lock.pages) {
  let html;
  try {
    html = readFileSync(join(OUT, page.file), 'utf8');
  } catch {
    rows.push({ ...page, missing: true, types: new Set(), blocks: 0, broken: 0 });
    continue;
  }

  const blocks = [...html.matchAll(LD_JSON)].map((m) => m[1].trim());
  const types = new Set();
  let broken = 0;
  for (const block of blocks) {
    try {
      typesIn(JSON.parse(block), types);
    } catch {
      broken += 1;
    }
  }

  rows.push({
    ...page,
    types,
    blocks: blocks.length,
    broken,
    microdata: (html.match(/itemscope/g) ?? []).length,
    rdfa: (html.match(/\btypeof=/g) ?? []).length,
  });
}

const present = rows.filter((r) => !r.missing);
const substantive = present.filter((r) => [...r.types].some((t) => !FURNITURE.has(t)));
const furnitureOnly = present.filter(
  (r) => r.types.size > 0 && ![...r.types].some((t) => !FURNITURE.has(t))
);
// Counted on their own, and counted out loud. The type census below reads
// JSON-LD only, so a page carrying its data as microdata or RDFa contributes no
// types and would otherwise vanish from every bucket: present in the total,
// absent from the breakdown, and the arithmetic silently short. Wikipedia is
// the whole of this group in the current corpus.
const otherSyntaxOnly = present.filter((r) => r.types.size === 0 && (r.microdata || r.rdfa));
const nothing = present.filter((r) => r.types.size === 0 && !r.microdata && !r.rdfa);

const bytes = present.reduce((sum, r) => sum + r.bytes, 0);
const sizes = present.map((r) => r.bytes).sort((a, b) => a - b);
const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

console.log(`\nCORPUS  ${lock.crawl}, raccolto il ${lock.fetchedAt}\n${'─'.repeat(64)}`);
console.log(`${pad('pagine', 34)} ${present.length}`);
console.log(`${pad('peso totale', 34)} ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`${pad('peso mediano di una pagina', 34)} ${Math.round(median / 1024)} KB`);
console.log(`${pad('con un tipo che non sia arredamento', 34)} ${substantive.length}`);
console.log(`${pad('solo arredamento', 34)} ${furnitureOnly.length}`);
console.log(`${pad('solo microdata o rdfa, niente json-ld', 34)} ${otherSyntaxOnly.length}`);
console.log(`${pad('nessun dato strutturato', 34)} ${nothing.length}`);
const counted = substantive.length + furnitureOnly.length + otherSyntaxOnly.length + nothing.length;
if (counted !== present.length) {
  console.log(`${pad('NON CLASSIFICATE', 34)} ${present.length - counted}`);
}
console.log(`${pad('blocchi ld+json illeggibili', 34)} ${present.reduce((s, r) => s + r.broken, 0)}`);
console.log(`${pad('pagine con microdata', 34)} ${present.filter((r) => r.microdata).length}`);
console.log(`${pad('pagine con rdfa', 34)} ${present.filter((r) => r.rdfa).length}`);
if (rows.length !== present.length) {
  console.log(`${pad('file mancanti sul disco', 34)} ${rows.length - present.length}`);
}

console.log(`\nPER VERTICALE\n${'─'.repeat(64)}`);
const byVertical = new Map();
for (const row of present) {
  const bucket = byVertical.get(row.vertical) ?? { pages: 0, bytes: 0, thin: 0 };
  bucket.pages += 1;
  bucket.bytes += row.bytes;
  if (![...row.types].some((t) => !FURNITURE.has(t))) bucket.thin += 1;
  byVertical.set(row.vertical, bucket);
}
for (const [vertical, b] of [...byVertical].sort()) {
  const thin = b.thin ? `, ${b.thin} senza un tipo utile` : '';
  console.log(
    `${pad(vertical, 12)} ${pad(`${b.pages} pagine`, 12)} ${pad(
      `${Math.round(b.bytes / b.pages / 1024)} KB medi`,
      14
    )}${thin}`
  );
}

console.log(`\nTIPI TROVATI\n${'─'.repeat(64)}`);
const counts = new Map();
for (const row of present) {
  for (const type of row.types) counts.set(type, (counts.get(type) ?? 0) + 1);
}
const ranked = [...counts].sort((a, b) => b[1] - a[1]);
const max = ranked[0]?.[1] ?? 1;
for (const [type, n] of ranked.slice(0, 30)) {
  const mark = FURNITURE.has(type) ? ' ·' : '  ';
  console.log(`${mark}${pad(type, 26)} ${pad(n, 5)} ${bar(n, max)}`);
}
if (ranked.length > 30) console.log(`  … e altri ${ranked.length - 30} tipi`);
console.log('\n  · = arredamento della pagina, non il suo soggetto\n');

if (lock.failures.length) {
  console.log(`FALLIMENTI DI RACCOLTA\n${'─'.repeat(64)}`);
  const byReason = new Map();
  for (const f of lock.failures) {
    const key = `${f.stage}: ${f.reason}`;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(n, 5)} ${reason}`);
  }
  console.log();
}
