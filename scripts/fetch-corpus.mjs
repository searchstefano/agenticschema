/**
 * Refreshes the test corpus from real public pages.
 *
 *   node scripts/fetch-corpus.mjs
 *
 * Only the JSON-LD is saved, never the page: that is the public metadata the
 * tests need, it stays small, and it can be read in review. Output lands in
 * `fixtures/local/`, which is untracked, because a site's JSON-LD is that site's
 * content and this repo has no business redistributing it.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'packages/core/test/fixtures/local';

/** Picked for the variety of types they carry, not for their traffic. */
const PAGES = [
  ['wikipedia', 'https://en.wikipedia.org/wiki/Backpack'],
  ['bbc', 'https://www.bbc.com/news'],
  ['recensioni', 'https://www.rottentomatoes.com/m/dune_part_two'],
];

const LD_JSON = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

for (const [name, url] of PAGES) {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 agenticschema-corpus', accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.warn(`${name}: HTTP ${response.status}, skipped`);
      continue;
    }
    const html = await response.text();
    const blocks = [...html.matchAll(LD_JSON)].map((m) => m[1].trim());
    if (blocks.length === 0) {
      console.warn(`${name}: no ld+json, skipped`);
      continue;
    }

    const parsed = blocks.map((b) => {
      try {
        return JSON.parse(b);
      } catch {
        // A broken block is valuable corpus material, so it is kept exactly as found.
        return { __nonParsabile: b.slice(0, 400) };
      }
    });

    const file = join(OUT, `${name}.jsonld.json`);
    writeFileSync(file, `${JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2)}\n`);
    console.log(`${name}: ${blocks.length} blocks -> ${file}`);
  } catch (err) {
    console.warn(`${name}: ${err.message}, skipped`);
  }
}
