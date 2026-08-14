import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { start, type Handle } from '../src/index.js';

/** A stand-in `document.modelContext`: it registers and honours the AbortSignal, like Chrome. */
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

describe('browser adapter', () => {
  it('registers the page tools on modelContext', async () => {
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

  it('the registered tools return the page data', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    const offer = api.live.get('get_product_offer')!;
    const result = (await offer.execute({})) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toContain('129.90');
  });

  it('survives a browser without WebMCP by returning an inert handle', async () => {
    setPage(PRODUCT);
    // No modelContext injected and no global document.modelContext either.
    handle = await start({ document, watch: false });
    expect(handle.tools()).toEqual([]);
    expect(() => handle!.stop()).not.toThrow();
  });

  it('stop() unregisters everything through the AbortSignal', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });
    expect(api.live.size).toBe(2);

    handle.stop();
    // WebMCP has no unregisterTool. The abort is the only route, and it has to work.
    expect(api.live.size).toBe(0);
  });

  it('refresh does nothing when the markup has not changed', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    const spy = vi.spyOn(api, 'registerTool');
    handle = await start({ document, modelContext: api, watch: false });

    const callsAfterStart = spy.mock.calls.length;
    await handle.refresh();
    expect(spy.mock.calls.length).toBe(callsAfterStart);
  });

  it('remaps when the markup changes, even if the tool names stay the same', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    // Only the price moves. Names and descriptions match, but the closures are stale.
    setPage(PRODUCT.replace('129.90', '99.00'));
    await handle.refresh();

    const offer = api.live.get('get_product_offer')!;
    const result = (await offer.execute({})) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toContain('99.00');
    expect(result.content[0]!.text).not.toContain('129.90');
  });

  it('picks up DOM changes in a single-page app', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, debounceMs: 5 });
    expect([...api.live.keys()]).toContain('get_product');

    // The route changes and the framework rewrites the JSON-LD block.
    setPage(
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Carbonara' })
    );
    await vi.waitFor(() => expect([...api.live.keys()]).toEqual(['get_recipe']), { timeout: 1000 });
  });

  it('stop() stops watching', async () => {
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

// ---------------------------------------------------------------------------

describe('diagnostics', () => {
  /** A trailing comma, which is what most of the broken JSON-LD on the web looks like. */
  const BROKEN = '{ "@context": "https://schema.org", "@type": "Product", }';

  const setBlocks = (...blocks: string[]): void => {
    document.body.innerHTML = blocks
      .map((b) => `<script type="application/ld+json">${b}</script>`)
      .join('');
  };

  it('reports what the pipeline saw, not just the tools it produced', async () => {
    setBlocks(BROKEN, PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    expect(handle.diagnostics().map((d) => d.code)).toContain('json-parse-error');
    // The broken block must not cost the page its tools.
    expect(handle.tools()).toHaveLength(2);
  });

  it('says nothing about a page that parsed cleanly', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    expect(handle.diagnostics()).toEqual([]);
  });

  it('replaces the diagnostics on refresh rather than piling them up', async () => {
    setBlocks(BROKEN);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });
    expect(handle.diagnostics().map((d) => d.code)).toContain('json-parse-error');

    setPage(PRODUCT);
    await handle.refresh();
    expect(handle.diagnostics().map((d) => d.code)).not.toContain('json-parse-error');
  });

  it('goes quiet after stop(), the way the tool list does', async () => {
    setBlocks(BROKEN);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });
    expect(handle.diagnostics().length).toBeGreaterThan(0);

    handle.stop();
    expect(handle.diagnostics()).toEqual([]);
  });

  it('reports none from the inert handle, having run no pipeline at all', async () => {
    setPage(PRODUCT);
    // No modelContext injected and no global document.modelContext either.
    handle = await start({ document, watch: false });
    expect(handle.diagnostics()).toEqual([]);
  });
});
