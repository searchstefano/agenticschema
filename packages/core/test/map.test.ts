import { describe, expect, it } from 'vitest';
import {
  computeTemporalCone,
  discoverMachineTwins,
  extract,
  extractEpistemicAtoms,
  extractEpistemicFrontier,
  extractHydrationData,
  extractMeta,
  extractSpecs,
  extractZeroDomNodes,
  foragePages,
  fusePages,
  hammingDistance,
  mapToTools,
  materialize,
  normalize,
  scrape,
  selectPrimary,
  simhash64,
  toContext,
  toSlug,
  type EntityGraph,
  type Profile,
  type ToolDescriptor,
} from '../src/index.js';

const ldScript = (json: string) => `<script type="application/ld+json">${json}</script>`;
const graphOf = (json: string): EntityGraph => normalize(extract(ldScript(json)).nodes);

/** Runs a tool and hands back the parsed JSON payload. */
const run = async (tool: ToolDescriptor): Promise<unknown> =>
  JSON.parse((await tool.execute({})).content[0]!.text);

const productProfile: Profile = {
  types: ['Product'],
  slug: 'product',
  read: [
    { description: 'Dettagli del prodotto.', pick: ['name', 'sku'] },
    { name: 'offer', from: 'offers', description: 'Prezzo e disponibilità.' },
    { name: 'reviews', from: 'review', list: true, description: 'Recensioni.' },
  ],
};

// ---------------------------------------------------------------------------

describe('selectPrimary', () => {
  it('follows a page mainEntity', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"WebPage","@id":"#page","mainEntity":{"@id":"#p"}},' +
        '{"@type":"Product","@id":"#p","name":"Zaino"}]}'
    );
    expect(selectPrimary(graph)).toBe('#p');
  });

  it('treats a node with mainEntityOfPage as primary, since that arrow points the other way', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"WebPage","@id":"#page"},' +
        '{"@type":"Article","@id":"#a","mainEntityOfPage":{"@id":"#page"}}]}'
    );
    expect(selectPrimary(graph)).toBe('#a');
  });

  it('skips the furniture and picks the real subject', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"BreadcrumbList","@id":"#bc"},' +
        '{"@type":"Organization","@id":"#org","name":"Altavia"},' +
        '{"@type":"WebSite","@id":"#site"},' +
        '{"@type":"Product","@id":"#p","name":"Zaino"}]}'
    );
    expect(selectPrimary(graph)).toBe('#p');
  });

  it('falls back to about when that is the only signal', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"WebPage","@id":"#page","about":{"@id":"#e"}},' +
        '{"@type":"Event","@id":"#e","name":"Concerto"}]}'
    );
    expect(selectPrimary(graph)).toBe('#e');
  });
});

