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

/** Collega un client MCP reale al server generato. */
async function connect(html: string, url = 'https://negozio.test/prodotto') {
  const { server, tools, diagnostics } = await createServer([{ url, html }]);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, tools, diagnostics };
}

const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';

// ---------------------------------------------------------------------------

describe('adapter server', () => {
  it('un client MCP reale vede i tool generati dalla pagina', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('get_product');
    expect(names).toContain('get_product_offer');
    await client.close();
  });

  it('il client invoca un tool e riceve i dati del JSON-LD', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const result = await client.callTool({ name: 'get_product_offer', arguments: {} });

    expect(textOf(result as never)).toContain('129.90');
    expect(textOf(result as never)).toContain('EUR');
    await client.close();
  });

  it('la SearchAction diventa un tool con il parametro richiesto', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name.startsWith('search_'))!;

    expect(search).toBeDefined();
    expect(search.inputSchema.required).toEqual(['search_term_string']);
    await client.close();
  });

  it('la validazione dello schema rifiuta un input privo del parametro richiesto', async () => {
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

  it('espone le entità anche come Resources MCP, che nel browser non esistono', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { resources } = await client.listResources();

    expect(resources.length).toBeGreaterThan(0);
    const product = resources.find((r) => r.title === 'Product')!;
    expect(product).toBeDefined();

    const read = await client.readResource({ uri: product.uri });
    // `contents` è un'unione testo|blob: qui è testo, ma va ristretto.
    const content = read.contents[0]!;
    expect('text' in content && content.text).toContain('Zaino Trekking 45L');
    await client.close();
  });

  it('legge anche i microdata, perché lato server c-è un DOM vero', async () => {
    const { client } = await connect(PRODUCT_PAGE);
    const { resources } = await client.listResources();
    // <div itemscope itemtype="Organization"> nel body
    expect(resources.some((r) => r.title === 'Organization')).toBe(true);
    await client.close();
  });

  it('separa i nomi quando le pagine sono più di una', async () => {
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

  it('una pagina senza dati strutturati non fa esplodere il server', async () => {
    const { client, diagnostics } = await connect('<!doctype html><html><body><p>niente</p></body></html>');
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === 'no-structured-data')).toBe(true);
    await client.close();
  });
});

describe('parseDocument', () => {
  it('produce un Document utilizzabile dalla pipeline', () => {
    const doc = parseDocument('<html><body><div itemscope itemtype="https://schema.org/Person"></div></body></html>');
    expect(doc.querySelectorAll('[itemscope]')).toHaveLength(1);
  });
});
