/**
 * The text of a page: what the `text` arm is given, and what the answer key is
 * written from.
 *
 * Script, style, noscript and template elements out, then `textContent`, then
 * whitespace collapsed. Roughly what a readability-style scraper produces, and
 * exactly what `test:corpus` already counts tokens for — the arm and the
 * measurement have to be the same text or the token table describes a different
 * benchmark from the one that ran.
 *
 * The DOM comes from `@agenticschema/server`'s own `parseDocument`, and that is
 * not a convenience: happy-dom fetches what a page points at unless every
 * loading setting is turned off, and these are real pages carrying thousands of
 * stylesheet, image and iframe references. Building a Window here would be a
 * second copy of those settings to keep right, and the corpus has already been
 * through one run where a copy drifted and fired thousands of live requests at
 * the sites it exists to leave alone.
 */
import { BOILERPLATE_TYPES, extract, normalize } from '@agenticschema/core';
import { parseDocument } from '@agenticschema/server';

const STRIPPED = 'script, style, noscript, template';
const LD_JSON = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Long enough for any real page's markup, short enough to stay a prompt. */
const STRUCTURED_LIMIT = 40_000;

/**
 * Everything the harness needs from a page, out of a single parse.
 *
 * Parsing is the expensive part — happy-dom on a 300 KB shop page takes
 * seconds — and all three outputs are wanted together, so they are produced
 * together.
 *
 *   text        what the `text` arm is given, and what the text-derived key is
 *               written from
 *   structured  what the page publishes as data, for the neutral key
 *   mappable    whether the page publishes anything beyond its own furniture
 */
export async function readPage(html) {
  const document = parseDocument(html);
  try {
    // Read before the scripts are stripped: the JSON-LD lives inside them.
    const graph = normalize(extract(document).nodes);
    const structured = structuredOf(html, graph);
    const mappable = mappableOf(graph);

    for (const element of [...document.querySelectorAll(STRIPPED)]) element.remove();
    const text = (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();

    return { text, structured, mappable };
  } finally {
    // Otherwise every page parsed leaves a Window behind, and a run parses
    // hundreds of them inside one process.
    await document.defaultView?.happyDOM?.close?.();
  }
}

/** For callers that want only the text. */
export async function pageText(html) {
  return (await readPage(html)).text;
}

/**
 * What the page publishes as data, for a key that is not written from the prose
 * alone.
 *
 * Two halves, and the difference between them matters. The JSON-LD is taken
 * verbatim out of the HTML, so a fact this library fails to expose is still in
 * the key and the tools arm is still marked down for missing it — which is the
 * entire point of scoring against something other than your own output.
 *
 * The second half is the normalised graph, and it is here because a quarter of
 * this corpus publishes microdata or RDFa and nothing else: without it those
 * pages would have an empty structured half and the neutral key would collapse
 * back into the text one. It comes through this library's own parser, so a bug
 * in `extract` hides in the key rather than being caught by it. That is a real
 * limit of the measurement, written down rather than papered over.
 */
function structuredOf(html, graph) {
  const blocks = [...html.matchAll(LD_JSON)].map((match) => match[1].trim()).filter(Boolean);
  const entities = [...graph.nodes.values()]
    .filter((entity) => entity.types.length > 0)
    .map((entity) => ({ type: entity.types, ...plain(entity.props) }));

  const parts = [];
  if (blocks.length > 0) parts.push(`JSON-LD as the page publishes it:\n${blocks.join('\n')}`);
  if (entities.length > 0) {
    parts.push(
      'Structured data parsed from the page (JSON-LD, microdata and RDFa):\n' +
        JSON.stringify(entities, null, 2)
    );
  }

  const joined = parts.join('\n\n');
  return joined.length > STRUCTURED_LIMIT
    ? `${joined.slice(0, STRUCTURED_LIMIT)}\n[truncated]`
    : joined;
}

/** References left as their target's id: the key needs the facts, not the graph. */
const plain = (props) =>
  Object.fromEntries(
    Object.entries(props).map(([key, values]) => [
      key,
      values.length === 1 ? one(values[0]) : values.map(one),
    ])
  );

const one = (value) =>
  value && typeof value === 'object' && 'ref' in value ? String(value.ref) : value;

/**
 * Whether the page publishes anything about its own subject.
 *
 * A page carrying nothing but a breadcrumb trail and a site header gives the
 * tools arm nothing to answer with, and a question put to it measures the page
 * rather than the library. Every MDN page in this corpus is one of those: 25 of
 * 25 publish no JSON-LD at all.
 *
 * Results are reported both ways — over every page, and over the pages where
 * there was something to map. Dropping them silently would be choosing the
 * flattering denominator; keeping only the total would hide which half of the
 * number is the library's doing.
 *
 * Computed from the markup and never from how a trial turned out, so it cannot
 * be tuned by what it excludes.
 */
function mappableOf(graph) {
  return [...graph.nodes.values()].some(
    (entity) =>
      entity.types.length > 0 &&
      !entity.types.every((type) => BOILERPLATE_TYPES.has(type) || type.endsWith('Page'))
  );
}
