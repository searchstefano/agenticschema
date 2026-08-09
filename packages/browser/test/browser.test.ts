import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { start, type Handle } from '../src/index.js';

/** Finto `document.modelContext`: registra e rispetta l'AbortSignal, come Chrome. */
function fakeModelContext() {
  const live = new Map<
    string,
    { description: string; execute: (a: Record<string, unknown>) => unknown }
  >();
  return {
    live,
    registerTool(
      tool: { name: string; description: string; execute: (a: Record<string, unknown>) => unknown },
      options?: { signal?: AbortSignal }
    ) {
      live.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => live.delete(tool.name));
      return Promise.resolve();
    },
  };
}

const PRODUCT = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Zaino Trekking 45L',
  offers: { '@type': 'Offer', price: '129.90', priceCurrency: 'EUR' },
});

let window: Window;
let document: Document;
let handle: Handle | undefined;

const setPage = (json: string): void => {
  document.body.innerHTML = `<script type="application/ld+json">${json}</script>`;
};

beforeEach(() => {
  window = new Window({ url: 'https://negozio.test/prodotto' });
  document = window.document as unknown as Document;
  document.write('<!doctype html><html><body></body></html>');
});

afterEach(() => {
  handle?.stop();
  handle = undefined;
});

// ---------------------------------------------------------------------------

describe('adapter browser', () => {
  it('registra i tool della pagina su modelContext', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({
      document,
      modelContext: api,
      baseUrl: 'https://negozio.test/prodotto',
      watch: false,
    });

    expect([...api.live.keys()]).toEqual(['get_product', 'get_product_offer']);
    expect(handle.tools()).toHaveLength(2);
  });

  it('i tool registrati restituiscono i dati della pagina', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    const offer = api.live.get('get_product_offer')!;
    const result = (await offer.execute({})) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toContain('129.90');
  });

  it('non esplode su un browser senza WebMCP: restituisce un handle inerte', async () => {
    setPage(PRODUCT);
    // Nessun modelContext iniettato e nessun document.modelContext globale.
    handle = await start({ document, watch: false });
    expect(handle.tools()).toEqual([]);
    expect(() => handle!.stop()).not.toThrow();
  });

  it('stop() deregistra tutto tramite AbortSignal', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });
    expect(api.live.size).toBe(2);

    handle.stop();
    // WebMCP non ha unregisterTool: l'abort è l'unica via, e deve funzionare.
    expect(api.live.size).toBe(0);
  });

  it('refresh è un no-op se il markup non è cambiato', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    const spy = vi.spyOn(api, 'registerTool');
    handle = await start({ document, modelContext: api, watch: false });

    const callsAfterStart = spy.mock.calls.length;
    await handle.refresh();
    expect(spy.mock.calls.length).toBe(callsAfterStart);
  });

  it('rimappa quando il markup cambia, anche se i nomi dei tool restano uguali', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    // Solo il prezzo cambia: nomi e description identici, ma le closure sono vecchie.
    setPage(PRODUCT.replace('129.90', '99.00'));
    await handle.refresh();

    const offer = api.live.get('get_product_offer')!;
    const result = (await offer.execute({})) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toContain('99.00');
    expect(result.content[0]!.text).not.toContain('129.90');
  });

  it('osserva le modifiche al DOM nelle SPA', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, debounceMs: 5 });
    expect([...api.live.keys()]).toContain('get_product');

    // La route cambia e il framework riscrive il blocco JSON-LD.
    setPage(
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Carbonara' })
    );
    await vi.waitFor(() => expect([...api.live.keys()]).toEqual(['get_recipe']), { timeout: 1000 });
  });

  it('stop() smette di osservare', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, debounceMs: 5 });
    handle.stop();

    setPage(
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Carbonara' })
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(api.live.size).toBe(0);
  });
});
