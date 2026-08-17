/**
 * The pipeline against real pages, fetched from Common Crawl by
 * `npm run corpus:fetch`.
 *
 * Kept out of the default suite by the `.corpus.test.ts` name: these pages are
 * half a megabyte each and happy-dom takes its time with them, while `npm test`
 * has to stay quick enough to run on every save.
 *
 * It lives in `profiles` rather than `core` because it needs both, and profiles
 * already depends on core. The other way round would be a cycle.
 *
 * A page that yields no tools does not fail. Plenty of real pages carry nothing
 * but a BreadcrumbList, and a test that demanded tools everywhere would only be
 * asserting that the corpus was curated to please it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Window } from 'happy-dom';
import { afterAll, describe, expect, it } from 'vitest';
import { toTools, type ToolDescriptor } from '@agenticschema/core';
import { schemaOrgProfiles } from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGES = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'local');
const LOCK = join(ROOT, 'corpus', 'corpus.lock.json');

interface LockPage {
  vertical: string;
  file: string;
  url: string;
  bytes: number;
}

const corpus: LockPage[] = (() => {
  try {
    return (JSON.parse(readFileSync(LOCK, 'utf8')) as { pages: LockPage[] }).pages;
  } catch {
    return [];
  }
})();

/** Constraints MCP clients actually enforce on tool names. */
const MCP_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * happy-dom reaches out to the network by default, and on real pages that is not
 * a trickle. The corpus references 3,269 stylesheets across its 177 pages, and
 * with `disableCSSFileLoading` left at its default every run fetched all of them
 * from ikea.com, aljazeera.com, marmiton.org and the rest — thousands of live
 * requests against the very sites this corpus exists to avoid touching. Reading
 * pages out of Common Crawl bought nothing while the DOM went out of the back
 * door.
 *
 * So everything a page can reach for is off, and the timer bounds are set too:
 * inline scripts are not evaluated today, but nothing about that is guaranteed
 * by a default, and an unbounded interval inside the suite is a hung run.
 */
const OFFLINE = {
  disableJavaScriptEvaluation: true,
  disableJavaScriptFileLoading: true,
  disableCSSFileLoading: true,
  disableIframePageLoading: true,
  enableImageFileLoading: false,
  // Otherwise every blocked resource is reported as a load error, and a page
  // with two hundred of them buries anything worth reading.
  handleDisabledFileLoadingAsSuccess: true,
  timer: {
    maxTimeout: 1_000,
    maxIntervalTime: 1_000,
    maxIntervalIterations: 10,
    preventTimerLoops: true,
  },
} as const;

/**
 * The tokenizer is deliberately NOT a dependency of this repository.
 *
 * It weighs 55 MB installed, for one measurement in one optional suite, and
 * nobody cloning this project to fix a typo should pay for it. Whoever wants the
 * token columns asks for them:
 *
 *     npm install --no-save gpt-tokenizer
 *
 * Loaded through `createRequire` rather than a bare import so that neither the
 * typechecker nor vite tries to resolve a package that is usually absent. The
 * suite runs either way; without it the token columns are simply not printed.
 *
 * o200k_base is the encoding modern GPT models use. It is a proxy, not Claude's
 * tokenizer: BPE vocabularies of this generation land within a few per cent of
 * one another on prose and markup, which is close enough for a ratio and not
 * close enough to quote as a bill.
 */
const encode: ((text: string) => number[]) | undefined = (() => {
  try {
    return (createRequire(import.meta.url)('gpt-tokenizer/encoding/o200k_base') as {
      encode: (text: string) => number[];
    }).encode;
  } catch {
    return undefined;
  }
})();

const tokens = (text: string): number => (encode && text ? encode(text).length : 0);

interface Arm {
  pages: number;
  withTools: number;
  /** The page exactly as it was served. What a naive scraper hands to a model. */
  rawTokens: number;
  /** Script, style and markup stripped out. What a competent scraper hands over. */
  textTokens: number;
  /** What the generated tools return. */
  toolTokens: number;
  toolBytes: number;
  pageBytes: number;
}

const empty = (): Arm => ({
  pages: 0,
  withTools: 0,
  rawTokens: 0,
  textTokens: 0,
  toolTokens: 0,
  toolBytes: 0,
  pageBytes: 0,
});

const totals = { ...empty(), tools: 0, byVertical: new Map<string, Arm>() };

