import { describe, expect, it } from 'vitest';
import {
  Client,
  LATEST_PROTOCOL_VERSION,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer, createHttpHandler, parseDocument } from '../src/index.js';

const PRODUCT_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": "#site", "url": "https://negozio.test/",
      "potentialAction": { "@type": "SearchAction",
        "target": { "@type": "EntryPoint", "urlTemplate": "https://negozio.test/cerca?q={search_term_string}" },
        "query-input": "required name=search_term_string" } },
    { "@type": "Product", "@id": "#prodotto", "name": "Zaino Trekking 45L", "sku": "ZT-45-BLU",
      "offers": { "@type": "Offer", "price": "129.90", "priceCurrency": "EUR",
                  "availability": "https://schema.org/InStock" } }
  ]
}
</script></head><body>
  <div itemscope itemtype="https://schema.org/Organization">
    <span itemprop="name">Altavia</span>
  </div>
</body></html>`;

/** Wires a real MCP client to the generated server. */
async function connect(html: string, url = 'https://negozio.test/prodotto') {
  const { server, tools, diagnostics } = await createServer([{ url, html }]);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, tools, diagnostics };
}

const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';

const PAGE_URL = 'https://negozio.test/prodotto';
const MODERN_REVISION = '2026-07-28';

/**
 * Asks as a 2026-era client would, straight at the handler.
 *
 * The installed client SDK speaks 2025-11-25, and the 2025 codec has no cache
 * code path at all, so `ttlMs`/`cacheScope` are unobservable through it. The
 * modern path wants things a legacy request does not carry: the revision
 * header, the `Mcp-Method` and `Mcp-Name` headers the revision added so
 * gateways can route without parsing a body, and the protocol envelope in
 * `params._meta`.
 */
async function modernCall(
  handler: Awaited<ReturnType<typeof createHttpHandler>>,
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await handler.fetch(
    new Request('http://mcp.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN_REVISION,
        'Mcp-Method': method,
        // Names the target the body addresses, and the revision requires it
        // whenever there is one: the tool for tools/call, the uri for reads.
        ...(typeof params['name'] === 'string' || typeof params['uri'] === 'string'
          ? { 'Mcp-Name': String(params['name'] ?? params['uri']) }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_REVISION,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (!body.result) throw new Error(`no result for ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/**
 * Wires a real MCP client to the HTTP handler with no socket: the handler's
 * own `fetch` stands in for the network. Unlike `InMemoryTransport`, which
 * hands `JSONRPCMessage` objects straight across, this goes through the wire
 * codec — the only place the 2026-07-28 cache fields are ever filled in.
 */
async function connectHttp(
  html: string | undefined,
  options: Parameters<typeof createHttpHandler>[1] = {},
  url = 'https://negozio.test/prodotto'
) {
  const handler = await createHttpHandler([html === undefined ? url : { url, html }], options);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
      // Without a modern revision the request classifies as 2025-era, and the
      // legacy codec has no cache code path at all.
      protocolVersion: LATEST_PROTOCOL_VERSION,
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        handler.fetch(new Request(input as never, init))) as never,
    })
  );
  return {
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

// ---------------------------------------------------------------------------

describe('server adapter', () => {
  it('a real MCP client sees the tools generated from the page', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('get_product');
    expect(names).toContain('get_product_offer');
    await client.close();
  });

  it('the client calls a tool and gets the JSON-LD data back', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const result = await client.callTool({ name: 'get_product_offer', arguments: {} });

    expect(textOf(result as never)).toContain('129.90');
    expect(textOf(result as never)).toContain('EUR');
    await client.close();
  });

  it('the SearchAction becomes a tool carrying its required parameter', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name.startsWith('search_'))!;

    expect(search).toBeDefined();
    expect(search.inputSchema.required).toEqual(['search_term_string']);
    await client.close();
  });

  it('schema validation rejects input missing the required parameter', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name.startsWith('search_'))!;

    let rejected = false;
    try {
      const bad = await client.callTool({ name: search.name, arguments: {} });
      rejected = (bad as { isError?: boolean }).isError === true;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    await client.close();
  });

  it('also exposes entities as MCP resources, which the browser cannot do', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { resources } = await client.listResources();

    expect(resources.length).toBeGreaterThan(0);
    const product = resources.find((r) => r.title === 'Product')!;
    expect(product).toBeDefined();

    const read = await client.readResource({ uri: product.uri });
    // `contents` is a text|blob union. It is text here, but it still needs narrowing.
    const content = read.contents[0]!;
    expect('text' in content && content.text).toContain('Zaino Trekking 45L');
    await client.close();
  });

  it('reads microdata too, because there is a real DOM server-side', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { resources } = await client.listResources();
    // the <div itemscope itemtype="Organization"> in the body
    expect(resources.some((r) => r.title === 'Organization')).toBe(true);
    await client.close();
  });

  it('separates names when there is more than one page', async () => {
    const { server, tools } = await createServer([
      { url: 'https://negozio-a.test/p', html: PRODUCT_PAGE },
      { url: 'https://negozio-b.test/p', html: PRODUCT_PAGE },
    ]);
    expect(server).toBeDefined();

    const names = tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith('negozio_a_test_'))).toBe(true);
    expect(names.some((n) => n.startsWith('negozio_b_test_'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a page with no structured data does not take the server down', async () => {
    const { client, diagnostics } = await connect('<!doctype html><html><body><p>niente</p></body></html>');
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === 'no-structured-data')).toBe(true);
    await client.close();
  });
});

