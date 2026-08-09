import type { Diagnostic, ExtractResult, JsonObject, JsonValue, RawNode } from '../types.js';

export interface ExtractOptions {
  /**
   * If `source` is an HTML string, only JSON-LD comes out: microdata and RDFa
   * need a real HTML parser. Pass a `Document`, either the browser's own or
   * one from linkedom or happy-dom on Node, to get all three.
   */
  formats?: Array<'jsonld' | 'microdata' | 'rdfa'>;
}

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Pulls the structured-data blobs out of a page without interpreting them.
 * Making sense of `@graph`, `@id` and prefixes is `normalize`'s job.
 */
export function extract(source: Document | string, options: ExtractOptions = {}): ExtractResult {
  const formats = options.formats ?? ['jsonld', 'microdata', 'rdfa'];
  const diagnostics: Diagnostic[] = [];
  const nodes: RawNode[] = [];

  const blocks =
    typeof source === 'string' ? scanJsonLdFromHtml(source) : scanJsonLdFromDom(source);

  if (formats.includes('jsonld')) {
    for (const raw of blocks) {
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(raw) as JsonValue;
      } catch (err) {
        // Broken JSON-LD is everywhere on the real web. Note it and carry on:
        // one malformed block must not wipe out the others.
        diagnostics.push({
          level: 'warn',
          code: 'json-parse-error',
          message: `unparsable ld+json block: ${(err as Error).message}`,
        });
        continue;
      }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isObject(item)) nodes.push({ data: item, format: 'jsonld' });
      }
    }
  }

  if (typeof source !== 'string') {
    if (formats.includes('microdata')) nodes.push(...extractMicrodata(source));
    if (formats.includes('rdfa')) nodes.push(...extractRdfa(source));
  }

  if (nodes.length === 0) {
    diagnostics.push({
      level: 'info',
      code: 'no-structured-data',
      message: 'no structured data found on this page',
    });
  }

  return { nodes, diagnostics };
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

const scanJsonLdFromDom = (doc: Document): string[] =>
  [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? '');

/**
 * The string path, for Node without a DOM. Reliable enough for JSON-LD: the HTML
 * spec requires `</script>` to be escaped inside script content, so the closing
 * tag cannot turn up inside valid JSON.
 */
function scanJsonLdFromHtml(html: string): string[] {
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  return [...html.matchAll(re)].map((m) => m[1] ?? '');
}

// ---------------------------------------------------------------------------
// Microdata: the slice of WHATWG that schema.org actually needs
// ---------------------------------------------------------------------------

function extractMicrodata(doc: Document): RawNode[] {
  // Top-level scopes only. Nested ones get picked up on the way down.
  const tops = [...doc.querySelectorAll('[itemscope]')].filter(
    (el) => !el.parentElement?.closest('[itemscope]')
  );
  return tops.map((el) => ({ data: readItem(el), format: 'microdata' as const }));
}

function readItem(scope: Element): JsonObject {
  const item: JsonObject = {};

  const itemtype = scope.getAttribute('itemtype');
  if (itemtype) {
    const types = itemtype.split(/\s+/).filter(Boolean).map(localName);
    item['@type'] = types.length === 1 ? (types[0] as string) : types;
  }
  const itemid = scope.getAttribute('itemid');
  if (itemid) item['@id'] = itemid;

  for (const prop of childProperties(scope)) {
    const names = (prop.getAttribute('itemprop') ?? '').split(/\s+/).filter(Boolean);
    const value: JsonValue = prop.hasAttribute('itemscope')
      ? readItem(prop)
      : propertyValue(prop);

    for (const name of names) {
      const existing = item[name];
      if (existing === undefined) item[name] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else item[name] = [existing, value];
    }
  }
  return item;
}

/** Descendants carrying itemprop that belong to THIS scope, not to a nested one. */
const childProperties = (scope: Element): Element[] =>
  [...scope.querySelectorAll('[itemprop]')].filter(
    (el) => el.parentElement?.closest('[itemscope]') === scope
  );

