/**
 * FASE 0 — spike di de-risking (usa e getta).
 *
 * Prova che l'intera catena regga PRIMA di costruire il monorepo:
 *   JSON-LD in pagina  ->  ToolDescriptor (JSON Schema)  ->  MCP registerTool  ->  client reale che invoca
 *
 * Domande a cui deve rispondere:
 *   Q1  registerTool dell'SDK v2 accetta JSON Schema raw via fromJsonSchema, senza passare da Zod?
 *   Q2  un client MCP reale vede i tool generati e li chiama ottenendo i dati giusti?
 *   Q3  la validazione dell'inputSchema generato rifiuta davvero input non validi?
 *   Q4  una SearchAction si mappa a un tool eseguibile con i parametri giusti?
 *   Q5  un potentialAction non-GET viene scartato invece di diventare un tool?
 */

import { McpServer, fromJsonSchema, InMemoryTransport } from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { Client } from '@modelcontextprotocol/client';

// ---------------------------------------------------------------------------
// Fixture sintetica. Volutamente "sporca" come il web vero: due blocchi ld+json
// separati, @graph, @type array, una SearchAction GET (mappabile) e una
// OrderAction POST (da scartare).
// ---------------------------------------------------------------------------
const HTML = `
<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["Product", "IndividualProduct"],
      "@id": "#prodotto",
      "name": "Zaino Trekking 45L",
      "description": "Zaino da escursionismo con telaio in alluminio.",
      "sku": "ZT-45-BLU",
      "brand": { "@type": "Brand", "name": "Altavia" },
      "offers": {
        "@type": "Offer",
        "price": "129.90",
        "priceCurrency": "EUR",
        "availability": "https://schema.org/InStock"
      },
      "potentialAction": {
        "@type": "OrderAction",
        "target": { "@type": "EntryPoint", "urlTemplate": "https://esempio.test/ordina", "httpMethod": "POST" }
      }
    }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "url": "https://esempio.test/",
  "potentialAction": {
    "@type": "SearchAction",
    "target": { "@type": "EntryPoint", "urlTemplate": "https://esempio.test/cerca?q={search_term_string}" },
    "query-input": "required name=search_term_string"
  }
}
</script>
</head><body></body></html>`;

// ---------------------------------------------------------------------------
// extract + normalize, versione minima (nello spike basta la regex: nel core
// vero si userà il DOM lato browser e un parser HTML lato Node)
// ---------------------------------------------------------------------------
function extract(html) {
  const nodes = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue; // il JSON-LD rotto è comunissimo: si salta, non si esplode
    }
    for (const n of parsed['@graph'] ?? [parsed]) nodes.push(n);
  }
  return nodes;
}