describe('mapToTools', () => {
  it('still produces a tool with no profiles, through the generic fallback', async () => {
    const graph = graphOf('{"@type":"Recipe","name":"Carbonara","recipeYield":"4"}');
    const { tools } = mapToTools(graph);
    expect(tools.map((t) => t.name)).toEqual(['get_recipe']);
    expect(await run(tools[0]!)).toMatchObject({ type: 'Recipe', name: 'Carbonara' });
  });

  it('applies the profile for the type and follows from', async () => {
    const graph = graphOf(
      '{"@type":"Product","name":"Zaino","sku":"ZT-45-BLU","description":"da escursione",' +
        '"offers":{"@type":"Offer","price":"129.90","priceCurrency":"EUR"}}'
    );
    const { tools } = mapToTools(graph, { profiles: [productProfile] });

    expect(tools.map((t) => t.name)).toEqual(['get_product', 'get_product_offer']);
    // `pick` really does limit the fields, so description must not show up
    expect(await run(tools[0]!)).toEqual({ type: 'Product', name: 'Zaino', sku: 'ZT-45-BLU' });
    expect(await run(tools[1]!)).toMatchObject({ price: '129.90', priceCurrency: 'EUR' });
  });

  it('skips ReadSpecs whose from property is missing', () => {
    const graph = graphOf('{"@type":"Product","name":"Zaino"}');
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    // no offers and no review, so only the main tool survives
    expect(tools.map((t) => t.name)).toEqual(['get_product']);
  });

  it('returns every item when list is set', async () => {
    const graph = graphOf(
      '{"@type":"Product","name":"Zaino","review":[' +
        '{"@type":"Review","name":"ottimo"},{"@type":"Review","name":"buono"}]}'
    );
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    const reviews = tools.find((t) => t.name === 'get_product_reviews')!;
    expect(await run(reviews)).toHaveLength(2);
  });

  it('inherits an ancestor profile through ancestorsOf', () => {
    const graph = graphOf('{"@type":"Vehicle","name":"Panda","sku":"FP-2020"}');
    const ancestorsOf = (type: string) => (type === 'Vehicle' ? ['Product', 'Thing'] : []);

    const senza = mapToTools(graph, { profiles: [productProfile] });
    const con = mapToTools(graph, { profiles: [productProfile], ancestorsOf });

    expect(senza.tools.map((t) => t.name)).toEqual(['get_vehicle']); // generico
    expect(con.tools.map((t) => t.name)).toEqual(['get_product']); // ereditato
  });

  it('marks read tools as readOnly', () => {
    const graph = graphOf('{"@type":"Product","name":"Zaino"}');
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    expect(tools[0]!.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tools[0]!.source.kind).toBe('read');
  });

  it('collapses secondary entities of one type into a single tool', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `{"@type":"Product","name":"P${i}"}`).join(',');
    const graph = graphOf(`{"@context":"https://schema.org","@graph":[${many}]}`);

    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    // The subject of the page stays on its own. The other 29 share one tool.
    expect(tools.map((t) => t.name)).toEqual(['get_product', 'list_product']);

    const list = (await run(tools[1]!)) as unknown[];
    expect(list).toHaveLength(29);
  });

  it('respects the tool cap and says when it hit it', () => {
    // Distinct types do not group, so the cap is actually reachable here.
    const types = ['Recipe', 'Event', 'Book', 'Movie', 'Course', 'Dataset', 'HowTo', 'JobPosting'];
    const many = types.map((t, i) => `{"@type":"${t}","name":"E${i}"}`).join(',');
    const graph = graphOf(`{"@context":"https://schema.org","@graph":[${many}]}`);

    const { tools, diagnostics } = mapToTools(graph, { maxTools: 5 });
    expect(tools).toHaveLength(5);
    expect(diagnostics.map((d) => d.code)).toContain('tool-limit');
  });

  it('puts the primary entity first so the cap cannot cut it out', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"BreadcrumbList","@id":"#bc"},' +
        '{"@type":"Organization","@id":"#org"},' +
        '{"@type":"WebPage","@id":"#page","mainEntity":{"@id":"#p"}},' +
        '{"@type":"Product","@id":"#p","name":"Zaino"}]}'
    );
    const { tools } = mapToTools(graph, { maxTools: 1 });
    expect(tools[0]!.source.entityType).toBe('Product');
  });

  it('disambiguates colliding names', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]}'
    );
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    expect(tools.map((t) => t.name)).toEqual(['get_product', 'get_product_2']);
  });

  it('spends no tool slots on page chrome', () => {
    // What a CMS puts in the @graph of an ordinary article page. Only the
    // Article is worth asking about; the rest is the theme describing itself.
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"Article","headline":"Come scegliere lo zaino"},' +
        '{"@type":"WebPage","name":"Come scegliere lo zaino"},' +
        '{"@type":"WPHeader","cssSelector":"#masthead"},' +
        '{"@type":"WPFooter","cssSelector":"#colophon"},' +
        '{"@type":"WPSideBar","cssSelector":"#secondary"},' +
        '{"@type":"SiteNavigationElement","name":"Home"},' +
        '{"@type":"SiteNavigationElement","name":"Blog"}]}'
    );
    const { tools } = mapToTools(graph, {});
    expect(tools.map((t) => t.name)).toEqual(['get_article']);
  });

  it('still exposes a page wrapper when the page has nothing else', () => {
    // Suppressing chrome must not leave a page with no tools at all: the
    // primary entity is chosen before the filter and never subject to it.
    const graph = graphOf('{"@context":"https://schema.org","@type":"WebPage","name":"Chi siamo"}');
    expect(mapToTools(graph, {}).tools.map((t) => t.name)).toEqual(['get_web_page']);
  });
});

describe('materialize', () => {
  it('does not loop on mutual references', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"Product","@id":"#a","name":"A","isRelatedTo":{"@id":"#b"}},' +
        '{"@type":"Product","@id":"#b","name":"B","isRelatedTo":{"@id":"#a"}}]}'
    );
    const result = materialize(graph, graph.nodes.get('#a')!);
    // the cycle closes on an identifier rather than recursing forever
    expect(JSON.stringify(result)).toContain('"id":"#a"');
  });
});

describe('toSlug', () => {
  it('converts schema.org types to snake_case', () => {
    expect(toSlug('Product')).toBe('product');
    expect(toSlug('LocalBusiness')).toBe('local_business');
    expect(toSlug('FAQPage')).toBe('faq_page');
  });

  it('splits acronyms only where a capitalised word starts', () => {
    expect(toSlug('XMLHttpRequest')).toBe('xml_http_request');
    expect(toSlug('PDFViewerApp')).toBe('pdf_viewer_app');
    expect(toSlug('ABCd')).toBe('ab_cd');
    expect(toSlug('HTML')).toBe('html');
    expect(toSlug('IoT')).toBe('io_t');
  });

  it('collapses separators and trims the edges, keeping inner underscores', () => {
    expect(toSlug('  Product  ')).toBe('product');
    expect(toSlug('Product-2')).toBe('product_2');
    expect(toSlug('esempio.test')).toBe('esempio_test');
    expect(toSlug('a__b')).toBe('a__b');
    expect(toSlug('___')).toBe('');
    expect(toSlug('')).toBe('');
  });

  // `@type` arrives from the page, so a hostile document picks this input. Both
  // the acronym split and the edge trim used to backtrack quadratically: 50k
  // characters took ~6s each, which is a denial of service on the mapper.
  it('stays linear on hostile input', () => {
    const payloads = ['A'.repeat(50_000), `a${'_'.repeat(50_000)}a`];

    for (const payload of payloads) {
      const started = performance.now();
      toSlug(payload);
      expect(performance.now() - started).toBeLessThan(250);
    }
  });
});

