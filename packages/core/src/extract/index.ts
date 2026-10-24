import type { Diagnostic, ExtractResult, JsonObject, JsonValue, RawNode } from '../types.js';

export interface ExtractOptions {
  /**
   * If `source` is an HTML string, only JSON-LD comes out: microdata and RDFa
   * need a real HTML parser. Pass a `Document`, either the browser's own or
   * one from linkedom or happy-dom on Node, to get all three.
   */
  formats?: Array<'jsonld' | 'microdata' | 'rdfa'>;
  /**
   * When true, pages without Schema.org markup fall back to OpenGraph, Twitter
   * Card, standard `<meta>`/`<title>` tags, and HTML search `<form>` elements.
   */
  fallback?: boolean;
}

export interface PageMeta {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  type?: string;
  siteName?: string;
  language?: string;
  openGraph: Record<string, string>;
}

const DEFAULT_FORMATS: NonNullable<ExtractOptions['formats']> = ['jsonld', 'microdata', 'rdfa'];

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Guards plain-object maps against prototype-polluting property names. */
export const isSafeKey = (key: string): boolean => Boolean(key) && !UNSAFE_KEYS.has(key);

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether this HTML needs a real DOM before `extract` can see everything on it.
 *
 * JSON-LD comes out of the string directly. Microdata and RDFa do not: they are
 * attributes spread across the tree, and reading them means walking it. Building
 * that tree is by far the most expensive thing on the path from a page to tools
 * — measured over the corpus it is 93% of the total, against 0.6% for all the
 * mapping put together — so it is worth asking first whether a given page has
 * anything that would repay it. Most do not: roughly seven pages in ten carry
 * JSON-LD and nothing else.
 *
 * Deliberately generous. It answers the cheap question "are the anchoring
 * attributes present anywhere in the source", not "is there a valid entity
 * here". A false positive costs one parse that finds nothing; a false negative
 * would drop data silently, which is why the test looks for exactly what
 * `extractMicrodata` and `extractRdfa` anchor on and nothing narrower. In
 * particular it does not try to tell a schema.org `typeof` from any other
 * vocabulary's: that judgement needs the parsed attribute value, and getting it
 * wrong here would lose the entity rather than waste a parse.
 */
export function needsDocument(html: string, options: ExtractOptions = {}): boolean {
  const formats = options.formats ?? DEFAULT_FORMATS;
  return (
    (formats.includes('microdata') && MICRODATA_ANCHOR.test(html)) ||
    (formats.includes('rdfa') && RDFA_ANCHOR.test(html))
  );
}

// `itemscope` is a boolean attribute, so it can be followed by whitespace, the
// end of the tag, a self-closing slash, or an `=`. No `g` flag on either: these
// are module-level, and `test` on a global regex carries `lastIndex` between calls.
const MICRODATA_ANCHOR = /\sitemscope(?=[\s=>/]|$)/i;
const RDFA_ANCHOR = /\stypeof\s*=/i;

/**
 * Pulls the structured-data blobs out of a page without interpreting them.
 * Making sense of `@graph`, `@id` and prefixes is `normalize`'s job.
 */
