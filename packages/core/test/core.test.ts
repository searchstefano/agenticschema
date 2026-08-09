import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { extract, normalize, isRef, type Entity, type EntityGraph } from '../src/index.js';

/** Scorciatoia: HTML -> grafo, il percorso che useranno gli adapter. */
const graphOf = (html: string, baseUrl?: string): EntityGraph =>
  normalize(extract(html).nodes, baseUrl ? { baseUrl } : {});

const ldScript = (json: string) => `<script type="application/ld+json">${json}</script>`;

const docOf = (html: string): Document => {
  const window = new Window();
  window.document.write(`<!doctype html><html><body>${html}</body></html>`);
  return window.document as unknown as Document;
};

const byType = (graph: EntityGraph, type: string): Entity | undefined =>
  [...graph.nodes.values()].find((e) => e.types.includes(type));

// ---------------------------------------------------------------------------

describe('extract', () => {
  it('legge più blocchi ld+json dalla stessa pagina', () => {
    const { nodes } = extract(
      ldScript('{"@type":"Product","name":"A"}') + ldScript('{"@type":"WebSite","name":"B"}')
    );
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.format === 'jsonld')).toBe(true);
  });

  it('salta un blocco malformato senza perdere gli altri', () => {
    const { nodes, diagnostics } = extract(
      ldScript('{ questo non è json }') + ldScript('{"@type":"Product","name":"buono"}')
    );
    expect(nodes).toHaveLength(1);
    expect(diagnostics.map((d) => d.code)).toContain('json-parse-error');
  });

  it('accetta un array JSON-LD al primo livello', () => {
    const { nodes } = extract(ldScript('[{"@type":"Product"},{"@type":"Offer"}]'));
    expect(nodes).toHaveLength(2);
  });

  it('segnala quando non c-è alcun dato strutturato', () => {
    const { nodes, diagnostics } = extract('<p>niente</p>');
    expect(nodes).toHaveLength(0);
    expect(diagnostics.map((d) => d.code)).toContain('no-structured-data');
  });

  it('estrae microdata da un Document', () => {
    const doc = docOf(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Zaino Trekking 45L</span>
        <meta itemprop="sku" content="ZT-45-BLU" />
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="129.90" />
        </div>
      </div>`);
    const graph = normalize(extract(doc, { formats: ['microdata'] }).nodes);
    const product = byType(graph, 'Product');
    expect(product?.props['name']).toEqual(['Zaino Trekking 45L']);
    expect(product?.props['sku']).toEqual(['ZT-45-BLU']);
    expect(byType(graph, 'Offer')?.props['price']).toEqual(['129.90']);
  });

  it('estrae RDFa da un Document', () => {
    const doc = docOf(`
      <div typeof="schema:Product">
        <span property="name">Zaino Trekking 45L</span>
        <meta property="sku" content="ZT-45-BLU" />
      </div>`);
    const graph = normalize(extract(doc, { formats: ['rdfa'] }).nodes);
    const product = byType(graph, 'Product');
    expect(product?.props['name']).toEqual(['Zaino Trekking 45L']);
    expect(product?.props['sku']).toEqual(['ZT-45-BLU']);
  });
});

describe('normalize', () => {
  it('appiattisce @graph', () => {
    const graph = graphOf(
      ldScript('{"@context":"https://schema.org","@graph":[{"@type":"Product"},{"@type":"Offer"}]}')
    );
    expect(graph.nodes.size).toBe(2);
    expect(graph.roots).toHaveLength(2);
  });

  it('tratta @type singolo e array allo stesso modo', () => {
    const single = graphOf(ldScript('{"@type":"Product","name":"A"}'));
    const multi = graphOf(ldScript('{"@type":["Product","IndividualProduct"],"name":"A"}'));
    expect(byType(single, 'Product')?.types).toEqual(['Product']);
    expect(byType(multi, 'Product')?.types).toEqual(['Product', 'IndividualProduct']);
  });

  it('rimuove il prefisso di vocabolario da tipi e proprietà', () => {
    const graph = graphOf(
      ldScript('{"@type":"https://schema.org/Product","https://schema.org/name":"A"}')
    );
    const product = byType(graph, 'Product');
    expect(product).toBeDefined();
    expect(product?.props['name']).toEqual(['A']);
  });

  it('accetta il @context sia http sia https, e segnala quelli sconosciuti', () => {
    expect(graphOf(ldScript('{"@context":"http://schema.org","@type":"Product"}')).diagnostics)
      .toHaveLength(0);
    expect(graphOf(ldScript('{"@context":"http://www.schema.org/","@type":"Product"}')).diagnostics)
      .toHaveLength(0);
    expect(
      graphOf(ldScript('{"@context":"https://esempio.test/vocab","@type":"Product"}')).diagnostics.map(
        (d) => d.code
      )
    ).toContain('unknown-context');
  });

  it('normalizza i valori singoli in array', () => {
    const graph = graphOf(ldScript('{"@type":"Product","name":"A","keywords":["x","y"]}'));
    const product = byType(graph, 'Product');
    expect(product?.props['name']).toEqual(['A']);
    expect(product?.props['keywords']).toEqual(['x', 'y']);
  });

  it('issa le entità annidate a nodi e lascia un riferimento', () => {
    const graph = graphOf(
      ldScript('{"@type":"Product","name":"A","offers":{"@type":"Offer","price":"129.90"}}')
    );
    const product = byType(graph, 'Product');
    const offerValue = product?.props['offers']?.[0];
    expect(offerValue && isRef(offerValue)).toBe(true);

    const offer = graph.nodes.get(isRef(offerValue!) ? offerValue.ref : '');
    expect(offer?.props['price']).toEqual(['129.90']);
    // solo il Product è radice: l'Offer è referenziata
    expect(graph.roots).toEqual([product?.id]);
  });

  it('fonde due nodi con lo stesso @id invece di sovrascriverli', () => {
    const graph = graphOf(
      ldScript('{"@type":"Product","@id":"#p","name":"A"}') +
        ldScript('{"@type":"IndividualProduct","@id":"#p","sku":"ZT-45-BLU"}')
    );
    expect(graph.nodes.size).toBe(1);
    const product = byType(graph, 'Product');
    expect(product?.types).toEqual(['Product', 'IndividualProduct']);
    expect(product?.props['name']).toEqual(['A']);
    expect(product?.props['sku']).toEqual(['ZT-45-BLU']);
  });

  it('risolve gli @id relativi contro baseUrl', () => {
    const graph = graphOf(ldScript('{"@type":"Product","@id":"#p"}'), 'https://esempio.test/scarpe');
    expect([...graph.nodes.keys()]).toEqual(['https://esempio.test/scarpe#p']);
  });

  it('riduce un oggetto @value al suo valore', () => {
    const graph = graphOf(
      ldScript('{"@type":"Product","name":{"@value":"Zaino","@language":"it"}}')
    );
    expect(byType(graph, 'Product')?.props['name']).toEqual(['Zaino']);
  });

  it('risolve un riferimento puro {"@id"} senza creare un nodo vuoto', () => {
    const graph = graphOf(
      ldScript(
        '{"@context":"https://schema.org","@graph":[' +
          '{"@type":"Product","@id":"#p","offers":{"@id":"#o"}},' +
          '{"@type":"Offer","@id":"#o","price":"129.90"}]}'
      )
    );
    expect(graph.nodes.size).toBe(2);
    expect(graph.roots).toEqual(['#p']);
    expect(byType(graph, 'Offer')?.props['price']).toEqual(['129.90']);
  });

  it('tronca i riferimenti circolari invece di andare in stack overflow', () => {
    // Ciclo materializzato per annidamento (non per @id): senza guard sarebbe infinito.
    const depth = 40;
    let json = '{"@type":"Thing","name":"foglia"}';
    for (let i = 0; i < depth; i++) json = `{"@type":"Thing","subject":${json}}`;

    const graph = graphOf(ldScript(json), undefined);
    expect(graph.diagnostics.map((d) => d.code)).toContain('depth-limit');
    expect(graph.nodes.size).toBeLessThan(depth);
  });

  it('non lascia il grafo senza radici quando tutto è referenziato', () => {
    const graph = graphOf(
      ldScript('{"@context":"https://schema.org","@graph":[{"@type":"Product","@id":"#p","isRelatedTo":{"@id":"#p"}}]}')
    );
    expect(graph.roots).toEqual(['#p']);
  });
});