/**
 * A fact one hop further down than the vocabulary suggests.
 *
 * `ProductGroup` is the case that forced this: the group node carries no
 * `offers`, every price on the page sits under `hasVariant`, and a profile that
 * can only name one property generates no price tool at all.
 */
describe('from, following a path', () => {
  const withVariants: Profile = {
    types: ['ProductGroup'],
    slug: 'product',
    read: [
      { description: 'Il gruppo di prodotti.', pick: ['name'] },
      { name: 'offer', from: 'offers', description: 'Prezzo del gruppo.' },
      {
        name: 'variant_offers',
        from: 'hasVariant.offers',
        list: true,
        description: 'Prezzo di ogni variante.',
        pick: ['price', 'priceCurrency'],
      },
    ],
  };

  const group = (variants: string) =>
    graphOf(
      `{"@context":"https://schema.org","@type":"ProductGroup","name":"Occhiali",` +
        `"hasVariant":[${variants}]}`
    );

  const build = (graph: EntityGraph) => mapToTools(graph, { profiles: [withVariants] }).tools;

  it('reaches a price two hops down, where one hop finds nothing', async () => {
    const tools = build(
      group(
        '{"@type":"Product","sku":"A","offers":{"@type":"Offer","price":49.95,"priceCurrency":"USD"}},' +
          '{"@type":"Product","sku":"B","offers":{"@type":"Offer","price":59.95,"priceCurrency":"USD"}}'
      )
    );

    // The group has no `offers` of its own, so the one-hop tool is not built.
    expect(tools.map((t) => t.name)).not.toContain('get_product_offer');

    const variants = tools.find((t) => t.name === 'get_product_variant_offers');
    expect(variants).toBeDefined();
    expect(await run(variants!)).toEqual([
      { type: 'Offer', price: 49.95, priceCurrency: 'USD' },
      { type: 'Offer', price: 59.95, priceCurrency: 'USD' },
    ]);
  });

  it('returns one offer once, however many variants point at it', async () => {
    // Thirteen colours in one size share a single price node. Left
    // undeduplicated, an agent is handed the same price thirteen times and has
    // to work out for itself that they are one offer.
    const tools = build(
      group(
        '{"@type":"Product","sku":"A","offers":{"@id":"#o"}},' +
          '{"@type":"Product","sku":"B","offers":{"@id":"#o"}},' +
          '{"@type":"Offer","@id":"#o","price":49.95,"priceCurrency":"USD"}'
      )
    );

    const variants = tools.find((t) => t.name === 'get_product_variant_offers');
    expect(await run(variants!)).toEqual([{ type: 'Offer', price: 49.95, priceCurrency: 'USD' }]);
  });

  it('builds no tool when a hop along the way is missing', () => {
    // A group whose variants carry no offers has no prices to show, and a tool
    // answering `{}` would be worse than an absent one: it says the page has a
    // price and then does not give it.
    const tools = build(group('{"@type":"Product","sku":"A"}'));
    expect(tools.map((t) => t.name)).not.toContain('get_product_variant_offers');
  });

  const ratingCandidates: Profile = {
    types: ['Product', 'ProductGroup'],
    slug: 'product',
    read: [
      { description: 'Il prodotto.', pick: ['name'] },
      {
        name: 'rating',
        from: ['aggregateRating', 'isVariantOf.aggregateRating'],
        description: 'Voto medio.',
      },
    ],
  };

  const variantOf = (own: string) =>
    graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        `{"@type":"Product","name":"Zaino","isVariantOf":{"@id":"#g"}${own}},` +
        '{"@type":"ProductGroup","@id":"#g","name":"Zaini",' +
        '"aggregateRating":{"@type":"AggregateRating","ratingValue":4.4}}]}'
    );

  it('takes the first candidate that resolves, and only that one', async () => {
    // A page carrying the fact in both places produced two tools with one
    // description and no way to choose between them. Order is the profile
    // saying which source it trusts.
    const tools = mapToTools(
      variantOf(',"aggregateRating":{"@type":"AggregateRating","ratingValue":4.9}'),
      { profiles: [ratingCandidates] }
    ).tools;

    expect(tools.filter((t) => t.name.startsWith('get_product_rating'))).toHaveLength(1);
    expect(await run(tools.find((t) => t.name === 'get_product_rating')!)).toMatchObject({
      ratingValue: 4.9,
    });
  });

  it('falls through to the next candidate when the first finds nothing', async () => {
    const tools = mapToTools(variantOf(''), { profiles: [ratingCandidates] }).tools;
    expect(await run(tools.find((t) => t.name === 'get_product_rating')!)).toMatchObject({
      ratingValue: 4.4,
    });
  });

  it('counts an entity a path passes through as already described', () => {
    // Reaching the group's rating through `isVariantOf` speaks for the group
    // too. Left unconsumed it came back as a tool of its own, word for word the
    // description of the first.
    const names = mapToTools(variantOf(''), { profiles: [ratingCandidates] }).tools.map(
      (t) => t.name
    );
    expect(names.filter((n) => n.startsWith('get_product'))).toEqual([
      'get_product',
      'get_product_rating',
    ]);
  });

  it('leaves a single-name from exactly as it was', async () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@type":"Product","name":"Zaino",' +
        '"offers":{"@type":"Offer","price":129.9,"priceCurrency":"EUR"}}'
    );
    const tools = mapToTools(graph, { profiles: [productProfile] }).tools;
    const offer = tools.find((t) => t.name === 'get_product_offer');
    expect(await run(offer!)).toMatchObject({ price: 129.9, priceCurrency: 'EUR' });
  });
});