export function extract(source: Document | string, options: ExtractOptions = {}): ExtractResult {
  const formats = options.formats ?? DEFAULT_FORMATS;
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

  if (options.fallback) {
    nodes.push(...extractFallbackNodes(source, nodes.length > 0));
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
  const blocks: string[] = [];
  // Local, because both carry `lastIndex` and this walks them forward by hand.
  const opening = /<script\b/gi;
  const closing = /<\/script/gi;

  let open: RegExpExecArray | null;
  while ((open = opening.exec(html)) !== null) {
    const tagEnd = html.indexOf('>', open.index);
    if (tagEnd === -1) break; // an open tag that never ends: nothing usable follows

    closing.lastIndex = tagEnd + 1;
    const close = closing.exec(html);
    if (!close) break; // no closing tag left, so no complete block left either

    const type = TYPE_ATTRIBUTE.exec(html.slice(open.index + '<script'.length, tagEnd));
    if (type) {
      const value = type[1] ?? type[2] ?? type[3] ?? '';
      if (isJsonLdType(value)) blocks.push(html.slice(tagEnd + 1, close.index));
    }
    opening.lastIndex = close.index;
  }
  return blocks;
}

/**
 * Walked with `indexOf` and two anchored patterns rather than one regex spanning
 * the whole element, for two separate reasons.
 *
 * Correctness: the type has to be decoded before it is compared. The value is
 * not always literal — marmiton.org serves `type="application&#x2F;ld&#x2B;json"`,
 * which a parser resolves and the old pattern, matching the raw text, did not.
 * Seven percent of the corpus, reported as `no-structured-data`, which reads
 * exactly like a page carrying nothing.
 *
 * Cost: `<script\b[^>]*...>([\s\S]*?)<\/script\s*>` restarts its scan at every
 * `<script` that never closes, which is quadratic — 20k of them took about four
 * seconds, and this parses pages fetched from anywhere. Each position here is
 * found once, by a scan that only ever moves forward. Same shape as the
 * `sanitizeText` fix in `guard`, and the same reason.
 */
const TYPE_ATTRIBUTE = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * Case-insensitively, because HTML puts `type` on the list of attributes whose
 * values selectors match ASCII case-insensitively — so `[type="application/ld+json"]`,
 * the DOM path's selector, matches that way too. The two paths have to agree.
 */
const isJsonLdType = (value: string): boolean =>
  decodeEntities(value).trim().toLowerCase() === 'application/ld+json';

/**
 * Enough of an entity decoder for an attribute value. Only the type attribute
 * goes through it, never the script body: inside a raw text element the parser
 * does not decode entities, so the JSON has to reach `JSON.parse` exactly as written.
 */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(ENTITY, (whole, hex: string, dec: string, name: string) => {
    if (hex) return fromCodePoint(Number.parseInt(hex, 16), whole);
    if (dec) return fromCodePoint(Number.parseInt(dec, 10), whole);
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

/** The ones that can turn up in a MIME type. A full table would be all weight, no reach. */
const NAMED: Record<string, string> = {
  amp: '&',
  sol: '/',
  plus: '+',
  period: '.',
  quot: '"',
  apos: "'",
};

function fromCodePoint(code: number, fallback: string): string {
  // Surrogates and out-of-range values throw, and a malformed entity in an
  // attribute is not worth an exception on the way to a MIME comparison.
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  return String.fromCodePoint(code);
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
      if (!isSafeKey(name)) continue;
      const existing = Object.hasOwn(item, name) ? item[name] : undefined;
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

const BY_ATTRIBUTE: Record<string, string> = {
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

function propertyValue(el: Element): string {
  const attr = BY_ATTRIBUTE[el.tagName];
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

function closestSchemaScope(el: Element, entitySet: ReadonlySet<Element>): Element | undefined {
  let cur = el.parentElement;
  while (cur) {
    if (entitySet.has(cur)) return cur;
    cur = cur.parentElement;
  }
  return undefined;
}

function extractRdfa(doc: Document): RawNode[] {
  const entities = [...doc.querySelectorAll('[typeof]')].filter(
    (el) => schemaTypesOf(el).length > 0
  );
  if (entities.length === 0) return [];
  const entitySet = new Set(entities);
  // Roots among the schema.org entities alone: a wrapper from some other
  // vocabulary sitting in between must not make a nested entity look like a root.
  const tops = entities.filter((el) => !closestSchemaScope(el, entitySet));
  return tops.map((el) => ({ data: readRdfaItem(el, entitySet), format: 'rdfa' as const }));
}

function readRdfaItem(scope: Element, entitySet: ReadonlySet<Element>): JsonObject {
  const item: JsonObject = {};

  const types = schemaTypesOf(scope);
  if (types.length) item['@type'] = types.length === 1 ? (types[0] as string) : types;

  const resource = scope.getAttribute('resource') ?? scope.getAttribute('about');
  if (resource) item['@id'] = resource;

  const props = [...scope.querySelectorAll('[property]')].filter(
    (el) => closestSchemaScope(el, entitySet) === scope
  );

  for (const prop of props) {
    // Same filter on properties: `property="mw:..."` is not our data.
    const name = schemaTerm(prop.getAttribute('property') ?? '');
    if (!name || !isSafeKey(name)) continue;
    const value: JsonValue = entitySet.has(prop)
      ? readRdfaItem(prop, entitySet)
      : prop.getAttribute('content') ?? propertyValue(prop);

    const existing = Object.hasOwn(item, name) ? item[name] : undefined;
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

// ---------------------------------------------------------------------------
// Fallback extraction: OpenGraph, Twitter Card, HTML <meta> & search <form>
// ---------------------------------------------------------------------------

const OG_TYPE_MAP: Record<string, string> = {
  product: 'Product',
  'product.item': 'Product',
  'og:product': 'Product',
  article: 'Article',
  book: 'Book',
  profile: 'Person',
  website: 'WebSite',
  'video.movie': 'Movie',
  'video.episode': 'TVEpisode',
  'video.tv_show': 'TVSeries',
  'video.other': 'VideoObject',
  'music.song': 'MusicRecording',
};

const SEARCH_INPUT_NAMES = new Set(['q', 's', 'query', 'search', 'keyword', 'keywords', 'term', 'k']);

const ATTR_RE_CACHE = new Map<string, RegExp>();
function readAttr(attrs: string, name: string): string | undefined {
  let re = ATTR_RE_CACHE.get(name);
  if (!re) {
    re = new RegExp(`\\b(?:${name})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
    ATTR_RE_CACHE.set(name, re);
  }
  const m = re.exec(attrs);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw ? decodeEntities(raw).trim() : undefined;
}

const META_PREFIX_RE = /^(?:og|twitter|product|article):/;

/**
 * Reads OpenGraph, Twitter Card and standard HTML metadata from a `Document` or
 * raw HTML string without requiring a DOM parser.
 */
export function extractMeta(source: Document | string): PageMeta {
  const og: Record<string, string> = {};
  let title: string | undefined;
  let description: string | undefined;
  let canonical: string | undefined;
  let language: string | undefined;

  const recordMeta = (k: string | undefined, v: string | undefined): void => {
    const key = (k ?? '').trim().toLowerCase();
    const val = v?.trim();
    if (!key || !val || !isSafeKey(key)) return;
    if (key === 'description') description ??= val;
    else if (META_PREFIX_RE.test(key)) og[key] ??= val;
  };

  if (typeof source !== 'string') {
    title = source.querySelector('title')?.textContent?.trim() || undefined;
    canonical = source.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || undefined;
    language = source.documentElement?.getAttribute('lang')?.trim() || undefined;
    for (const meta of source.querySelectorAll('meta')) {
      recordMeta(
        meta.getAttribute('property') ?? meta.getAttribute('name') ?? undefined,
        meta.getAttribute('content') ?? undefined
      );
    }
  } else {
    language = readAttr(/<html\b([^>]*)>/i.exec(source)?.[1] ?? '', 'lang');
    const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)?.[1];
    if (t) title = decodeEntities(t).replace(/\s+/g, ' ').trim() || undefined;
    for (const m of source.matchAll(/<link\b([^>]*)>/gi)) {
      if (readAttr(m[1] ?? '', 'rel')?.toLowerCase() === 'canonical') {
        canonical = readAttr(m[1] ?? '', 'href');
        if (canonical) break;
      }
    }
    for (const m of source.matchAll(/<meta\b([^>]*)>/gi)) {
      recordMeta(readAttr(m[1] ?? '', 'property|name'), readAttr(m[1] ?? '', 'content'));
    }
  }

  const finalTitle = og['og:title'] ?? og['twitter:title'] ?? title;
  const finalDesc = og['og:description'] ?? og['twitter:description'] ?? description;
  const finalCanonical = og['og:url'] ?? canonical;
  const finalImage = og['og:image'] ?? og['twitter:image'];
  const finalType = og['og:type'];
  const finalSite = og['og:site_name'];
  const finalLang = og['og:locale'] ?? language;

  return {
    ...(finalTitle ? { title: finalTitle } : {}),
    ...(finalDesc ? { description: finalDesc } : {}),
    ...(finalCanonical ? { canonical: finalCanonical } : {}),
    ...(finalImage ? { image: finalImage } : {}),
    ...(finalType ? { type: finalType } : {}),
    ...(finalSite ? { siteName: finalSite } : {}),
    ...(finalLang ? { language: finalLang } : {}),
    openGraph: og,
  };
}

function extractFallbackNodes(source: Document | string, hasExistingNodes: boolean): RawNode[] {
  const out: RawNode[] = [];
  const meta = extractMeta(source);
  const og = meta.openGraph;

  if (!hasExistingNodes && (meta.title || meta.description || Object.keys(og).length > 0)) {
    const rawType = (meta.type ?? '').toLowerCase();
    const schemaType =
      OG_TYPE_MAP[rawType] ??
      (og['product:price:amount'] ? 'Product' : og['article:published_time'] ? 'Article' : 'WebPage');

    const data: JsonObject = {
      '@context': 'https://schema.org',
      '@type': schemaType,
      ...(meta.title ? { name: meta.title, ...(schemaType === 'Article' ? { headline: meta.title } : {}) } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.image ? { image: meta.image } : {}),
      ...(meta.canonical ? { url: meta.canonical } : {}),
      ...(meta.language ? { inLanguage: meta.language } : {}),
      ...(og['article:published_time'] ? { datePublished: og['article:published_time'] } : {}),
      ...(og['article:modified_time'] ? { dateModified: og['article:modified_time'] } : {}),
      ...(og['article:section'] ? { articleSection: og['article:section'] } : {}),
      ...(og['article:author']
        ? { author: { '@type': 'Person', name: og['article:author'] } }
        : {}),
      ...(og['product:brand'] ? { brand: og['product:brand'] } : {}),
      ...(og['product:price:amount']
        ? {
            offers: {
              '@type': 'Offer',
              price: og['product:price:amount'],
              ...(og['product:price:currency'] ? { priceCurrency: og['product:price:currency'] } : {}),
              ...(og['product:availability'] ? { availability: og['product:availability'] } : {}),
            },
          }
        : {}),
    };
    out.push({ data, format: 'jsonld' });
  }

  const searchTemplate = extractSearchFormTemplate(source);
  if (searchTemplate) {
    out.push({
      data: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        ...(meta.siteName ?? meta.title ? { name: (meta.siteName ?? meta.title)! } : {}),
        ...(meta.canonical ? { url: meta.canonical } : {}),
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: searchTemplate.urlTemplate,
          },
          'query-input': `required name=${searchTemplate.param}`,
        },
      },
      format: 'jsonld',
    });
  }

  return out;
}

function extractSearchFormTemplate(
  source: Document | string
): { urlTemplate: string; param: string } | undefined {
  const matchInput = (action: string, name: string | undefined, type: string | undefined) => {
    if (!name || !/^[A-Za-z0-9_]+$/.test(name)) return undefined;
    if ((type ?? 'text').toLowerCase() === 'search' || SEARCH_INPUT_NAMES.has(name.toLowerCase())) {
      return { urlTemplate: `${action}${action.includes('?') ? '&' : '?'}${name}={${name}}`, param: name };
    }
    return undefined;
  };

  if (typeof source !== 'string') {
    for (const form of source.querySelectorAll('form')) {
      if ((form.getAttribute('method') ?? 'get').trim().toUpperCase() !== 'GET') continue;
      const action = (form.getAttribute('action') ?? '').trim();
      if (!action) continue;
      for (const input of form.querySelectorAll('input')) {
        const hit = matchInput(action, input.getAttribute('name')?.trim(), input.getAttribute('type')?.trim());
        if (hit) return hit;
      }
    }
    return undefined;
  }

  for (const m of source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)) {
    const attrs = m[1] ?? '';
    if ((readAttr(attrs, 'method') ?? 'GET').toUpperCase() !== 'GET') continue;
    const action = readAttr(attrs, 'action');
    if (!action) continue;
    for (const im of (m[2] ?? '').matchAll(/<input\b([^>]*)>/gi)) {
      const iAttrs = im[1] ?? '';
      const hit = matchInput(action, readAttr(iAttrs, 'name'), readAttr(iAttrs, 'type'));
      if (hit) return hit;
    }
  }
  return undefined;
}
