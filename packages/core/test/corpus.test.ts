import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toTools, type ToolDescriptor } from '../src/index.js';

/**
 * A corpus of messy markup: `@context` over http, `mainEntity` as a string
 * rather than a node, dozens of entities of one type, deep nesting. These are
 * the things real pages do and a fixture written from scratch never does.
 *
 * The committed ones are synthetic on purpose. A live site's JSON-LD is that
 * site's content and this repo has no right to redistribute it.
 * `npm run corpus:fetch` pulls real pages into `fixtures/local/`, which is not
 * tracked, so anyone who wants to check against the live web does it locally.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const LOCAL = join(ROOT, 'local');

const jsonldIn = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonld.json'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
};

const files = [...jsonldIn(ROOT), ...jsonldIn(LOCAL)];

const pageFor = (file: string): string =>
  `<script type="application/ld+json">${readFileSync(file, 'utf8')}</script>`;

/** Constraints MCP clients actually enforce on tool names. */
const MCP_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

describe('corpus of messy markup', () => {
  it('the corpus is not empty', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file.split('/').pop()?.replace('.jsonld.json', '') ?? file, () => {
      const result = toTools(pageFor(file), { baseUrl: 'https://esempio.test/pagina' });

      it('produces tools without erroring', () => {
        expect(result.tools.length).toBeGreaterThan(0);
        expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      });

      it('generates names the MCP spec accepts, with no duplicates', () => {
        const names = result.tools.map((t) => t.name);
        for (const name of names) expect(name).toMatch(MCP_TOOL_NAME);
        expect(new Set(names).size).toBe(names.length);
      });

      it('every tool has a usable description and a valid schema', () => {
        for (const tool of result.tools) {
          expect(tool.description.length).toBeGreaterThan(10);
          expect(tool.inputSchema.type).toBe('object');
          expect(tool.inputSchema.additionalProperties).toBe(false);
        }
      });

      it('every tool returns valid, non-empty JSON', async () => {
        for (const tool of result.tools as ToolDescriptor[]) {
          const out = await tool.execute({});
          const text = out.content[0]?.text ?? '';
          expect(() => JSON.parse(text) as unknown).not.toThrow();
          expect(text.length).toBeGreaterThan(2);
        }
      });

      it('stays within the tool cap', () => {
        expect(result.tools.length).toBeLessThanOrEqual(24);
      });
    });
  }
});
