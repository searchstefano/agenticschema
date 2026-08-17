import { describe, expect, it } from 'vitest';
import {
  extract,
  mapToTools,
  materialize,
  normalize,
  selectPrimary,
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