function propertyValue(el: Element): string {
  const byAttribute: Record<string, string> = {
    META: 'content',
    AUDIO: 'src',
    EMBED: 'src',
    IFRAME: 'src',
    IMG: 'src',
    SOURCE: 'src',
    TRACK: 'src',
    VIDEO: 'src',
    A: 'href',
    AREA: 'href',
    LINK: 'href',
    OBJECT: 'data',
    DATA: 'value',
    METER: 'value',
    TIME: 'datetime',
  };
  const attr = byAttribute[el.tagName];
  if (attr) {
    const v = el.getAttribute(attr);
    if (v !== null) return v;
  }
  return (el.textContent ?? '').trim();
}

// ---------------------------------------------------------------------------
// RDFa Lite: typeof / property / resource / vocab
// ---------------------------------------------------------------------------

const SCHEMA_ORG_IRI = /^https?:\/\/(www\.)?schema\.org\//i;

/**
 * RDFa is a generic mechanism: any vocabulary can use it, and assuming it is
 * always schema.org does not survive contact with real pages. MediaWiki marks up
 * its own output with `typeof="mw:Transclusion"`, `mw:File/Thumb`, `mw:Entity`
 * and friends. A single Wikipedia article carries over a hundred and sixty of
 * them, and none of them describe anything an agent would want to read.
 *
 * Returns the local name when the term belongs to schema.org, `undefined` otherwise.
 */
function schemaTerm(value: string): string | undefined {
  const term = value.trim();
  if (!term) return undefined;
  if (SCHEMA_ORG_IRI.test(term)) return term.slice(term.lastIndexOf('/') + 1);

  const colon = term.indexOf(':');
  // A bare term falls back to the default vocabulary, which for structured data
  // is schema.org. With a prefix, though, that prefix has to be schema.org's.
  if (colon === -1) return term;
  return term.slice(0, colon).toLowerCase() === 'schema' ? term.slice(colon + 1) : undefined;
}

const schemaTypesOf = (el: Element): string[] =>
  (el.getAttribute('typeof') ?? '')
    .split(/\s+/)
    .map(schemaTerm)
    .filter((t): t is string => Boolean(t));

function extractRdfa(doc: Document): RawNode[] {
  const entities = [...doc.querySelectorAll('[typeof]')].filter(
    (el) => schemaTypesOf(el).length > 0
  );
  // Roots among the schema.org entities alone: a wrapper from some other
  // vocabulary sitting in between must not make a nested entity look like a root.
  const tops = entities.filter(
    (el) => !entities.some((other) => other !== el && other.contains(el))
  );
  return tops.map((el) => ({ data: readRdfaItem(el), format: 'rdfa' as const }));
}

function readRdfaItem(scope: Element): JsonObject {
  const item: JsonObject = {};

  const types = schemaTypesOf(scope);
  if (types.length) item['@type'] = types.length === 1 ? (types[0] as string) : types;

  const resource = scope.getAttribute('resource') ?? scope.getAttribute('about');
  if (resource) item['@id'] = resource;

  const props = [...scope.querySelectorAll('[property]')].filter(
    (el) => el.parentElement?.closest('[typeof]') === scope
  );

  for (const prop of props) {
    // Same filter on properties: `property="mw:..."` is not our data.
    const name = schemaTerm(prop.getAttribute('property') ?? '');
    if (!name) continue;
    const value: JsonValue = prop.hasAttribute('typeof')
      ? readRdfaItem(prop)
      : prop.getAttribute('content') ?? propertyValue(prop);

    const existing = item[name];
    if (existing === undefined) item[name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else item[name] = [existing, value];
  }
  return item;
}

/** `https://schema.org/Product` | `schema:Product` | `Product` -> `Product` */
function localName(value: string): string {
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf('/');
  const hash = trimmed.lastIndexOf('#');
  const colon = trimmed.lastIndexOf(':');
  const cut = Math.max(slash, hash, trimmed.includes('://') ? -1 : colon);
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}
