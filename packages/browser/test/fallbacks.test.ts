/**
 * What the adapter does when a piece of itself does not arrive.
 *
 * Both of these degraded silently in 0.1.1, and that is what made the packaging
 * bugs so expensive to find: the library looked like it was working. A missing
 * WebMCP surface registered no tools at all, and missing profiles quietly fell
 * back to generic tool names. Neither said anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { start, type Handle } from '../src/index.js';

// Stands in for the chunk that never downloads, or an install that is missing it.
vi.mock('@agenticschema/profiles', () => {
  throw new Error('profiles unavailable');
});

function fakeModelContext() {
  return {
    registerTool(): Promise<void> {
      return Promise.resolve();
    },
  };
}

const BUSINESS = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Osteria del Ponte',
});

let window: Window;
let document: Document;
let handle: Handle | undefined;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window = new Window({ url: 'https://osteria.test/' });
  document = window.document as unknown as Document;
  document.write('<!doctype html><html><body></body></html>');
  document.body.innerHTML = `<script type="application/ld+json">${BUSINESS}</script>`;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  handle?.stop();
  handle = undefined;
  warn.mockRestore();
});

const warnings = (): string =>
  warn.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n');

describe('degraded startup', () => {
  it('warns when no WebMCP surface can be found', async () => {
    // No modelContext injected, and a node environment has no global one either,
    // so this is the path a real browser without WebMCP takes.
    handle = await start({ document, watch: false });

    expect(handle.tools()).toHaveLength(0);
    expect(warnings()).toMatch(/webmcp/i);
  });

  it('warns when the profiles cannot be loaded, and keeps mapping without them', async () => {
    handle = await start({ document, modelContext: fakeModelContext(), watch: false });

    expect(warnings()).toMatch(/profiles/i);
    // The generic profile still names the tool after the type, so the page stays
    // usable. That is the fallback working, not the failure being hidden.
    expect(handle.tools().map((t) => t.name)).toContain('get_local_business');
  });
});
