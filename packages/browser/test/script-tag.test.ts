/**
 * The script-tag entry point reading its own configuration.
 *
 * `document.currentScript` is null inside a module script — the HTML spec says
 * so — and the CDN snippet everyone pastes is `type="module"`. So the fallback
 * selector is the only path that ever runs on a real page, and if it does not
 * match, every `data-*` option is ignored in silence: the page keeps working
 * and quietly uses defaults, which looks exactly like success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import type { Handle } from '../src/index.js';

/** A stand-in `document.modelContext`: it registers and honours the AbortSignal, like Chrome. */
function fakeModelContext() {
  const live = new Map<string, unknown>();
  return {
    live,
    registerTool(tool: { name: string }, options?: { signal?: AbortSignal }) {
      live.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => live.delete(tool.name));
      return Promise.resolve();
    },
  };
}

/** Three blocks, five tools with the defaults in place: enough headroom to see a cap bite. */
const MARKUP = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Acme',
    url: 'https://acme.test',
    address: { '@type': 'PostalAddress', streetAddress: '1 Road', addressLocality: 'Rome' },
  },
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Acme Site' },
  {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Widget',
    offers: { '@type': 'Offer', price: '9.99', priceCurrency: 'EUR' },
  },
]
  .map((n) => `<script type="application/ld+json">${JSON.stringify(n)}</script>`)
  .join('');

const CDN_SRC = 'https://cdn.jsdelivr.net/npm/@agenticschema/browser@0.1.2';

let window: Window;
let handle: Handle | undefined;

/**
 * Loads the auto entry against a page carrying `tag`. Nothing sets
 * `document.currentScript`, which is exactly the state a module script runs in.
 */
async function loadAutoWith(tag: string): Promise<{ handle: Handle; live: Map<string, unknown> }> {
  window = new Window({ url: 'https://acme.test/' });
  const document = window.document as unknown as Document;
  document.write(`<!doctype html><html><body>${MARKUP}${tag}</body></html>`);

  const api = fakeModelContext();
  (document as unknown as { modelContext: unknown }).modelContext = api;
  (globalThis as { document?: Document }).document = document;

  // The auto entry starts on import, so each case needs its own module
  // instance: without the reset every load after the first would return the
  // first page's handle from the module cache.
  vi.resetModules();
  const { ready } = (await import('../src/auto.js')) as { ready: Promise<Handle> };
  return { handle: await ready, live: api.live };
}

beforeEach(() => {
  delete (globalThis as { document?: Document }).document;
});

afterEach(() => {
  handle?.stop();
  handle = undefined;
  delete (globalThis as { document?: Document }).document;
});

// ---------------------------------------------------------------------------

describe('script-tag configuration', () => {
  it('reads data attributes from a module tag, which has no currentScript', async () => {
    const result = await loadAutoWith(
      `<script type="module" data-max-tools="2" data-watch="off" src="${CDN_SRC}"></script>`
    );
    handle = result.handle;

    // Without the cap this page yields five tools.
    expect(handle.tools()).toHaveLength(2);
  });

  it('still honours the explicit data-agenticschema marker', async () => {
    const result = await loadAutoWith(
      `<script type="module" data-agenticschema data-max-tools="2" data-watch="off"
               src="https://example.test/self-hosted-build.js"></script>`
    );
    handle = result.handle;

    expect(handle.tools()).toHaveLength(2);
  });

  it('falls back to defaults when the page carries no adapter tag at all', async () => {
    const result = await loadAutoWith('');
    handle = result.handle;

    expect(handle.tools()).toHaveLength(5);
  });
});
