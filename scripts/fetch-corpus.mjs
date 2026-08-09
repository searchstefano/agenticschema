/**
 * Rigenera il corpus di test da pagine pubbliche reali.
 *
 *   node scripts/fetch-corpus.mjs
 *
 * Si salva solo il JSON-LD, non la pagina: è il metadato pubblico che serve al
 * test, pesa poco ed è leggibile in review. Le fixture sono committate perché la
 * suite non deve dipendere dalla rete né dal fatto che un sito cambi markup.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'packages/core/test/fixtures/local';

/** Scelte per varietà di tipi, non per popolarità. */
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
      console.warn(`${name}: HTTP ${response.status}, saltato`);
      continue;
    }
    const html = await response.text();
    const blocks = [...html.matchAll(LD_JSON)].map((m) => m[1].trim());
    if (blocks.length === 0) {
      console.warn(`${name}: nessun ld+json, saltato`);
      continue;
    }

    const parsed = blocks.map((b) => {
      try {
        return JSON.parse(b);
      } catch {
        // Un blocco rotto è dato prezioso per il corpus: si conserva com'è.
        return { __nonParsabile: b.slice(0, 400) };
      }
    });

    const file = join(OUT, `${name}.jsonld.json`);
    writeFileSync(file, `${JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2)}\n`);
    console.log(`${name}: ${blocks.length} blocchi -> ${file}`);
  } catch (err) {
    console.warn(`${name}: ${err.message}, saltato`);
  }
}
