import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toTools, type ToolDescriptor } from '../src/index.js';

/**
 * Corpus di markup "sporco": `@context` in http, `mainEntity` come stringa invece
 * che come nodo, decine di entità dello stesso tipo, annidamento profondo. Sono
 * le patologie che il web reale ha e che una fixture scritta di getto non ha.
 *
 * Quelle committate sono sintetiche di proposito: il JSON-LD di un sito vero è
 * contenuto di quel sito, e ridistribuirlo in un repo pubblico non è nostro
 * diritto. `npm run corpus:fetch` scarica pagine reali in `fixtures/local/`, che
 * non è tracciata: chi vuole verificare contro il web vero lo fa in locale.
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

/** Vincoli che i client MCP impongono davvero ai tool. */
const MCP_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

describe('corpus da pagine reali', () => {
  it('il corpus non è vuoto', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file.split('/').pop()?.replace('.jsonld.json', '') ?? file, () => {
      const result = toTools(pageFor(file), { baseUrl: 'https://esempio.test/pagina' });

      it('produce tool senza andare in errore', () => {
        expect(result.tools.length).toBeGreaterThan(0);
        expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      });

      it('genera nomi accettati dalla specifica MCP e senza duplicati', () => {
        const names = result.tools.map((t) => t.name);
        for (const name of names) expect(name).toMatch(MCP_TOOL_NAME);
        expect(new Set(names).size).toBe(names.length);
      });

      it('ogni tool ha una description utile e uno schema valido', () => {
        for (const tool of result.tools) {
          expect(tool.description.length).toBeGreaterThan(10);
          expect(tool.inputSchema.type).toBe('object');
          expect(tool.inputSchema.additionalProperties).toBe(false);
        }
      });

      it('ogni tool restituisce JSON valido e non vuoto', async () => {
        for (const tool of result.tools as ToolDescriptor[]) {
          const out = await tool.execute({});
          const text = out.content[0]?.text ?? '';
          expect(() => JSON.parse(text) as unknown).not.toThrow();
          expect(text.length).toBeGreaterThan(2);
        }
      });

      it('rispetta il tetto sui tool', () => {
        expect(result.tools.length).toBeLessThanOrEqual(24);
      });
    });
  }
});
