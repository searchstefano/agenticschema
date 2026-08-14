import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import type { Diagnostic, ToolDescriptor } from '@agenticschema/core';
import { start, type Handle, type StartOptions } from '../src/index.js';

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

  it('survives a refresh that changed nothing', async () => {
    setBlocks(BROKEN);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    await handle.refresh();
    // The remap is skipped when the markup is identical, and skipping it must
    // not be mistaken for a clean page.
    expect(handle.diagnostics().map((d) => d.code)).toContain('json-parse-error');
  });

  it('cannot be emptied by whoever reads them', async () => {
    setBlocks(BROKEN, PRODUCT);
    const api = fakeModelContext();
    handle = await start({ document, modelContext: api, watch: false });

    const before = handle.diagnostics().length;
    // The typed signature stops this, but the script tag hands the handle to
    // plain JavaScript, where nothing does.
    (handle.diagnostics() as Diagnostic[]).length = 0;
    (handle.tools() as ToolDescriptor[]).length = 0;

    expect(handle.diagnostics()).toHaveLength(before);
    expect(handle.tools()).toHaveLength(2);
  });

  it('says why the inert handle is inert, rather than looking healthy', async () => {
    setPage(PRODUCT);
    // No modelContext injected and no global document.modelContext either.
    handle = await start({ document, watch: false });

    // Returning an empty array here is the one answer that misleads: to anything
    // reading diagnostics, a page with no WebMCP surface looked identical to a
    // page where everything went fine.
    expect(handle.diagnostics().map((d) => d.code)).toEqual(['no-webmcp-surface']);
    expect(handle.tools()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('a remap that throws', () => {
  /**
   * `profiles` is read only by the spread inside `toTools`; `extract`, and so
   * `snapshot()`, never touches it. Arming it after the first successful remap
   * puts the failure exactly where it matters: after the markup fingerprint has
   * been taken, and before the tools exist.
   */
  const armable = (over: Partial<StartOptions>) => {
    const state = { armed: false };
    const options = { ...over } as StartOptions;
    Object.defineProperty(options, 'profiles', {
      enumerable: true,
      get() {
        if (state.armed) throw new Error('remap esploso');
        return undefined;
      },
    });
    return { options, state };
  };

  it('leaves the page remappable instead of freezing on the previous one', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    const { options, state } = armable({ document, modelContext: api, watch: false });
    handle = await start(options);
    expect(handle.tools().map((t) => t.name)).toContain('get_product');

    setPage(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Carbonara' }));
    state.armed = true;
    await expect(handle.refresh()).rejects.toThrow('remap esploso');

    // Recording the new markup as done before the work succeeded is what used to
    // freeze the adapter here: every later refresh found the fingerprint already
    // stored and returned without doing anything, for the rest of the session.
    state.armed = false;
    await handle.refresh();
    expect(handle.tools().map((t) => t.name)).toEqual(['get_recipe']);
  });

  it('drops the stale tools rather than leaving them describing another page', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    const { options, state } = armable({ document, modelContext: api, watch: false });
    handle = await start(options);

    setPage(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Carbonara' }));
    state.armed = true;
    await expect(handle.refresh()).rejects.toThrow();

    // Tools from the previous route are worse than none: an agent calling them
    // gets confident, well-formed answers about a page the user has left.
    expect(handle.tools()).toEqual([]);
    expect(handle.diagnostics().map((d) => d.code)).toEqual(['remap-failed']);
  });

  it('does not leave an unhandled rejection behind when the watcher triggers it', async () => {
    setPage(PRODUCT);
    const api = fakeModelContext();
    const { options, state } = armable({ document, modelContext: api, debounceMs: 5 });
    handle = await start(options);

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      state.armed = true;
      setPage(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'X' }));
      await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 1000 });
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      warn.mockRestore();
    }
  });
});