describe.skipIf(corpus.length === 0)('corpus reale', () => {
  for (const page of corpus) {
    it(page.file, async () => {
      const html = readFileSync(join(PAGES, page.file), 'utf8');

      // The tripwire. With everything above disabled nothing should ever reach
      // this, so anything it records is a route out that a setting failed to
      // close — and the assertion below names the url rather than letting the
      // run go quietly online again.
      const leaked: string[] = [];
      let window!: Window;
      window = new Window({
        url: page.url,
        settings: {
          ...OFFLINE,
          fetch: {
            interceptor: {
              beforeAsyncRequest: async ({ request }: { request: { url: string } }) => {
                leaked.push(request.url);
                return new window.Response('', { status: 204 });
              },
            },
          },
        },
      });

      try {
        window.document.write(html);
        const doc = window.document as unknown as Document;

        // Action tools call `fetch` when executed. Left alone, running this
        // suite would fire real requests at every site in the corpus — the very
        // thing that using Common Crawl was meant to avoid. The stub keeps the
        // run offline and, more usefully, records where each tool tried to go.
        const attempted: string[] = [];
        const fetchImpl: typeof globalThis.fetch = async (input) => {
          attempted.push(String(input instanceof Request ? input.url : input));
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };

        const result = toTools(doc, { ...schemaOrgProfiles, baseUrl: page.url, fetchImpl });

        // Page content must never reach the level of an error. Everything a page
        // can do wrong is a warning at most, or one bad site takes the run down.
        expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);

        const names = result.tools.map((t) => t.name);
        for (const name of names) expect(name).toMatch(MCP_TOOL_NAME);
        expect(new Set(names).size).toBe(names.length);
        expect(result.tools.length).toBeLessThanOrEqual(24);

        let toolBytes = 0;
        const outputs: string[] = [];
        for (const tool of result.tools as ToolDescriptor[]) {
          expect(tool.description.length).toBeGreaterThan(10);
          expect(tool.inputSchema.type).toBe('object');
          expect(tool.inputSchema.additionalProperties).toBe(false);

          const out = await tool.execute({});
          const text = out.content[0]?.text ?? '';
          // Read tools render the graph, so their output is JSON by definition.
          // Action tools hand back whatever the site's own endpoint answered,
          // which for a search box is a page of HTML: demanding JSON of those
          // would be asserting something the library never promised.
          if (tool.source.kind === 'read') {
            expect(() => JSON.parse(text) as unknown).not.toThrow();
            expect(text.length).toBeGreaterThan(2);
          }
          toolBytes += Buffer.byteLength(text, 'utf8');
          outputs.push(text);
        }
        const toolText = outputs.join('\n');

        // The security property, checked against real `potentialAction` markup
        // rather than against a fixture written to pass: whatever a page asked
        // for, no generated tool may reach beyond the page's own host.
        for (const destination of attempted) {
          expect(new URL(destination).host).toBe(new URL(page.url).host);
        }

        // Nothing left this machine. Asserted per page rather than once at the
        // end, so a failure names the page that opened the route.
        expect(leaked).toEqual([]);

        // The scraper baseline, taken only now: stripping the scripts earlier
        // would have thrown away the JSON-LD the pipeline just read.
        for (const el of [...doc.querySelectorAll('script, style, noscript, template')]) {
          el.remove();
        }
        const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();

        const measured = {
          pages: 1,
          withTools: result.tools.length > 0 ? 1 : 0,
          rawTokens: tokens(html),
          textTokens: tokens(text),
          toolTokens: tokens(toolText),
          toolBytes,
          pageBytes: page.bytes,
        };

        totals.tools += result.tools.length;
        for (const key of Object.keys(measured) as Array<keyof Arm>) totals[key] += measured[key];

        const bucket = totals.byVertical.get(page.vertical) ?? empty();
        for (const key of Object.keys(measured) as Array<keyof Arm>) bucket[key] += measured[key];
        totals.byVertical.set(page.vertical, bucket);
      } finally {
        await window.happyDOM?.close?.();
      }
    });
  }

  afterAll(() => {
    if (totals.pages === 0) return;
    const out = (line: string) => process.stdout.write(`${line}\n`);
    // en-US grouping, to match the labels above and the tables in docs/corpus.md.
    // Under it-IT the same figure prints as `143.771`, which an English reader
    // takes for a fraction, and the document then disagreed with its own command.
    const per = (n: number) => Math.round(n / totals.pages).toLocaleString('en-US');
    /**
     * One decimal below 10x. Rounding to whole numbers turned the one result
     * worth noticing — recipes, where the tools cost more than the plain text —
     * into "0x", which reads as a missing value rather than as a loss.
     */
    const times = (a: number, b: number) => {
      if (!b) return '—';
      const r = a / b;
      return r < 10 ? `${r.toFixed(1)}x` : `${Math.round(r)}x`;
    };
    const line = '─'.repeat(70);

    out(`\n${line}`);
    out(`CORPUS  ${totals.pages} real pages, ${totals.tools} tools generated`);
    out(
      `with at least one tool: ${totals.withTools}/${totals.pages} ` +
        `(${Math.round((totals.withTools / totals.pages) * 100)}%)`
    );
    if (!encode) {
      const kb = (n: number) => `${(n / 1024 / totals.pages).toFixed(1)} KB`;
      out(`mean html per page       ${kb(totals.pageBytes)}`);
      out(`tool output per page     ${kb(totals.toolBytes)}`);
      out(line);
      out('tokens not counted. for the token columns:');
      out('  npm install --no-save gpt-tokenizer');
      out(`${line}\n`);
      return;
    }

    out(line);
    out('TOKENS PER PAGE, mean            tokens       vs raw     vs text');
    out(
      `  raw html                     ${per(totals.rawTokens).padStart(9)}` +
        `${'—'.padStart(12)}${'—'.padStart(11)}`
    );
    out(
      `  extracted text (scraper)     ${per(totals.textTokens).padStart(9)}` +
        `${times(totals.rawTokens, totals.textTokens).padStart(12)}${'—'.padStart(11)}`
    );
    out(
      `  agenticschema                ${per(totals.toolTokens).padStart(9)}` +
        `${times(totals.rawTokens, totals.toolTokens).padStart(12)}` +
        `${times(totals.textTokens, totals.toolTokens).padStart(11)}`
    );
    out(line);
    out('PER VERTICAL              pages       raw      text   agentic    vs text');
    for (const [vertical, b] of [...totals.byVertical].sort()) {
      const avg = (n: number) => Math.round(n / b.pages).toLocaleString('en-US');
      out(
        `  ${vertical.padEnd(20)} ${String(b.pages).padStart(6)} ` +
          `${avg(b.rawTokens).padStart(9)}${avg(b.textTokens).padStart(9)}` +
          `${avg(b.toolTokens).padStart(10)}${times(b.textTokens, b.toolTokens).padStart(10)}`
      );
    }
    out(line);
    out('counted with o200k_base, a proxy: it is not Claude\'s tokenizer');
    out(`${line}\n`);
  });
});
