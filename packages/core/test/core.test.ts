import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { extract, normalize, isRef, type Entity, type EntityGraph } from '../src/index.js';

/** Shortcut from HTML to graph, the path the adapters take. */
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
  it('reads several ld+json blocks from one page', () => {
    const { nodes } = extract(
      ldScript('{"@type":"Product","name":"A"}') + ldScript('{"@type":"WebSite","name":"B"}')
    );
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.format === 'jsonld')).toBe(true);
  });

  it('skips a malformed block without losing the others', () => {
    const { nodes, diagnostics } = extract(
      ldScript('{ questo non è json }') + ldScript('{"@type":"Product","name":"buono"}')
    );
    expect(nodes).toHaveLength(1);
    expect(diagnostics.map((d) => d.code)).toContain('json-parse-error');
  });

  it('accepts a JSON-LD array at the top level', () => {
    const { nodes } = extract(ldScript('[{"@type":"Product"},{"@type":"Offer"}]'));
    expect(nodes).toHaveLength(2);
  });

  it('says so when there is no structured data', () => {
    const { nodes, diagnostics } = extract('<p>niente</p>');
    expect(nodes).toHaveLength(0);
    expect(diagnostics.map((d) => d.code)).toContain('no-structured-data');
  });

  it('extracts microdata from a Document', () => {
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

  it('ignores RDFa terms from other vocabularies', () => {
    // RDFa is generic and MediaWiki uses it to annotate its own markup. A single
    // Wikipedia article carries over 160 typeof="mw:*" attributes, and none of
    // them describe anything worth exposing.
    const doc = docOf(`
      <span typeof="mw:Entity">&amp;</span>
      <div typeof="mw:Transclusion mw:Extension/templatestyles"></div>
      <figure typeof="mw:File/Thumb"><span property="mw:caption">didascalia</span></figure>
      <div typeof="dc:Collection"></div>
      <div typeof="schema:Product">
        <span property="name">Zaino</span>
        <span property="mw:internalNote">da ignorare</span>
      </div>`);

    const graph = normalize(extract(doc, { formats: ['rdfa'] }).nodes);
    expect([...graph.nodes.values()].map((e) => e.types[0])).toEqual(['Product']);

    const product = byType(graph, 'Product');
    expect(product?.props['name']).toEqual(['Zaino']);
    expect(product?.props['internalNote']).toBeUndefined();
  });

  it('recognises schema.org however it is written', () => {
    const forme = ['Product', 'schema:Product', 'https://schema.org/Product', 'http://schema.org/Product'];
    for (const form of forme) {
      const graph = normalize(extract(docOf(`<div typeof="${form}"></div>`), { formats: ['rdfa'] }).nodes);
      expect(byType(graph, 'Product'), form).toBeDefined();
    }
  });

  it('extracts RDFa from a Document', () => {
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
  it('flattens @graph', () => {
    const graph = graphOf(
      ldScript('{"@context":"https://schema.org","@graph":[{"@type":"Product"},{"@type":"Offer"}]}')
    );
    expect(graph.nodes.size).toBe(2);
    expect(graph.roots).toHaveLength(2);
  });

  it('treats a single @type and an array the same way', () => {
    const single = graphOf(ldScript('{"@type":"Product","name":"A"}'));
    const multi = graphOf(ldScript('{"@type":["Product","IndividualProduct"],"name":"A"}'));
    expect(byType(single, 'Product')?.types).toEqual(['Product']);
    expect(byType(multi, 'Product')?.types).toEqual(['Product', 'IndividualProduct']);
  });

  it('strips the vocabulary prefix from types and properties', () => {
    const graph = graphOf(
      ldScript('{"@type":"https://schema.org/Product","https://schema.org/name":"A"}')
    );
    const product = byType(graph, 'Product');
    expect(product).toBeDefined();
    expect(product?.props['name']).toEqual(['A']);
  });

  it('accepts @context over http or https, and flags ones it does not know', () => {
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

  it('turns single values into arrays', () => {
    const graph = graphOf(ldScript('{"@type":"Product","name":"A","keywords":["x","y"]}'));
    const product = byType(graph, 'Product');
    expect(product?.props['name']).toEqual(['A']);
    expect(product?.props['keywords']).toEqual(['x', 'y']);
  });

  it('hoists nested entities into nodes and leaves a reference behind', () => {
    const graph = graphOf(
      ldScript('{"@type":"Product","name":"A","offers":{"@type":"Offer","price":"129.90"}}')
    );
    const product = byType(graph, 'Product');
    const offerValue = product?.props['offers']?.[0];
    expect(offerValue && isRef(offerValue)).toBe(true);

    const offer = graph.nodes.get(isRef(offerValue!) ? offerValue.ref : '');
    expect(offer?.props['price']).toEqual(['129.90']);
    // Only the Product is a root. The Offer is referenced, so it is not.
    expect(graph.roots).toEqual([product?.id]);
  });

  it('merges two nodes sharing an @id instead of overwriting one', () => {
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

  it('resolves relative @id values against baseUrl', () => {
    const graph = graphOf(ldScript('{"@type":"Product","@id":"#p"}'), 'https://esempio.test/scarpe');
    expect([...graph.nodes.keys()]).toEqual(['https://esempio.test/scarpe#p']);
  });

  it('collapses an @value object down to its value', () => {
    const graph = graphOf(
      ldScript('{"@type":"Product","name":{"@value":"Zaino","@language":"it"}}')
    );
    expect(byType(graph, 'Product')?.props['name']).toEqual(['Zaino']);
  });

  it('resolves a bare {"@id"} reference without creating an empty node', () => {
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

  it('truncates circular references instead of blowing the stack', () => {
    // A cycle built out of nesting rather than @id. Without the depth guard this never ends.
    const depth = 40;
    let json = '{"@type":"Thing","name":"foglia"}';
    for (let i = 0; i < depth; i++) json = `{"@type":"Thing","subject":${json}}`;

    const graph = graphOf(ldScript(json), undefined);
    expect(graph.diagnostics.map((d) => d.code)).toContain('depth-limit');
    expect(graph.nodes.size).toBeLessThan(depth);
  });

  it('still finds roots when everything turns out to be referenced', () => {
    const graph = graphOf(
      ldScript('{"@context":"https://schema.org","@graph":[{"@type":"Product","@id":"#p","isRelatedTo":{"@id":"#p"}}]}')
    );
    expect(graph.roots).toEqual(['#p']);
  });
});