const typesOf = (node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter(Boolean);

// ---------------------------------------------------------------------------
// map: entità -> tool di lettura, potentialAction -> tool eseguibile
// ---------------------------------------------------------------------------
const IDEMPOTENT_ACTIONS = new Set(['SearchAction', 'FindAction', 'ReadAction', 'ViewAction']);

function mapReadTools(nodes) {
  const tools = [];
  for (const node of nodes) {
    if (!typesOf(node).includes('Product')) continue;
    tools.push({
      name: 'get_product',
      description: 'Dettagli del prodotto in questa pagina: nome, descrizione, SKU, marca.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true,
      run: () => ({
        name: node.name,
        description: node.description,
        sku: node.sku,
        brand: node.brand?.name,
      }),
    });
    if (node.offers) {
      tools.push({
        name: 'get_product_offer',
        description: 'Prezzo, valuta e disponibilità del prodotto in questa pagina.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true,
        run: () => ({
          price: node.offers.price,
          priceCurrency: node.offers.priceCurrency,
          availability: node.offers.availability,
        }),
      });
    }
  }
  return tools;
}

/** Parsa sia "required name=x" sia PropertyValueSpecification. */
function parseQueryInput(qi) {
  if (typeof qi === 'string') {
    return { name: /name=(\S+)/.exec(qi)?.[1], required: /\brequired\b/.test(qi) };
  }
  return { name: qi?.valueName, required: Boolean(qi?.valueRequired) };
}

function mapActionTools(nodes, { pageOrigin }) {
  const tools = [];
  const skipped = [];
  for (const node of nodes) {
    for (const action of [node.potentialAction].flat().filter(Boolean)) {
      const type = typesOf(action)[0];
      const target = action.target ?? {};
      const method = (target.httpMethod ?? 'GET').toUpperCase();

      if (method !== 'GET' || !IDEMPOTENT_ACTIONS.has(type)) {
        skipped.push({ type, method, reason: 'non idempotente / non-GET' });
        continue;
      }
      const url = new URL(target.urlTemplate.replace(/\{[^}]+\}/g, ''), pageOrigin);
      if (url.origin !== pageOrigin) {
        skipped.push({ type, method, reason: `cross-origin (${url.origin})` });
        continue;
      }

      const { name: param, required } = parseQueryInput(action['query-input']);
      tools.push({
        name: 'search_site',
        description: 'Cerca contenuti in questo sito.',
        inputSchema: {
          type: 'object',
          properties: { [param]: { type: 'string', description: 'Termine di ricerca' } },
          required: required ? [param] : [],
          additionalProperties: false,
        },
        readOnly: true,
        run: (args) => ({
          // Nello spike non si fa la fetch: si prova che l'espansione del template sia corretta.
          resolvedUrl: target.urlTemplate.replace(`{${param}}`, encodeURIComponent(args[param])),
        }),
      });
    }
  }
  return { tools, skipped };
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------
const nodes = extract(HTML);
const readTools = mapReadTools(nodes);
const { tools: actionTools, skipped } = mapActionTools(nodes, { pageOrigin: 'https://esempio.test' });
const descriptors = [...readTools, ...actionTools];

console.log(`\n[extract]  ${nodes.length} entità: ${nodes.map((n) => typesOf(n)[0]).join(', ')}`);
console.log(`[map]      ${descriptors.length} tool: ${descriptors.map((t) => t.name).join(', ')}`);
console.log(`[guard]    ${skipped.length} azione/i scartata/e: ${skipped.map((s) => `${s.type} (${s.reason})`).join('; ')}`);

const server = new McpServer({ name: 'agenticschema-spike', version: '0.0.0' });
const validator = new AjvJsonSchemaValidator();

for (const d of descriptors) {
  server.registerTool(
    d.name,
    {
      description: d.description,
      // Q1: JSON Schema raw -> Standard Schema, senza Zod
      inputSchema: fromJsonSchema(d.inputSchema, validator),
      annotations: { readOnlyHint: d.readOnly, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(d.run(args ?? {}), null, 2) }] })
  );
}

const client = new Client({ name: 'spike-client', version: '0.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

const results = { pass: [], fail: [] };
const check = (id, ok, detail) => (ok ? results.pass : results.fail).push(`${id}: ${detail}`);

// Q2 — il client vede i tool ed è capace di chiamarli
const listed = await client.listTools();
console.log(`\n[client]   tools/list -> ${listed.tools.map((t) => t.name).join(', ')}`);
check('Q1+Q2', listed.tools.length === descriptors.length, `${listed.tools.length} tool visibili al client`);

const withSchema = listed.tools.find((t) => t.name === 'search_site');
console.log(`[client]   inputSchema di search_site -> ${JSON.stringify(withSchema.inputSchema)}`);
check(
  'Q4',
  withSchema.inputSchema?.required?.includes('search_term_string'),
  'SearchAction -> tool con parametro richiesto search_term_string'
);

const offer = await client.callTool({ name: 'get_product_offer', arguments: {} });
console.log(`[client]   get_product_offer -> ${offer.content[0].text.replace(/\s+/g, ' ')}`);
check('Q2', offer.content[0].text.includes('129.90'), 'prezzo letto dal JSON-LD');

const search = await client.callTool({ name: 'search_site', arguments: { search_term_string: 'zaino 45L' } });
console.log(`[client]   search_site -> ${search.content[0].text.replace(/\s+/g, ' ')}`);
check('Q4', search.content[0].text.includes('zaino%2045L'), 'urlTemplate espanso e parametro encodato');

// Q3 — la validazione rifiuta input non validi
let rejected = false;
try {
  const bad = await client.callTool({ name: 'search_site', arguments: {} });
  rejected = bad.isError === true;
} catch {
  rejected = true;
}
check('Q3', rejected, 'input senza il parametro richiesto viene rifiutato');

// Q5 — l'azione POST non è diventata un tool
check('Q5', !listed.tools.some((t) => t.name.includes('order')), 'OrderAction/POST scartata, nessun tool eseguibile');

console.log('\n──────── esito spike ────────');
for (const p of results.pass) console.log(`  PASS  ${p}`);
for (const f of results.fail) console.log(`  FAIL  ${f}`);
console.log(`\n${results.fail.length === 0 ? 'TUTTO VERDE' : `${results.fail.length} FALLIMENTI`}\n`);

await client.close();
process.exit(results.fail.length === 0 ? 0 : 1);
