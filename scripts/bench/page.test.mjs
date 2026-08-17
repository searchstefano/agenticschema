import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { pageText, readPage } from './page.mjs';

describe('pageText', () => {
  it('keeps the prose and drops the machinery', async () => {
    const text = await pageText(
      '<html><head><title>t</title><style>body{color:red}</style>' +
        '<script type="application/ld+json">{"@type":"Product","name":"Billy"}</script>' +
        '</head><body><h1>Billy   bookcase</h1>\n<p>EUR 129.90</p>' +
        '<noscript>enable js</noscript><template><b>hidden</b></template></body></html>'
    );

    expect(text).toBe('Billy bookcase EUR 129.90');
    // The JSON-LD is the tools arm's input. Leaving it in the text arm's would
    // hand one arm the other's advantage and quietly answer the question the
    // benchmark exists to ask.
    expect(text).not.toContain('Product');
    expect(text).not.toContain('enable js');
  });

  it('survives a page with no body at all', async () => {
    expect(await pageText('')).toBe('');
  });
});

describe('readPage', () => {
  const SHOP = `<html><head>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Zaino",
       "offers":{"@type":"Offer","price":129.9,"priceCurrency":"EUR"}}
    </script></head><body><h1>Zaino</h1><p>129,90 €</p></body></html>`;

  const FURNITURE_ONLY = `<html><head>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"BreadcrumbList",
       "itemListElement":[{"@type":"ListItem","position":1,"name":"Docs"}]}
    </script></head><body><h1>AbortController</h1></body></html>`;

  it('hands the neutral key what the page publishes, verbatim', async () => {
    const { structured } = await readPage(SHOP);
    // Verbatim, because a key built from this library's own tool output would
    // be asking the library to mark its own paper: a fact it fails to expose
    // would drop out of the key and stop counting against it.
    expect(structured).toContain('"price":129.9');
    expect(structured).toContain('JSON-LD as the page publishes it');
  });

  it('still finds the data on a page that publishes no JSON-LD', async () => {
    // A quarter of the corpus is microdata or RDFa and nothing else. Without
    // the parsed half, the neutral key on those pages would collapse back into
    // the text-only one without saying so.
    const { structured } = await readPage(
      '<html><body><div itemscope itemtype="https://schema.org/Product">' +
        '<span itemprop="name">Zaino</span></div></body></html>'
    );
    expect(structured).toContain('Zaino');
    expect(structured).toContain('Product');
  });

  it('tells a page with something to map from one with only furniture', async () => {
    expect((await readPage(SHOP)).mappable).toBe(true);
    // Breadcrumbs and a site header are not something an agent can be asked
    // about. Every MDN page in the corpus looks like this.
    expect((await readPage(FURNITURE_ONLY)).mappable).toBe(false);
    expect((await readPage('<html><body>niente</body></html>')).mappable).toBe(false);
  });

  it('reports no structured data rather than pretending there is some', async () => {
    const { structured, text } = await readPage('<html><body>solo prosa</body></html>');
    expect(structured).toBe('');
    expect(text).toBe('solo prosa');
  });

  it('fetches nothing the page points at', async () => {
    // Checked against a real socket, not a stubbed `globalThis.fetch`:
    // happy-dom loads resources through a client of its own, so stubbing the
    // global proves nothing about it. That exact mistake once let this project
    // pull 3,269 stylesheets off live sites while a test asserted it was
    // offline.
    const hits = [];
    const origin = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/css' }).end('a{}');
    });
    await new Promise((r) => origin.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${origin.address().port}`;

    try {
      const text = await pageText(
        '<html><head>' +
          `<link rel="stylesheet" href="${base}/app.css">` +
          `<script src="${base}/app.js"></script>` +
          `</head><body>hello<img src="${base}/x.png">` +
          `<iframe src="${base}/f.html"></iframe></body></html>`
      );
      expect(text).toContain('hello');
      await new Promise((r) => setTimeout(r, 300));
      expect(hits).toEqual([]);
    } finally {
      await new Promise((r) => origin.close(() => r()));
    }
  });
});
