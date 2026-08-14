/**
 * Builds the local corpus of real pages from Common Crawl.
 *
 *   node scripts/corpus/fetch.mjs [--pages N] [--only <vertical>]
 *
 * Nothing here touches the sites themselves. The URL index says which pages of a
 * domain exist in the snapshot, a range request pulls the exact bytes of one
 * capture out of a WARC, and that is the whole conversation: no crawling, no
 * rate limiting to engineer, no load on anyone but Common Crawl.
 *
 * The pages land in `packages/core/test/fixtures/local/`, which git ignores,
 * because a page is its site's content and this repo has no business
 * redistributing it. What is committed is `corpus/corpus.lock.json`, which
 * records where every page came from precisely enough to fetch the identical
 * bytes again.
 *
 * A page that turns out to carry no structured data is kept. It is not a
 * failure, it is the control case, and dropping those would quietly stack the
 * corpus in the library's favour.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { cdxUrl, parseCdxLines, selectRecords } from './cdx.mjs';
import { parseWarcRecord } from './warc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEEDS = join(ROOT, 'corpus', 'seeds.json');
const LOCK = join(ROOT, 'corpus', 'corpus.lock.json');
const OUT = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'local');
const AGENT = 'agenticschema-corpus (+https://github.com/searchstefano/agenticschema)';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const pagesOverride = Number(flag('--pages')) || undefined;
const onlyVertical = flag('--only');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The index is the flaky half of this. It answers 503 under load and sometimes
 * simply stops answering, often enough that a build without retries produces a
 * corpus shaped by the weather rather than by the seeds.
 */
async function withRetry(label, fn, attempts = 6) {
  let wait = 2000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(`    ${label}: ${err.message} — riprovo tra ${wait / 1000}s`);
      await sleep(wait);
      wait = Math.min(wait * 2, 30_000);
    }
  }
  throw new Error('unreachable');
}

async function captures(crawl, pattern, pages) {
  // More than we need, because `spread` samples across the list and a narrow
  // list samples one corner of the alphabet. Not too many more: a wide query is
  // what makes the index time out.
  const wanted = Math.min(Math.max(pages * 4, 40), 300);
  const response = await fetch(cdxUrl(crawl, pattern, wanted), {
    headers: { 'user-agent': AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  // 404 is the index saying it holds nothing for this pattern. That is an
  // answer, not a failure, and retrying it just wastes everyone's time.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`CDX HTTP ${response.status}`);
  return selectRecords(parseCdxLines(await response.text()), pages);
}

async function warcPage(record) {
  const end = record.offset + record.length - 1;
  const response = await fetch(`https://data.commoncrawl.org/${record.filename}`, {
    headers: { range: `bytes=${record.offset}-${end}`, 'user-agent': AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`WARC HTTP ${response.status}`);
  }
  return parseWarcRecord(gunzipSync(Buffer.from(await response.arrayBuffer())));
}

const used = new Set();
function slugFor(url) {
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
  const tail = pathname.split('/').filter(Boolean).pop() ?? 'index';
  const clean = tail
    .replace(/\.[a-z]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .slice(0, 60);
  const base = `${host}-${clean}`.replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

/** Four at a time against data.commoncrawl.org, which has been happy to take it. */
async function inParallel(items, width, worker) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length) await worker(queue.shift());
    })
  );
}

// ---------------------------------------------------------------------------

const config = JSON.parse(readFileSync(SEEDS, 'utf8'));
const seeds = config.seeds.filter((s) => !onlyVertical || s.vertical === onlyVertical);

const pages = [];
const failures = [];
for (const vertical of new Set(seeds.map((s) => s.vertical))) {
  // Two guards before a recursive delete, because `vertical` comes out of a
  // JSON file and ends up in a path. The shape check rejects the obvious
  // `../..`; the containment check is what actually holds, since it survives
  // any spelling of an escape the first one failed to imagine.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(vertical)) {
    throw new Error(`vertical "${vertical}" is not a plain name: refusing to touch that path`);
  }
  const dir = resolve(OUT, vertical);
  if (dirname(dir) !== resolve(OUT)) {
    throw new Error(`"${vertical}" resolves to ${dir}, outside the corpus directory`);
  }

  // Only the directories this script owns. A `*.jsonld.json` left by the older
  // fetch-corpus script is someone's local state and stays where it is.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

console.log(`crawl ${config.crawl}, ${seeds.length} seed\n`);

for (const seed of seeds) {
  const wanted = pagesOverride ?? seed.pages;
  process.stdout.write(`${seed.vertical.padEnd(10)} ${seed.pattern}\n`);

  let records;
  try {
    records = await withRetry('indice', () => captures(config.crawl, seed.pattern, wanted));
  } catch (err) {
    console.log(`    indice irraggiungibile: ${err.message}\n`);
    failures.push({ pattern: seed.pattern, stage: 'cdx', reason: err.message });
    continue;
  }

  if (records.length === 0) {
    console.log('    nessuna cattura in questo crawl\n');
    failures.push({ pattern: seed.pattern, stage: 'cdx', reason: 'no captures' });
    continue;
  }

  let kept = 0;
  await inParallel(records, 4, async (record) => {
    try {
      const page = await withRetry('warc', () => warcPage(record), 4);
      if (page.status !== 200) throw new Error(`la cattura riporta HTTP ${page.status}`);
      // An interstitial or a challenge weighs a couple of kilobytes and is not
      // the page anyone asked for.
      if (page.html.length < 2000) throw new Error(`solo ${page.html.length} byte, non è la pagina`);

      const file = join(seed.vertical, `${slugFor(record.url)}.html`);
      writeFileSync(join(OUT, file), page.html, 'utf8');
      pages.push({
        vertical: seed.vertical,
        file,
        url: record.url,
        timestamp: record.timestamp,
        warc: record.filename,
        offset: record.offset,
        length: record.length,
        bytes: Buffer.byteLength(page.html, 'utf8'),
        sha256: createHash('sha256').update(page.html).digest('hex').slice(0, 16),
      });
      kept += 1;
    } catch (err) {
      failures.push({ pattern: seed.pattern, stage: 'warc', url: record.url, reason: err.message });
    }
  });

  console.log(`    ${kept}/${records.length} pagine salvate\n`);
}

const bytes = pages.reduce((sum, page) => sum + page.bytes, 0);
console.log(
  `${pages.length} pagine, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${failures.length} fallimenti`
);

// A partial run must not write the lock. The lock describes one coherent build,
// and a `--only` run knows nothing about the verticals it skipped: writing it
// here would erase them from the record while leaving their files on disk.
if (onlyVertical || pagesOverride) {
  console.log('run parziale: il lock non è stato toccato');
} else {
  pages.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(
    LOCK,
    `${JSON.stringify(
      { crawl: config.crawl, fetchedAt: new Date().toISOString().slice(0, 10), pages, failures },
      null,
      2
    )}\n`
  );
  console.log('lock scritto in corpus/corpus.lock.json');
}