/**
 * The 2026-07-28 revision requires `ttlMs`/`cacheScope` on cacheable results,
 * and the SDK fills the most pessimistic pair — `ttlMs: 0`, `cacheScope:
 * 'private'` — when the server says nothing. That is the wrong default here:
 * a page is fetched and mapped once at startup and never refetched, so every
 * answer this server gives is identical for the life of the process.
 */
describe('cache hints', () => {
  it('the tool list carries a lifetime, since the mapping never changes after startup', async () => {
    const handler = await createHttpHandler([{ url: PAGE_URL, html: PRODUCT_PAGE }]);
    const result = await modernCall(handler, 'tools/list');

    expect(result['ttlMs']).toBeGreaterThan(0);
    await handler.close();
  });

  it('the tool list is publicly cacheable, because descriptions carry no page text', async () => {
    const handler = await createHttpHandler([{ url: PAGE_URL, html: PRODUCT_PAGE }]);
    const result = await modernCall(handler, 'tools/list');

    // The guard keeps page text out of descriptions, so nothing here is
    // page data and a shared cache may hold it.
    expect(result['cacheScope']).toBe('public');
    await handler.close();
  });

  it('resource contents get a lifetime but stay private, because they are page data', async () => {
    const handler = await createHttpHandler([{ url: PAGE_URL, html: PRODUCT_PAGE }]);
    const list = (await modernCall(handler, 'resources/list')) as { resources: Array<{ uri: string }> };
    const read = await modernCall(handler, 'resources/read', { uri: list.resources[0]!.uri });

    expect(read['ttlMs']).toBeGreaterThan(0);
    // Unlike the tool list, this is the page's own content. A caller may pass
    // `html` it fetched from somewhere private, so a shared cache is not ours
    // to authorise.
    expect(read['cacheScope']).toBe('private');
    await handler.close();
  });

  it('the lifetime is configurable', async () => {
    const handler = await createHttpHandler([{ url: PAGE_URL, html: PRODUCT_PAGE }], {
      cacheTtlMs: 1000,
    });

    expect((await modernCall(handler, 'tools/list'))['ttlMs']).toBe(1000);
    await handler.close();
  });

  it('the server identity carries no configuration, only name and version', async () => {
    const handler = await createHttpHandler([{ url: PAGE_URL, html: PRODUCT_PAGE }]);
    const result = await modernCall(handler, 'tools/list');
    const meta = result['_meta'] as Record<string, Record<string, unknown>> | undefined;

    // The identity object is echoed to every client. Configuration put there
    // by mistake ships on the wire, on every single response.
    expect(Object.keys(meta?.['io.modelcontextprotocol/serverInfo'] ?? {}).sort()).toEqual([
      'name',
      'version',
    ]);
    await handler.close();
  });
});

/**
 * The stdio path is what `npx` gives you. This is the other one: a
 * fetch-shaped handler that serves the 2026-07-28 stateless protocol, so the
 * same mapping can sit behind a Worker or any HTTP runtime.
 */
describe('HTTP handler', () => {
  it('a real MCP client reaches the page tools over HTTP', async () => {
    const { client, close } = await connectHttp(PRODUCT_PAGE);
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toContain('get_product');
    await close();
  });

  it('calling a tool over HTTP returns the page data', async () => {
    const { client, close } = await connectHttp(PRODUCT_PAGE);
    const result = await client.callTool({ name: 'get_product_offer', arguments: {} });

    expect(textOf(result as never)).toContain('129.90');
    await close();
  });

  it('fetches each page once, not once per request', async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches++;
      return new Response(PRODUCT_PAGE, { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof globalThis.fetch;

    const { client, close } = await connectHttp(undefined, { fetchImpl });
    await client.listTools();
    await client.listTools();

    // Stateless serving builds a server per request. Refetching the page per
    // request too would turn every tools/list into a live hit on the origin.
    expect(fetches).toBe(1);
    await close();
  });
});

describe('parseDocument', () => {
  it('produces a Document the pipeline can use', () => {
    const doc = parseDocument('<html><body><div itemscope itemtype="https://schema.org/Person"></div></body></html>');
    expect(doc.querySelectorAll('[itemscope]')).toHaveLength(1);
  });
});
