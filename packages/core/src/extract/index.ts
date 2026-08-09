import type { Diagnostic, ExtractResult, JsonObject, JsonValue, RawNode } from '../types.js';

export interface ExtractOptions {
  /**
   * Se `source` è una stringa HTML si estrae solo JSON-LD: microdata e RDFa richiedono
   * un parser HTML vero. Passare un `Document` (browser, oppure linkedom/happy-dom lato
   * Node) per avere tutti e tre i formati.
   */
  formats?: Array<'jsonld' | 'microdata' | 'rdfa'>;
}

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Estrae i blob di dati strutturati da una pagina, senza interpretarli.
 * La normalizzazione (`@graph`, `@id`, prefissi) è responsabilità di `normalize`.
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
        // Il JSON-LD rotto è comunissimo nel web reale: si annota e si prosegue,
        // perché un blocco malformato non deve azzerare gli altri.
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
 * Percorso stringa (Node senza DOM). Affidabile per JSON-LD: la specifica HTML
 * impone di escapare `</script>` dentro il contenuto dello script, quindi la
 * chiusura non può comparire dentro il JSON valido.
 */
function scanJsonLdFromHtml(html: string): string[] {
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  return [...html.matchAll(re)].map((m) => m[1] ?? '');
}

// ---------------------------------------------------------------------------
// Microdata (sottoinsieme WHATWG sufficiente per schema.org)
// ---------------------------------------------------------------------------

function extractMicrodata(doc: Document): RawNode[] {
  // Solo gli scope di primo livello: quelli annidati sono raccolti ricorsivamente.
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

/** Discendenti con itemprop che appartengono a QUESTO scope (non a uno annidato). */
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
// RDFa Lite (typeof / property / resource / vocab)
// ---------------------------------------------------------------------------

const SCHEMA_ORG_IRI = /^https?:\/\/(www\.)?schema\.org\//i;

/**
 * RDFa è un meccanismo generico: qualunque vocabolario può usarlo, e dare per
 * scontato che sia sempre schema.org non regge fuori dai test. MediaWiki annota
 * il proprio markup con `typeof="mw:Transclusion"`, `mw:File/Thumb`, `mw:Entity`
 * e simili — una pagina di Wikipedia ne contiene oltre centosessanta, e senza
 * questo filtro finivano tutti nel grafo come entità.
 *
 * Restituisce il nome locale se il termine appartiene a schema.org, `undefined`
 * altrimenti.
 */
function schemaTerm(value: string): string | undefined {
  const term = value.trim();
  if (!term) return undefined;
  if (SCHEMA_ORG_IRI.test(term)) return term.slice(term.lastIndexOf('/') + 1);

  const colon = term.indexOf(':');
  // Termine nudo: si assume il vocabolario di default, che per i dati
  // strutturati è schema.org. Con un prefisso, invece, dev'essere il suo.
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
  // Radici fra le sole entità schema.org: un wrapper di un altro vocabolario
  // frapposto non deve far sembrare radice un'entità annidata.
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
    // Stesso filtro sulle proprietà: `property="mw:..."` non è un dato nostro.
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