// ---------------------------------------------------------------------------

describe('token efficiency, list_* filtering/pagination, and universal scrape()', () => {
  it('supports query, limit and offset on list_* group tools', async () => {
    const many = [
      '{"@type":"Product","name":"Scarpa Corsa"}',
      '{"@type":"Product","name":"Zaino Montagna 30L"}',
      '{"@type":"Product","name":"Zaino Trekking 45L"}',
      '{"@type":"Product","name":"Tenda Bivacco"}',
      '{"@type":"Product","name":"Zaino Urbano 20L"}',
    ].join(',');
    const graph = graphOf(`{"@context":"https://schema.org","@graph":[${many}]}`);
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    const listTool = tools.find((t) => t.name === 'list_product')!;

    const filtered = JSON.parse(
      (await listTool.execute({ query: 'zaino', limit: 2, offset: 0 })).content[0]!.text
    ) as Array<{ name: string }>;
    expect(filtered).toHaveLength(2);
    expect(filtered.every((item) => item.name.toLowerCase().includes('zaino'))).toBe(true);

    const paged = JSON.parse(
      (await listTool.execute({ query: 'zaino', limit: 2, offset: 2 })).content[0]!.text
    ) as Array<{ name: string }>;
    expect(paged).toHaveLength(1);
    expect(paged[0]!.name).toBe('Zaino Urbano 20L');
  });

  it('marks transitively materialized child entities as consumed so they do not spawn duplicate tools', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"Recipe","@id":"#r","name":"Carbonara","author":{"@id":"#p"},"image":{"@id":"#img"}},' +
        '{"@type":"Person","@id":"#p","name":"Marco"},' +
        '{"@type":"ImageObject","@id":"#img","url":"https://esempio.test/c.jpg"}]}'
    );
    const { tools } = mapToTools(graph, {});
    expect(tools.map((t) => t.name)).toEqual(['get_recipe']);
  });

  it('matches profiles case-insensitively when @type has lowercase initial', () => {
    const graph = graphOf('{"@type":"product","name":"Zaino","sku":"Z1"}');
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    expect(tools.map((t) => t.name)).toEqual(['get_product']);
  });

  it('synthesizes structured entities and SearchAction from OpenGraph, meta tags, and search forms when fallback: true', () => {
    const html = `<!doctype html><html lang="it"><head>
      <title>Zaino Alpinismo Pro</title>
      <link rel="canonical" href="https://negozio.test/zaino-pro">
      <meta property="og:type" content="product">
      <meta property="og:title" content="Zaino Alpinismo Pro 50L">
      <meta property="og:description" content="Impermeabile e ultraleggero.">
      <meta property="product:price:amount" content="189.00">
      <meta property="product:price:currency" content="EUR">
    </head><body>
      <form action="/ricerca" method="get">
        <input type="search" name="q">
      </form>
    </body></html>`;

    const meta = extractMeta(html);
    expect(meta.title).toBe('Zaino Alpinismo Pro 50L');
    expect(meta.openGraph['og:type']).toBe('product');

    const result = scrape(html, { baseUrl: 'https://negozio.test/zaino-pro', fallback: true });
    expect(result.primary).toMatchObject({
      type: 'Product',
      name: 'Zaino Alpinismo Pro 50L',
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.required).toEqual(['q']);
  });

  it('toContext() builds a 1-turn hybrid context with deduplicated prose, <dl>/<table> specs, and byline/cloaking detection', () => {
    const repeatedDescription =
      'Questo zaino impermeabile da 50 litri è progettato per le spedizioni invernali più estreme in alta quota.';
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": "Nuovo record sul K2 in invernale",
        "author": {"@type": "Organization", "name": "Al Jazeera"},
        "description": "${repeatedDescription}"
      }</script>
    </head><body>
      <article>
        <h1>Nuovo record sul K2 in invernale</h1>
        <p>By AFP — La spedizione ha raggiunto la vetta alle 14:30 ora locale con venti a 60 km/h.</p>
        <p>${repeatedDescription}</p>
        <dl>
          <dt>Quota vetta</dt><dd>8611 m</dd>
          <dt>Temperatura</dt><dd>-42 °C</dd>
        </dl>
      </article>
    </body></html>`;

    const ctx = toContext(html, { baseUrl: 'https://news.test/k2' });
    expect(ctx.visibleByline).toBe('AFP');
    expect(ctx.discrepancies.some((d) => d.includes('Al Jazeera') && d.includes('AFP'))).toBe(true);
    expect(ctx.specs['Quota vetta']).toBe('8611 m');
    expect(ctx.specs['Temperatura']).toBe('-42 °C');
    // The description already in JSON-LD is removed from the prose so the LLM never pays for it twice
    expect(ctx.prose).not.toContain(repeatedDescription);
    // Prose-only facts survive in the deduplicated main content
    expect(ctx.prose).toContain('14:30 ora locale');
    expect(ctx.context).toContain('## Discrepancy Warnings');
    expect(ctx.context).toContain('## Technical Specifications');
  });

  it('extracts __NEXT_DATA__ hydration state and zero-DOM Microdata/RDFa from raw HTML strings', () => {
    const nextHtml = `<!doctype html><html><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            product: {
              name: 'Giacca Guscio Gore-Tex',
              price: 349.0,
              currency: 'EUR',
              sku: 'GTX-99',
            },
          },
        },
      })}</script>
    </body></html>`;

    const hydration = extractHydrationData(nextHtml);
    expect(hydration).toMatchObject({
      name: 'Giacca Guscio Gore-Tex',
      price: 349,
      currency: 'EUR',
      sku: 'GTX-99',
    });

    const microdataHtml = `<div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">Ramponi 12 Punte</span>
      <meta itemprop="sku" content="RMP-12">
    </div>`;
    expect(extractZeroDomNodes(microdataHtml)).toHaveLength(1);
    const ctx = toContext(microdataHtml);
    expect(ctx.primary).toMatchObject({ type: 'Product', name: 'Ramponi 12 Punte', sku: 'RMP-12' });
    expect(extractSpecs('<dl><dt>Peso</dt><dd>480 g</dd></dl>')).toEqual({ Peso: '480 g' });
  });

  it('applies Submodular Information Bottleneck (query + tokenBudget) to project only query-relevant fields and sentences', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Giacca Alpinismo 3L",
        "sku": "GA-3L-99",
        "color": "Blu Artico",
        "material": "Gore-Tex Pro 3 strati",
        "offers": {"@type": "Offer", "price": "420.00", "priceCurrency": "EUR"},
        "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "88"}
      }</script>
    </head><body>
      <article>
        <p>La storia del nostro marchio inizia nel 1974 sulle Dolomiti con un piccolo laboratorio artigianale.</p>
        <p>Tutti i nostri capi includono una garanzia a vita con riparazione gratuita in caso di rottura delle cuciture termosaldate.</p>
        <p>Consigliamo il lavaggio a 30 gradi senza ammorbidente per preservare la membrana.</p>
      </article>
    </body></html>`;

    const full = toContext(html);
    const focused = toContext(html, {
      query: 'quanto costa e come funziona la garanzia riparazione?',
      tokenBudget: 85,
    });

    expect(focused.estimatedTokens).toBeLessThan(full.estimatedTokens);
    // Keeps price (boosted by "costa") and the warranty sentence (matched by "garanzia riparazione")
    expect(focused.context).toContain('420.00');
    expect(focused.prose).toContain('garanzia a vita');
    // Drops irrelevant history and washing paragraphs under the tight token budget
    expect(focused.prose).not.toContain('1974 sulle Dolomiti');
  });

  it('computes 64-bit SimHash fingerprints with small Hamming distance on near-duplicate text', () => {
    const h1 = simhash64('La spedizione invernale ha raggiunto la vetta del K2 alle 14:30 con venti forti.');
    const h2 = simhash64('La spedizione invernale ha raggiunto la vetta del K2 alle 14:30 con vento forte.');
    const h3 = simhash64('Ricetta della pasta alla carbonara con guanciale croccante e pecorino romano.');

    expect(h1).toHaveLength(16);
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(10);
    expect(hammingDistance(h1, h3)).toBeGreaterThan(15);
  });

  it('fusePages() resolves Bayesian consensus & conflicts across same-entity pages, and builds a Comparison Matrix across distinct entities', () => {
    const sharedWireParagraph =
      'Il dispositivo utilizza una batteria al silicio-carbonio da 6000 mAh con ricarica rapida a 100W.';
    const page1 = `<!doctype html><html><head>
      <link rel="canonical" href="https://store-a.test/phone">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"NovaPhone X","sku":"NP-X","offers":{"@type":"Offer","price":"799.00"}}</script>
    </head><body><p>Prezzo ufficiale 799.00 EUR disponibile subito.</p><p>${sharedWireParagraph}</p></body></html>`;

    const page2 = `<!doctype html><html><head>
      <link rel="canonical" href="https://store-b.test/phone">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"NovaPhone X","sku":"NP-X","offers":{"@type":"Offer","price":"799.00"}}</script>
    </head><body><p>In vendita a 799.00 EUR con spedizione gratuita.</p><p>${sharedWireParagraph}</p></body></html>`;

    // Page 3 has an unverified/outdated price in JSON-LD (899.00)
    const page3 = `<!doctype html><html><head>
      <link rel="canonical" href="https://old-blog.test/phone">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"NovaPhone X","sku":"NP-X","offers":{"@type":"Offer","price":"899.00"}}</script>
    </head><body><p>Articolo di anteprima dello scorso anno.</p><p>${sharedWireParagraph}</p></body></html>`;

    const consensusResult = fusePages([page1, page2, page3]);
    expect(consensusResult.mode).toBe('consensus');
    // 799.00 wins by Bayesian confidence (2 verified sources = 4.0 vs 1 unverified source = 1.0)
    expect(JSON.stringify(consensusResult.consensus?.['offers'])).toContain('799.00');
    expect(consensusResult.conflicts.some((c) => c.field === 'offers')).toBe(true);
    // The syndicated wire paragraph appears only once across all 3 pages, citing all 3 sources
    expect(consensusResult.passages.filter((p) => p.text.includes('6000 mAh'))).toHaveLength(1);
    expect(consensusResult.passages.find((p) => p.text.includes('6000 mAh'))!.sources).toHaveLength(3);

    // Distinct entities -> Comparison Matrix mode
    const prodA = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tenda Alpha 2","weight":"1.4 kg"}</script>`;
    const prodB = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tenda Beta 3","weight":"2.1 kg"}</script>`;
    const matrixResult = fusePages([prodA, prodB]);
    expect(matrixResult.mode).toBe('comparison');
    expect(matrixResult.comparisonTable).toContain('Tenda Alpha 2');
    expect(matrixResult.comparisonTable).toContain('Tenda Beta 3');
    expect(matrixResult.comparisonTable).toContain('1.4 kg');
    expect(matrixResult.comparisonTable).toContain('2.1 kg');
  });

  it('distils Surprisal-Driven Epistemic Atoms, Temporal Light-Cone, Machine Twins, and Epistemic Frontier', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://shop.example.com/products/quantum-battery">
      <link rel="alternate" type="application/json" href="https://shop.example.com/wp-json/wp/v2/posts/99">
      <meta property="og:type" content="product">
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "QuantumCell 5000",
        "datePublished": "2022-03-10",
        "offers": {
          "@type": "Offer",
          "price": "149.00",
          "priceValidUntil": "2023-12-31"
        }
      }</script>
    </head><body>
      <nav><a href="/login">Sign in</a><a href="/privacy">Privacy Policy</a></nav>
      <article>
        <p>Furthermore, it is important to note that the cell achieves 420 Wh/kg energy density at -20°C and is not compatible with legacy NiMH chargers.</p>
        <p>The product is currently the fastest charging pack this year in our lineup.</p>
        <p>Read the <a href="/docs/quantumcell-datasheet.pdf">Full Technical Datasheet (PDF)</a> or inspect the <a href="https://arxiv.org/abs/2401.00001">peer-reviewed anode study</a>.</p>
      </article>
    </body></html>`;

    const l0 = toContext(html, {
      baseUrl: 'https://shop.example.com/products/quantum-battery',
      resolution: 'L0',
      referenceNow: '2026-10-25T00:00:00Z',
    });

    // 1. L0 Holographic Pulse is hyper-compact (~35 tokens) and encodes type, price, expiry warning, atoms, and twin
    expect(l0.context).toContain('[L0 Product] QuantumCell 5000');
    expect(l0.context).toContain('price=149.00');
    expect(l0.context).toContain('⚠️EXPIRED_OFFER');
    expect(l0.context).toContain('420 Wh/kg');
    expect(l0.estimatedTokens).toBeLessThan(70);

    // 2. Relativistic Temporal Cone catches expired priceValidUntil and unanchored deictics ("currently", "this year") in a 2022 doc
    expect(l0.temporal.isExpiredOffer).toBe(true);
    expect(l0.temporal.hasUnanchoredDeictics).toBe(true);
    expect(l0.temporal.anchorWarning).toContain('2023-12-31');
    expect(l0.temporal.anchorWarning).toContain('2022-03-10');

    // 3. Surprisal-Driven Epistemic Atoms strip "Furthermore, it is important to note that"
    expect(l0.atoms.length).toBeGreaterThan(0);
    expect(l0.atoms[0]!.claim).not.toMatch(/^Furthermore/i);
    expect(l0.atoms[0]!.claim).toContain('420 Wh/kg');

    // 4. Shadow API & Machine-Twin Autodiscovery finds both WP JSON and canonical Shopify-style .json product twin
    expect(l0.machineTwins.map((t) => t.url)).toContain(
      'https://shop.example.com/wp-json/wp/v2/posts/99'
    );
    expect(l0.machineTwins.map((t) => t.url)).toContain(
      'https://shop.example.com/products/quantum-battery.json'
    );

    // 5. Epistemic Frontier keeps the PDF datasheet & arXiv study and drops /login and /privacy
    const frontierUrls = l0.frontier.map((f) => f.url);
    expect(frontierUrls).toContain('https://shop.example.com/docs/quantumcell-datasheet.pdf');
    expect(frontierUrls).toContain('https://arxiv.org/abs/2401.00001');
    expect(frontierUrls).not.toContain('https://shop.example.com/login');
  });

  it('foragePages() builds a Foveated Multi-Page Wavefront (foveal L1 on high-resonance pages + L0 peripheral pulses on the rest)', () => {
    const winnerPage = `<!doctype html><html><head>
      <link rel="canonical" href="https://lab.example.com/solid-state">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"SolidState Pro","offers":{"@type":"Offer","price":"299.00"}}</script>
    </head><body>
      <article>
        <p>Prezzo 299.00 EUR. Garantisce 1500 cicli di ricarica completa in 12 minuti fino a -30°C.</p>
        <a href="https://lab.example.com/specs/cycle-test.pdf">Download Cycle Test PDF</a>
      </article>
    </body></html>`;

    const peripheralPage1 = `<!doctype html><html><head>
      <link rel="canonical" href="https://blog.example.com/general-tips">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"How to store batteries in winter"}</script>
    </head><body><article><p>General advice for keeping electronics warm during winter trips.</p></article></body></html>`;

    const peripheralPage2 = `<!doctype html><html><head>
      <link rel="canonical" href="https://news.example.com/market-overview">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Battery market trends"}</script>
    </head><body><article><p>Overview of global supply chain logistics.</p></article></body></html>`;

    const wave = foragePages([peripheralPage1, winnerPage, peripheralPage2], {
      query: 'cicli di ricarica rapida e temperatura -30°C',
      foveaCount: 1,
    });

    expect(wave.fovea).toHaveLength(1);
    expect(wave.fovea[0]!.url).toBe('https://lab.example.com/solid-state');
    expect(wave.periphery).toHaveLength(2);
    expect(wave.context).toContain('[FOVEA');
    expect(wave.context).toContain('1500 cicli');
    expect(wave.context).toContain('Peripheral Vision (L0 Holographic Pulses)');
    expect(wave.frontier.map((f) => f.url)).toContain(
      'https://lab.example.com/specs/cycle-test.pdf'
    );
  });

  it('builds Dual-Plane Evidence Graph with inline sigils ([✓S1], [~S2]) and Multi-Facet Query Sufficiency under hard tokenBudget', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://store.example.com/camera-x">
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Camera X Pro",
        "sku": "CAM-X-999",
        "offers": {
          "@type": "Offer",
          "price": "899.00",
          "priceCurrency": "EUR"
        },
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": "4.9",
          "reviewCount": "312"
        }
      }</script>
    </head><body>
      <main>
        <h1>Camera X Pro</h1>
        <p>Official price is 899.00 EUR with free shipping. Rated 4.9 out of 5 across 312 verified reviews.</p>
      </main>
    </body></html>`;

    const res = toContext(html, {
      baseUrl: 'https://store.example.com/camera-x',
      query: 'What is the price and what is the rating?',
      tokenBudget: 120,
    });

    // 1. Dual-Plane Evidence Graph contains structured nodes with S1:corroborated and S2:structured tiers
    const priceNode = res.evidence.find((e) => e.predicate.endsWith('price'));
    expect(priceNode).toBeDefined();
    expect(priceNode!.tier).toBe('S1:corroborated');
    expect(priceNode!.confidence.corroboration).toBeGreaterThan(0.9);

    const skuNode = res.evidence.find((e) => e.predicate.endsWith('sku'));
    expect(skuNode).toBeDefined();
    expect(skuNode!.tier).toBe('S2:structured');

    // 2. Inline sigils appear in serialized context without JSON bloat
    expect(res.context).toContain('[✓S1]');

    // 3. Multi-Facet Sufficiency covers both 'price' and 'rating' facets
    expect(res.sufficiency.facets).toEqual(expect.arrayContaining(['price', 'rating']));
    expect(res.sufficiency.coveredFacets).toEqual(expect.arrayContaining(['price', 'rating']));
    expect(res.sufficiency.verdict).toBe('ANSWERABLE');

    // 4. Hard BPE-calibrated token budget is strictly enforced
    expect(res.estimatedTokens).toBeLessThanOrEqual(120);
  });

  it('foragePages() automatically escalates L1 -> L2 when L1 leaves query facets unresolved', () => {
    // Structured JSON-LD has price, while the 'fabric' facet lives only in qualitative narrative prose
    // (without numbers, constraints, or temporal anchors, so L1 does not extract it as an atom and must escalate to L2)
    const pageWithDeepProse = `<!doctype html><html><head>
      <link rel="canonical" href="https://gear.example.com/pack">
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Alpine Pack",
        "offers": { "@type": "Offer", "price": "180.00" }
      }</script>
    </head><body>
      <article>
        <p>The Alpine Pack costs 180.00 EUR.</p>
        <p>Every pack is handcrafted in Bergamo from recycled ripstop cordura fabric.</p>
      </article>
    </body></html>`;

    const wave = foragePages([pageWithDeepProse], {
      query: 'What is the price and fabric?',
      foveaCount: 1,
    });

    expect(wave.escalations.some((e) => e.from === 'L1' && e.to === 'L2')).toBe(true);
    expect(wave.fovea[0]!.resolution).toBe('L2');
    expect(wave.context).toContain('recycled ripstop cordura fabric');
  });

  it('fusePages() discounts syndicated copy-clusters via SimHash so an independent corroborated source wins', () => {
    const sharedBoilerplate =
      'The ChronoWatch Titanium features sapphire crystal glass, automatic movement, brushed bezel, and water resistance for diving.';
    // Two aggregator clones with near-identical text and uncorroborated stale price 250.00
    const clone1 = `<!doctype html><html><head>
      <link rel="canonical" href="https://deals-aggregator-1.example.org/watch">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"ChronoWatch Titanium","offers":{"@type":"Offer","price":"250.00"}}</script>
    </head><body><p>${sharedBoilerplate}</p></body></html>`;
    const clone2 = `<!doctype html><html><head>
      <link rel="canonical" href="https://deals-aggregator-2.example.org/watch">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"ChronoWatch Titanium","offers":{"@type":"Offer","price":"250.00"}}</script>
    </head><body><p>${sharedBoilerplate}</p></body></html>`;

    // Official first-party brand page with distinct prose that corroborates the updated price 199.00
    const official = `<!doctype html><html><head>
      <link rel="canonical" href="https://chronowatch.com/titanium">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"ChronoWatch Titanium","offers":{"@type":"Offer","price":"199.00"}}</script>
    </head><body><article><p>Buy ChronoWatch Titanium directly from the manufacturer for 199.00 EUR with certified chronometer calibration.</p></article></body></html>`;

    const fused = fusePages([clone1, clone2, official]);
    expect(fused.mode).toBe('consensus');
    // The 2 clones are grouped into a copy cluster (independence < 1), while the official corroborated source wins
    expect(JSON.stringify(fused.consensus?.['offers'])).toContain('199.00');
  });

  it('enforces per-facet sufficiency thresholds, absence taxonomy (SATISFIED vs NOT_PUBLISHED), EVI controller, Claim-Level Bayesian Fusion, and Machine-Twin SSRF blocking', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://shop.example.com/products/tent">
      <link rel="alternate" type="application/json" href="http://127.0.0.1:8080/internal.json">
      <link rel="alternate" type="application/json" href="https://evil.example.net/exfil.json">
      <link rel="alternate" type="application/json" href="https://shop.example.com/api/tent.json">
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Ultralight Tent",
        "offers": { "@type": "Offer", "price": "399.00" }
      }</script>
    </head><body>
      <dl><dt>Weight</dt><dd>1.2 kg</dd></dl>
      <article>
        <p>The Ultralight Tent costs 399.00 EUR and is built for alpine storms.</p>
        <p>Every tent includes a repair warranty on zippers and poles.</p>
      </article>
    </body></html>`;

    // 1. At L1, 'price' and 'weight' are SATISFIED, while 'fabric' is NOT_PUBLISHED in schema -> PARTIAL_ESCALATE + ESCALATE_L2
    const l1 = toContext(html, {
      baseUrl: 'https://shop.example.com/products/tent',
      resolution: 'L1',
      query: 'What is the price, weight, and fabric?',
    });
    const priceNode = l1.evidence.find((e) => e.predicate === 'offers.price')!;
    expect(priceNode.confidence.agreement).toBe(0.92);
    expect(priceNode.confidence.agreement).toBeLessThan(1.0);
    expect(priceNode.confidence.source).toBeGreaterThan(0.7);

    const priceDiag = l1.sufficiency.facetDiagnostics.find((d) => d.facet === 'price');
    const weightDiag = l1.sufficiency.facetDiagnostics.find((d) => d.facet === 'specs' || d.facet === 'weight');
    const fabricDiag = l1.sufficiency.facetDiagnostics.find((d) => d.facet === 'fabric');
    expect(priceDiag?.status).toBe('SATISFIED');
    expect(weightDiag?.status).toBe('SATISFIED');
    expect(fabricDiag?.status).toBe('NOT_PUBLISHED');
    expect(l1.sufficiency.verdict).toBe('PARTIAL_ESCALATE');
    expect(l1.controller.action).toBe('ESCALATE_L2');
    expect(l1.controller.evi).toBeGreaterThan(0);

    // 2. Machine-Twin SSRF & Cross-Origin gate blocks 127.0.0.1 and evil.example.net, keeping only same-origin twin
    const twinUrls = l1.machineTwins.map((t) => t.url);
    expect(twinUrls).toContain('https://shop.example.com/api/tent.json');
    expect(twinUrls).not.toContain('http://127.0.0.1:8080/internal.json');
    expect(twinUrls).not.toContain('https://evil.example.net/exfil.json');

    // 3. Claim-Level SimHash Dependency + Calibrated Log-Odds Bayesian Posteriors in fusePages()
    const mfg = `<!doctype html><html><head><link rel="canonical" href="https://brand.test/laptop">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"AeroBook 14","offers":{"@type":"Offer","price":"999"}}</script>
      </head><body><dl><dt>Weight</dt><dd>1.8 kg</dd></dl><p>Official price 999 EUR. Standard chassis weight is 1.8 kg.</p></body></html>`;
    const compA = `<!doctype html><html><head><link rel="canonical" href="https://comp-a.test/laptop">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"AeroBook 14","offers":{"@type":"Offer","price":"999"}}</script>
      </head><body><dl><dt>Weight</dt><dd>1.8 kg</dd></dl><p>Official price 999 EUR. Standard chassis weight is 1.8 kg.</p></body></html>`;
    const compB = `<!doctype html><html><head><link rel="canonical" href="https://comp-b.test/laptop">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"AeroBook 14","offers":{"@type":"Offer","price":"999"}}</script>
      </head><body><dl><dt>Weight</dt><dd>2.0 kg</dd></dl><p>Official price 999 EUR. In our independent lab scale test with charger, weight measured 2.0 kg.</p></body></html>`;

    const fused = fusePages([mfg, compA, compB]);
    const weightConflict = fused.conflicts.find((c) => c.field === 'Weight');
    expect(weightConflict).toBeDefined();
    for (const v of weightConflict!.values) {
      expect(v.posterior).toBeGreaterThan(0);
      expect(v.posterior).toBeLessThanOrEqual(0.99);
    }
  });
});



