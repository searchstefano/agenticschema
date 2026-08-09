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

/** Esegue un tool e restituisce il payload JSON già parsato. */
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
  it('segue mainEntity di una pagina', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"WebPage","@id":"#page","mainEntity":{"@id":"#p"}},' +
        '{"@type":"Product","@id":"#p","name":"Zaino"}]}'
    );
    expect(selectPrimary(graph)).toBe('#p');
  });

  it('tratta il nodo con mainEntityOfPage come primario (la freccia punta al contrario)', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"WebPage","@id":"#page"},' +
        '{"@type":"Article","@id":"#a","mainEntityOfPage":{"@id":"#page"}}]}'
    );
    expect(selectPrimary(graph)).toBe('#a');
  });

  it('scarta il contorno e sceglie il soggetto vero', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"BreadcrumbList","@id":"#bc"},' +
        '{"@type":"Organization","@id":"#org","name":"Altavia"},' +
        '{"@type":"WebSite","@id":"#site"},' +
        '{"@type":"Product","@id":"#p","name":"Zaino"}]}'
    );
    expect(selectPrimary(graph)).toBe('#p');
  });

  it('usa about quando è l-unico segnale', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"WebPage","@id":"#page","about":{"@id":"#e"}},' +
        '{"@type":"Event","@id":"#e","name":"Concerto"}]}'
    );
    expect(selectPrimary(graph)).toBe('#e');
  });
});

describe('mapToTools', () => {
  it('genera un tool anche senza profili, via fallback generico', async () => {
    const graph = graphOf('{"@type":"Recipe","name":"Carbonara","recipeYield":"4"}');
    const { tools } = mapToTools(graph);
    expect(tools.map((t) => t.name)).toEqual(['get_recipe']);
    expect(await run(tools[0]!)).toMatchObject({ type: 'Recipe', name: 'Carbonara' });
  });

  it('applica il profilo del tipo e naviga in from', async () => {
    const graph = graphOf(
      '{"@type":"Product","name":"Zaino","sku":"ZT-45-BLU","description":"da escursione",' +
        '"offers":{"@type":"Offer","price":"129.90","priceCurrency":"EUR"}}'
    );
    const { tools } = mapToTools(graph, { profiles: [productProfile] });

    expect(tools.map((t) => t.name)).toEqual(['get_product', 'get_product_offer']);
    // `pick` limita davvero i campi: description non deve comparire
    expect(await run(tools[0]!)).toEqual({ type: 'Product', name: 'Zaino', sku: 'ZT-45-BLU' });
    expect(await run(tools[1]!)).toMatchObject({ price: '129.90', priceCurrency: 'EUR' });
  });

  it('salta le ReadSpec la cui proprietà from non esiste', () => {
    const graph = graphOf('{"@type":"Product","name":"Zaino"}');
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    // niente offers, niente review -> resta solo il tool principale
    expect(tools.map((t) => t.name)).toEqual(['get_product']);
  });

  it('restituisce tutti gli elementi quando list è attivo', async () => {
    const graph = graphOf(
      '{"@type":"Product","name":"Zaino","review":[' +
        '{"@type":"Review","name":"ottimo"},{"@type":"Review","name":"buono"}]}'
    );
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    const reviews = tools.find((t) => t.name === 'get_product_reviews')!;
    expect(await run(reviews)).toHaveLength(2);
  });

  it('eredita il profilo di un antenato tramite ancestorsOf', () => {
    const graph = graphOf('{"@type":"Vehicle","name":"Panda","sku":"FP-2020"}');
    const ancestorsOf = (type: string) => (type === 'Vehicle' ? ['Product', 'Thing'] : []);

    const senza = mapToTools(graph, { profiles: [productProfile] });
    const con = mapToTools(graph, { profiles: [productProfile], ancestorsOf });

    expect(senza.tools.map((t) => t.name)).toEqual(['get_vehicle']); // generico
    expect(con.tools.map((t) => t.name)).toEqual(['get_product']); // ereditato
  });

  it('marca i tool di lettura come readOnly', () => {
    const graph = graphOf('{"@type":"Product","name":"Zaino"}');
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    expect(tools[0]!.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tools[0]!.source.kind).toBe('read');
  });

  it('collassa le entità secondarie dello stesso tipo in un solo tool', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `{"@type":"Product","name":"P${i}"}`).join(',');
    const graph = graphOf(`{"@context":"https://schema.org","@graph":[${many}]}`);

    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    // Il soggetto della pagina resta separato; gli altri 29 in un tool solo.
    expect(tools.map((t) => t.name)).toEqual(['get_product', 'list_product']);

    const list = (await run(tools[1]!)) as unknown[];
    expect(list).toHaveLength(29);
  });

  it('rispetta il tetto sul numero di tool e lo dichiara', () => {
    // Tipi distinti: non si raggruppano, quindi il cap è davvero raggiungibile.
    const types = ['Recipe', 'Event', 'Book', 'Movie', 'Course', 'Dataset', 'HowTo', 'JobPosting'];
    const many = types.map((t, i) => `{"@type":"${t}","name":"E${i}"}`).join(',');
    const graph = graphOf(`{"@context":"https://schema.org","@graph":[${many}]}`);

    const { tools, diagnostics } = mapToTools(graph, { maxTools: 5 });
    expect(tools).toHaveLength(5);
    expect(diagnostics.map((d) => d.code)).toContain('tool-limit');
  });

  it('mette per primi i tool dell-entità primaria, così il cap non la taglia fuori', () => {
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

  it('disambigua i nomi in collisione', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]}'
    );
    const { tools } = mapToTools(graph, { profiles: [productProfile] });
    expect(tools.map((t) => t.name)).toEqual(['get_product', 'get_product_2']);
  });
});

describe('materialize', () => {
  it('non entra in loop sui riferimenti reciproci', () => {
    const graph = graphOf(
      '{"@context":"https://schema.org","@graph":[' +
        '{"@type":"Product","@id":"#a","name":"A","isRelatedTo":{"@id":"#b"}},' +
        '{"@type":"Product","@id":"#b","name":"B","isRelatedTo":{"@id":"#a"}}]}'
    );
    const result = materialize(graph, graph.nodes.get('#a')!);
    // il ciclo si chiude con un identificatore, non con una ricorsione infinita
    expect(JSON.stringify(result)).toContain('"id":"#a"');
  });
});

describe('toSlug', () => {
  it('converte i tipi schema.org in snake_case', () => {
    expect(toSlug('Product')).toBe('product');
    expect(toSlug('LocalBusiness')).toBe('local_business');
    expect(toSlug('FAQPage')).toBe('faq_page');
  });
});
