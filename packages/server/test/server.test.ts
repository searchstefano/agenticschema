import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer, parseDocument } from '../src/index.js';

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

describe('parseDocument', () => {
  it('produces a Document the pipeline can use', () => {
    const doc = parseDocument('<html><body><div itemscope itemtype="https://schema.org/Person"></div></body></html>');
    expect(doc.querySelectorAll('[itemscope]')).toHaveLength(1);
  });
});
