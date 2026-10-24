# AgenticSchema &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/searchstefano/agenticschema/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@agenticschema/core.svg?style=flat)](https://www.npmjs.com/package/@agenticschema/core) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/searchstefano/agenticschema/blob/main/CONTRIBUTING.md)

**Turn any webpage into typed JSON and callable MCP / WebMCP tools — in 3 ms, using 2.7× fewer tokens than a text scraper and 142× fewer than raw HTML.**

Most pages already publish structured data (`JSON-LD`, Microdata, RDFa, OpenGraph, `<meta>`, search forms). AI agents still scrape their prose. **AgenticSchema** closes that gap for both sides of the web:

- **For AI scrapers & agent pipelines (`@agenticschema/core`, `@agenticschema/server`)**: Extract normalized entities, page metadata, and executable search/read tools from any URL or HTML string — with automatic fallback to OpenGraph, Twitter Cards, `<meta>`, and HTML `<form method="get">` when Schema.org is missing.
- **For website owners (`@agenticschema/browser`)**: Drop one `<script>` tag onto your site to expose your existing markup as W3C **WebMCP** tools on `document.modelContext`. You write no new API and run no backend.

```
               Website / HTML
                  │
                  │  JSON-LD · Microdata · RDFa
                  │  + fallback: OpenGraph · Twitter Cards · <meta> · <form>
                  ▼
            AgenticSchema (3 ms)
                  │
                  │  normalized entities + callable tools (filtered, deduplicated, guarded)
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
   Scraper     WebMCP        MCP
  scrape()    (browser)   (Node/HTTP)
      └───────────┼───────────┘
                  ▼
              AI Agent
```

---

## Why AgenticSchema beats normal scraping: the numbers

Everything below is measured and reproducible from this repository (`npm run test:corpus` and `npm run bench:report`) across **177 real pages** pulled from Common Crawl (shops, news, recipes, reference, books) and **120 agent trials**.

### 1. Token & payload compression vs. HTML and text scrapers

Tokens per page, averaged across all **177 real pages** (`442.0 KB` mean raw HTML → **`3.0 KB` mean AgenticSchema output**), counted with `o200k_base`:

| What the model reads | Mean tokens / page | Mean size / page | vs. Raw HTML | vs. Competent text scraper |
| --- | ---: | ---: | ---: | ---: |
| **Raw HTML**, as served | 143,770 | 442.0 KB | — | — |
| **Extracted text** (Readability-style scraper: `<script>`, `<style>`, markup stripped) | 2,752 | ~11.2 KB | 52× | — |
| **AgenticSchema tool output** (deduplicated structured entities + tools) | **1,013** | **3.0 KB** | **142×** | **2.7×** |

Nobody serious feeds raw HTML to a model: a competent scraper strips the markup first, accounting for 52× of the reduction. **Against a competent text scraper, AgenticSchema cuts token consumption by another 2.7× overall** — and up to **18×–61×** on prose-heavy pages — while returning machine-typed fields instead of unstructured paragraphs:

| Vertical | Pages | Raw HTML (tokens) | Text scraper (tokens) | AgenticSchema (tokens) | vs. Raw HTML | vs. Text scraper |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **book** (Goodreads) | 2 | 287,454 | 11,534 | **191** | **1,505×** | **61×** |
| **reference** (Wikipedia, MDN) | 50 | 62,730 | 3,699 | **208** | **302×** | **18×** |
| **ecommerce** (IKEA, Patagonia, Backcountry) | 75 | 240,151 | 2,912 | **1,567** | **153×** | **1.9×** |
| **news** (Al Jazeera) | 25 | 90,530 | 882 | **528** | **171×** | **1.7×** |
| **recipe** (Marmiton) | 25 | 58,454 | 1,549 | **1,514** | **39×** | **1.0×** |
| **All corpus pages (mean)** | **177** | **143,770** | **2,752** | **1,013** | **142×** | **2.7×** |

### 2. Answer accuracy & hallucination rate (`sonnet`, 120 trials)

Fewer tokens only matter if the agent answers at least as well. Over **120 isolated trials** (5 questions per page: single-fact, multi-part, and unanswerable questions designed to catch hallucinations), comparing an agent given the **scraped page text** against the same agent given **only AgenticSchema MCP tools**:

| Benchmark metric | Competent text scraper (`text`) | AgenticSchema (`tools`) | Delta |
| --- | ---: | ---: | ---: |
| **Overall agreement** (mappable pages, neutral referee) | 85% | **89%** | **+4 pt** |
| **E-commerce questions** (including `ProductGroup` variants & prices) | 100% | **100%** | **11/11 prices** |
| **Recipe questions** (`recipeYield`, timings, ingredients) | 60% | **80%** | **+20 pt** |
| **Two-part questions** (e.g. *"What is the rating, and what does it cost?"*) | 83% | **92%** | **+9 pt** |
| **Hallucinations on unanswerable questions** (`NOT_ON_PAGE`) | 10% (1/10) | **0% (0/10)** | **Zero inventions** |
| **Mean cost per trial** (API-equivalent USD) | \$0.076 | **\$0.050** | **−34% cost** |

Why the tools arm wins on complex and recipe questions: prose scatters facts across the page (or omits `recipeYield` from body text while declaring it in JSON-LD), causing a reader model to drop one half of a two-part question or lose a product name in boilerplate. Two targeted tool calls return exact fields with zero prose noise.

### 3. Runtime speed & web-scale coverage

| Metric | Value | Why it matters |
| --- | ---: | --- |
| **Pipeline execution time** (`extract` → `guard`) | **3 ms / page** | Identical to stripping HTML tags (`3 ms`). Zero LLM calls during extraction. |
| **JSON-LD fast path** (Node server / scraper) | **0 ms DOM parse** | Pages carrying JSON-LD skip DOM construction completely unless Microdata/RDFa/fallback is needed. |
| **Domains publishing `SearchAction` + `urlTemplate`** | **10,000,000+** | Over 10M domains already declare machine-readable search endpoints (Google Crawl stats, 2026-07). |
| **Browser CDN bundle** (`@agenticschema/browser`) | **30.6 KB gzip** | Single self-contained classic IIFE script, W3C WebMCP polyfill included. |

---

## Contents

- [Why AgenticSchema beats normal scraping: the numbers](#why-agenticschema-beats-normal-scraping-the-numbers)
- [Quick start: 3 ways to use it](#quick-start-3-ways-to-use-it)
- [Read this first: registration is not transport](#read-this-first-registration-is-not-transport)
- [The script tag, in full](#the-script-tag-in-full)
- [Choosing a transport](#choosing-a-transport)
- [The JavaScript API & Universal Scraper](#the-javascript-api--universal-scraper)
- [The core pipeline](#the-core-pipeline)
- [The Node server & CLI scraper](#the-node-server--cli-scraper)
- [Deep dive: the 177-page corpus & 120-trial benchmark](#deep-dive-the-177-page-corpus--120-trial-benchmark)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Quick start: 3 ways to use it

### 1. Scrape any URL to structured JSON or MCP tools from the terminal

No browser and no configuration. Given a real product page:

```
world.openfoodfacts.org/product/3017620422003

  read    get_web_site
  read    get_organization
  action  search_web_site(search_term_string)
```

`search_web_site` is an executable tool derived automatically from the page's `SearchAction`. Run it as an MCP server for Claude Desktop / Cursor / Claude Code, or dump the structured JSON directly for scraping:

```bash
# Start a full MCP server over stdio for one or more URLs (fetched concurrently):
npx @agenticschema/server https://world.openfoodfacts.org/product/3017620422003

# Or scrape any page directly to structured JSON (with OpenGraph/meta/form fallback):
npx @agenticschema/server --json --fallback https://en.wikipedia.org/wiki/Backpack
```

### 2. Programmatic scraping in Node.js, Bun, Deno, or Cloudflare Workers

Use `scrape()` from `@agenticschema/core` (zero dependencies) or `scrapePages()` from `@agenticschema/server` (full DOM support for JSON-LD, Microdata, RDFa, OpenGraph, Twitter Cards, `<meta>`, and `<form>` search actions):

```js
import { scrapePages } from '@agenticschema/server';

const [page] = await scrapePages(['https://en.wikipedia.org/wiki/Backpack'], {
  fallback: true, // synthesizes entities from OpenGraph/meta/search forms if Schema.org is absent
});

console.log(page.primary);   // Primary subject of the page (clean, cycle-free JSON)
console.log(page.entities);  // All extracted entities
console.log(page.meta);      // { title, description, canonical, language, openGraph, twitter }
console.log(page.actions);   // Discovered executable GET search actions
console.log(page.tools);     // Generated MCP tool summaries
```

### 3. Expose your own website to in-browser AI agents (W3C WebMCP)

Two tags in development, one in production. The first reads your page's markup and registers WebMCP tools on `document.modelContext`; the second bridges them to local desktop MCP clients during development:

```html
<!-- ① registration: read this page's Schema.org markup, publish it as WebMCP tools -->
<script src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@latest"></script>

<!-- ② transport (development only): bridge those tools to a local MCP relay -->
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4/dist/browser/embed.js"></script>
```

Point your MCP client (Claude Desktop, Cursor, Claude Code) at the relay:

```json
{
  "mcpServers": {
    "webmcp-local-relay": {
      "command": "npx",
      "args": ["-y", "@mcp-b/webmcp-local-relay@latest"]
    }
  }
}
```

Open the page, and the tools appear in your client. Verify with `webmcp_list_sources` (or inspect **Chrome DevTools → Application → WebMCP** in Chrome 146+).

Four things worth knowing before you paste that in:

- **Order matters.** Put the relay embed tag after the registration tag.
- **Leave off `type="module"`.** The script-tag build is a classic IIFE script so it works out of the box in Google Tag Manager and Cloudflare Zaraz and preserves `document.currentScript`. See [How the adapter finds its own tag](#how-the-adapter-finds-its-own-tag).
- **Tag ② is for development only.** Shipping it to real visitors makes their browsers probe `127.0.0.1`. See [Keep the relay out of production](#keep-the-relay-out-of-production).
- **Pin your versions** in production.

> **Try it in the browser with nothing installed:**
> - **[Interactive Playground →](https://searchstefano.github.io/agenticschema/)** — Paste any JSON-LD or try the hostile sample to see what the security guard refuses and why.
> - **[Live WebMCP Demo Page →](https://searchstefano.github.io/agenticschema/demo.html)** — A live page carrying the script tag end to end.

---

## Read this first: registration is not transport

This is the single thing that trips people up on the browser path, so it comes before the browser reference.

Getting a page's data to an external desktop agent takes **two** steps, and `@agenticschema/browser` only does the first one:

```
   ①  REGISTRATION                        ②  TRANSPORT
   @agenticschema/browser                 a WebMCP-capable browser,
   reads the page's Schema.org            an extension, or a local relay
   markup and registers tools             carries those tools to the agent
   on document.modelContext
        │                                        │
        └──────────► document.modelContext ◄─────┘
                     (the meeting point)
```

`@agenticschema/browser` writes tools into `document.modelContext`. It does **not** open a connection to anything, because a browser tab cannot listen on a port. See [Three constraints](#three-constraints-that-shaped-the-design).

If you only want the browser's own built-in AI agent (Chrome WebMCP) to call your tools, step ① is all you need. If you want an external desktop program (Claude Desktop, Cursor) to call them, you also need a transport (step ②). See [Choosing a transport](#choosing-a-transport).

The symptom of forgetting step ② is very specific: **the tools show up in Chrome DevTools (Application → WebMCP) but your external MCP client reports zero sources.** DevTools reads `document.modelContext` in-process; your external MCP client is a separate program that cannot.

---

## The script tag, in full

### Where the tag goes

The build is a single classic script (`dist/cdn/auto.js`, ~30.6 KB gzipped) with no bundler and no package install behind it:

| Platform | Where |
| --- | --- |
| WordPress | The theme's header template, or any plugin that inserts scripts into `<head>`. |
| Shopify | `theme.liquid`, before the closing `</head>`. |
| React, Next.js, Astro | The shared layout or document component, alongside your other third-party tags. |
| Plain HTML | In `<head>`, or before `</body>`. |
| Google Tag Manager, Cloudflare Zaraz | A Custom HTML tag. See [Through a tag manager](#through-a-tag-manager). |

Put it in the shared layout rather than on one page. In a single-page app the adapter follows `history.pushState`, `replaceState`, `popstate`, and DOM mutations automatically, so a single tag covers every route.

### How the adapter finds its own tag

To read its `data-*` options the adapter tries three things, in order:

1. `document.currentScript`, set while a **classic** script runs (including one injected by a tag manager), and `null` in a module script,
2. `script[data-agenticschema]`, an explicit marker,
3. `script[src*="agenticschema"]`, the `src` of the standard snippet.

Since the build is an IIFE, the plain snippet takes rule 1 and everything works with no marker:

```html
<script data-max-tools="8"
        src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@latest"></script>
```

**Adding `type="module"` gives up rule 1.** If you self-host under a custom filename *and* use `type="module"`, add `data-agenticschema`:

```html
<script type="module" data-agenticschema data-max-tools="8"
        src="/assets/webmcp-bundle.js"></script>
```

### Through a tag manager

Google Tag Manager and Cloudflare Zaraz inject a plain `<script src>` without `type="module"`. Because the CDN bundle is an IIFE, it runs cleanly in any tag manager and reads `data-*` attributes via `document.currentScript`.

- Fire it on every page, as early as possible.
- Keep the local relay embed (`embed.js`) out of tag managers.

### Every attribute

All options are optional:

| Attribute | Values | Default | What it does |
| --- | --- | --- | --- |
| `data-agenticschema` | present / absent | absent | Marks the tag so the adapter can find it when `document.currentScript` is unavailable and `src` does not contain `agenticschema`. |
| `data-actions` | `off` | actions generated | Turns off executable tools entirely. Read tools are unaffected. |
| `data-max-tools` | integer > 0 | `24` | Ceiling on generated tools. |
| `data-watch` | `off` | watching on | Stops the adapter following DOM changes and History API navigations. |
| `data-allow-hosts` | comma-separated hosts | page origin only | Extra hosts an action's destination may point at, beyond the page's own origin. Read [Security](#security) first. |
| `data-fallback` | present / `true` / `on` | off | Synthesizes Schema.org entities from OpenGraph, Twitter Cards, `<meta>`, and HTML `<form method="get">` search forms when the page has no structured data. |
| `data-exposed-to` | comma-separated origins | none | Cross-origin parent origins allowed to discover and invoke tools when embedded in an iframe (forwarded to `registerTool` options). |

A page that uses all of them:

```html
<script data-agenticschema
        data-actions="off"
        data-max-tools="8"
        data-watch="off"
        data-fallback
        data-allow-hosts="api.example.com, search.example.com"
        data-exposed-to="https://partner.example.com"
        src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@latest"></script>
```

### Content-Security-Policy

A page with a CSP has to allow `cdn.jsdelivr.net` in `script-src`, or self-host `dist/cdn/auto.js`:

```
Content-Security-Policy: script-src 'self' https://cdn.jsdelivr.net;
```

The development relay embed (`embed.js`) also creates a `blob:` iframe and opens a local WebSocket:

```
Content-Security-Policy: script-src 'self' https://cdn.jsdelivr.net;
                         frame-src blob:;
                         connect-src ws://127.0.0.1:9333;
```

---

## Choosing a transport

| Transport | Who calls the tools | Setup | Good for |
| --- | --- | --- | --- |
| **Native browser WebMCP** | the browser's own agent | none: the browser provides `document.modelContext` | the end state (Chrome 146+ flag / Chrome 149+ origin trial) |
| **Chrome origin trial** | the browser's own agent, on visitors' Chrome | register a token for your origin and serve it | running the native path on real traffic today |
| **Local relay** (`embed.js`) | desktop MCP clients: Claude Desktop, Cursor, Claude Code | one script tag + `npx @mcp-b/webmcp-local-relay` | development, testing, personal automation |
| **Browser extension** | whatever the extension is wired to | install the extension | using tools across sites you do not control |
| **Node MCP server** (`@agenticschema/server`) | any MCP client over stdio or HTTP | `npx @agenticschema/server <url>` | server-side agents & scraping without a browser |

### Keep the relay out of production

Gate `embed.js` on your build's development flag so real visitors never probe `127.0.0.1:9333`:

```jsx
// Next.js / React
{process.env.NODE_ENV === 'development' && (
  <script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4/dist/browser/embed.js" />
)}
```

```astro
---
// Astro
---
{import.meta.env.DEV && (
  <script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4/dist/browser/embed.js"></script>
)}
```

---

## The JavaScript API & Universal Scraper

### Universal scraping with `scrape()` and `extractMeta()` (`@agenticschema/core`)

`@agenticschema/core` has zero runtime dependencies and runs in Node, Bun, Deno, Cloudflare Workers, or the browser:

```js
import { scrape, extractMeta } from '@agenticschema/core';
import { schemaOrgProfiles } from '@agenticschema/profiles';

const result = scrape(htmlOrDocument, {
  ...schemaOrgProfiles,
  baseUrl: 'https://shop.example.com/p/backpack',
  fallback: true, // enabled by default in scrape()
});

result.primary;      // Primary entity as clean JSON (e.g. { type: 'Product', name: '...', ... })
result.entities;     // All non-action entities materialized on the page
result.meta;         // { title, description, canonical, language, openGraph, twitter }
result.actions;      // [{ name: 'search_web_site', type: 'SearchAction', parameters: ['q'], required: ['q'] }]
result.tools;        // Ready-to-call ToolDescriptor[] (with execute())
result.diagnostics;  // Diagnostic[]
```

### Filtering and paginating `list_*` group tools

When a page publishes multiple secondary entities of the same type (e.g. 30 related products or reviews), AgenticSchema collapses them into a single `list_<type>` tool instead of flooding the agent with 30 tools. Every `list_*` tool supports built-in filtering and pagination:

```js
const listProducts = result.tools.find((t) => t.name === 'list_product');

// Filter case-insensitively by keyword and paginate:
const page1 = await listProducts.execute({
  query: 'waterproof',
  limit: 5,
  offset: 0,
});
```

### Browser programmatic API (`@agenticschema/browser`)

```js
import { start } from '@agenticschema/browser';

const handle = await start({
  maxTools: 12,
  actions: 'auto',
  fallback: true,
  allowedHosts: ['api.example.com'],
  exposedTo: ['https://partner.example.com'],
});

handle.tools();         // ToolDescriptor[]: what is currently registered
handle.diagnostics();   // Diagnostic[]: what the pipeline skipped, and why
await handle.refresh(); // remap now; a no-op if the markup has not changed
handle.stop();          // unregister everything and stop watching
```

`start()` accepts every [pipeline option](#every-pipeline-option) plus five browser-specific options:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `document` | `Document` | the page's own | The document to read. |
| `watch` | `boolean` | `true` | Follow route changes and markup edits (including container insertions and `[itemprop]`/`[property]` mutations) in SPAs. |
| `debounceMs` | `number` | `250` | How long to wait after a DOM change before remapping. |
| `exposedTo` | `readonly string[]` | `undefined` | Cross-origin parent origins allowed to call tools when embedded in an iframe. |
| `modelContext` | `ModelContext` | `document.modelContext` | The WebMCP surface to register on. Injectable for tests. |

In compliance with the W3C WebMCP specification, `@agenticschema/browser` passes strictly opt-in annotations (`readOnlyHint: true`, `untrustedContentHint: true`, `consequentialHint: true` when applicable, never `: false`) to `document.modelContext.registerTool()`.

---

## The core pipeline

```js
import { toTools } from '@agenticschema/core';

const { tools, diagnostics, graph } = toTools(documentOrHtmlString, options);
```

```
                    ┌──────────────── @agenticschema/core ─────────────────┐
 Document │ HTML    │                                                      │
 │ JSON-LD ───────► │  extract ──► normalize ──► select ──► map ──► guard  │ ──► ToolDescriptor[]
                    └──────────────────────────────────────────────────────┘
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
             @agenticschema/browser                   @agenticschema/server
             document.modelContext                    stdio / fetch handler / CLI JSON
             (script tag, WebMCP)                     (works with any MCP client today)
```

| Stage | Does |
| --- | --- |
| **extract** | Pulls out JSON-LD, Microdata ($O(N)$), and RDFa ($O(N)$), plus optional OpenGraph / Twitter Card / `<meta>` / `<form>` fallback nodes. |
| **normalize** | Flattens `@graph`, resolves `@id`, strips vocabulary prefixes, merges nodes sharing an `@id`, guards against prototype pollution (`__proto__`, `toString`). |
| **select** | Identifies the primary subject of the page (`mainEntity`, `mainEntityOfPage`, `about`, or non-boilerplate root) and suppresses page chrome and protocol machinery (`EntryPoint`, `*Action`). |
| **map** | Applies type profiles (case-insensitively, following dotted paths like `hasVariant.offers`), transitively deduplicates materialized child entities, and memoizes static read payloads. |
| **guard** | Validates tool names, strips HTML/control characters, caps payloads with a UTF-8 fast path, and wraps `execute()` in an error boundary returning `{ isError: true }`. |

### Every pipeline option

| Category | Option | Type | Default | What it does |
| --- | --- | --- | --- | --- |
| **Extraction** | `formats` | `Array<'jsonld' \| 'microdata' \| 'rdfa'>` | all three | Which structured data syntaxes to read. |
| **Extraction** | `fallback` | `boolean` | `false` (`true` in `scrape()`) | Synthesize entities from OpenGraph, Twitter Cards, `<meta>`, and `<form method="get">` when Schema.org markup is absent. |
| **Normalisation** | `baseUrl` | `string` | page URL in browser | Base for resolving relative `@id` values and deriving `pageOrigin`. |
| **Normalisation** | `maxDepth` | `number` | `12` | Maximum nesting depth before emitting `depth-limit`. |
| **Mapping** | `profiles` | `Profile[]` | generic profile only | Type profile registry (`@agenticschema/profiles` supplies 20+ curated profiles). |
| **Mapping** | `ancestorsOf` | `(type: string) => string[]` | none | Schema.org 924-class hierarchy resolver from `@agenticschema/profiles`. |
| **Mapping** | `maxTools` | `number` | `24` | Ceiling on generated tools (`tool-limit` diagnostic). |
| **Actions** | `actions` | `'auto' \| 'off'` | `'auto'` | `'off'` disables executable tool generation. |
| **Actions** | `pageOrigin` | `string` | derived from `baseUrl` | Origin that action URLs are vetted against. |
| **Actions** | `allowedHosts` | `readonly string[]` | `[]` | Extra hosts allowed beyond `pageOrigin`. |
| **Actions** | `timeoutMs` | `number` | `10000` | Per-request timeout on action `fetch` calls. |
| **Actions** | `fetchImpl` | `typeof fetch` | global `fetch` | Custom `fetch` implementation. |
| **Guard** | `maxDescriptionLength` | `number` | `320` | Maximum length of a tool description. |
| **Guard** | `maxPayloadBytes` | `number` | `32000` | Maximum UTF-8 byte length of a tool result (`field-truncated`). |
| **Custom** | `custom` | `readonly CustomTool[]` | `[]` | Hand-declared tools (`defineTool`). Wins on name clashes. |

---

## The Node server & CLI scraper

`@agenticschema/server` fetches pages concurrently (with scheme and credential validation), parses HTML with `linkedom` when needed (skipping DOM construction entirely on JSON-LD-only pages), and speaks MCP 2026-07-28 over stdio or HTTP — or outputs scraped JSON directly.

```bash
npx @agenticschema/server <url> [<url>...] [options]
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--json` | off | Scrape all given URLs concurrently and print structured JSON (`primary`, `entities`, `meta`, `actions`, `tools`) to stdout instead of starting an MCP server. |
| `--fallback` | off | Synthesize Schema.org entities and search actions from OpenGraph, Twitter Cards, `<meta>`, and `<form method="get">` when Schema.org is missing. |
| `--max-tools <n>` | `24` | Cap on generated tools per page. |
| `--no-actions` | actions on | Do not build executable tools from `potentialAction`. |
| `--allow-host <host>` | none | Extra host allowed for actions. Repeatable. |
| `--http` | off | Serve MCP over HTTP instead of stdio. Binds `127.0.0.1` only, with body-size cap (`413 Payload Too Large` above 1 MB) and Host/Origin validation. |
| `--port <n>` | `3111` | Port for `--http`. |
| `--quiet` | off | Keep diagnostics off stderr. |
| `-h`, `--help` | n/a | Print usage and exit. |

### Over HTTP / Cloudflare Workers

```js
import { createHttpHandler } from '@agenticschema/server';

const handler = await createHttpHandler(['https://example.test/product'], {
  fallback: true,
});

export default { fetch: (request) => handler.fetch(request) };
```

Results of `tools/list`, `resources/list`, and `resources/read` include the MCP 2026-07-28 `ttlMs` (`300000` ms default) and `cacheScope` (`public` for tool listings, `private` for page resources) cache hints.

---

## Deep dive: the 177-page corpus & 120-trial benchmark

### How the corpus is built and measured

The 177 pages in the corpus are pulled from an immutable Common Crawl snapshot (`CC-MAIN-2026-30`) via byte-range WARC requests so reruns are 100% reproducible and never touch live origin servers:

```bash
npm run corpus:fetch                  # fetch from Common Crawl into fixtures/local
npm run corpus:report                 # inspect raw page types independent of AgenticSchema
npm install --no-save gpt-tokenizer   # optional: enable o200k_base token columns
npm run test:corpus                   # run all 177 pages through the pipeline
```

What improves token efficiency so sharply across the corpus:
- **Transitive entity deduplication (`markMaterialized`)**: When `get_recipe` or `get_product` materializes child entities inline (`Offer`, `AggregateRating`, `NutritionInformation`, `Person`, `HowToSection`, `ImageObject`) up to depth 2, those child entities are marked consumed and never re-emitted as separate duplicate tools. This eliminated **149 redundant tools** across the corpus (from 900 down to **751 tools**) and brought recipes from `3,787` tokens (`0.4×` vs text) down to **`1,514` tokens (`1.0×` vs text)**.
- **Boilerplate & machinery suppression**: Navigation `ItemList`s, `WPHeader`/`WPFooter`, `BreadcrumbList`, and protocol nodes (`EntryPoint`, `SearchAction`) are suppressed when a primary subject exists, so `SearchAction` becomes a callable `search_*` action tool and never a noisy `get_search_action` read tool.
- **Dotted-path resolution (`ReadSpec.from`)**: Real-world e-commerce pages store variant prices in `hasVariant.offers` (46 of 75 shop pages in the corpus are `ProductGroup`s) and group ratings in `isVariantOf.aggregateRating`. Following multi-hop paths took e-commerce price accuracy from `8/11` to **`11/11` (100%)**.

Full details are in [docs/corpus.md](docs/corpus.md) and [docs/bench.md](docs/bench.md).

---

## Security

The library takes untrusted page content and puts it into an AI model's context. Six defences are enforced in `core` and inherited by every adapter:

1. **Prompt injection isolation**: Page text never enters a tool's `name` or `description` — only its data payload. `@type` is used for naming only when it matches `/^[A-Za-z][A-Za-z0-9]{0,39}$/`; hostile `@type` strings containing instructions fall back to `Thing`. All descriptions and materialized data strings are stripped of HTML tags and control characters in guaranteed $O(N)$ linear time.
2. **Untrusted content annotations**: Browser tools carry `untrustedContentHint: true` on `document.modelContext` so the host agent knows tool outputs originate from third-party page markup.
3. **SSRF & exfiltration prevention on `urlTemplate`**:
   - Only idempotent action types (`SearchAction`, `FindAction`, `ReadAction`, `ViewAction`) with `GET` are auto-exposed. Side-effecting actions (`OrderAction`, `POST`, etc.) are skipped with an `action-skipped` diagnostic.
   - Destinations must be `http:`/`https:`, carry no embedded credentials (`user:pass@`), and match `pageOrigin` (or `allowedHosts`) **both before and after** RFC 6570 level-1 template expansion.
   - Placeholders in the scheme, host, port, or protocol-relative authority (`//{host}/...`) are rejected at map time.
   - Action requests pass `redirect: 'error'` so a `3xx` redirect cannot escape the origin check.
4. **HTML action response cleaning & structured HTTP errors**: When an action endpoint returns an HTML page instead of JSON, `<script>`, `<style>`, `<svg>`, `<noscript>`, and markup tags are stripped before payload capping. HTTP `4xx`/`5xx` responses return `isError: true` with structured recovery hints (`code`, `retryable`, `suggestion`).
5. **Prototype pollution immunity**: JSON-LD, Microdata, and RDFa extractors and normalizers block `__proto__`, `constructor`, and `prototype` keys and check `Object.hasOwn()` everywhere, preventing crashes or pollution from properties named `toString` or `valueOf`.
6. **Tool & payload budgets**: Tool count is capped at `maxTools` (default `24`) and output size at `maxPayloadBytes` (default `32,000` bytes, cut cleanly on UTF-8 code-point boundaries).

Read [SECURITY.md](SECURITY.md) for the complete threat model.

---

## Custom tools

For actions with side effects (`POST`, checkout, booking) or private API endpoints, declare custom tools via `custom` / `defineTool()`:

```js
import { start } from '@agenticschema/browser';

start({
  custom: [{
    name: 'check_stock',
    description: 'Check in-store availability for a postal code.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { postalCode: { type: 'string', description: '5-digit postal code' } },
      required: ['postalCode'],
      additionalProperties: false,
    },
    execute: async ({ postalCode }) => ({
      content: [{ type: 'text', text: await (await fetch(`/api/stock?cap=${postalCode}`)).text() }],
    }),
  }],
});
```

Custom tools pass through the same guard (name validation, description sanitization, payload cap, and async error boundary) and take precedence over generated tools on name clashes.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tools visible in DevTools → Application → WebMCP, but external MCP client shows **0 sources** | Registration done, transport missing | Add the relay embed tag in dev, or use `@agenticschema/server`. See [Choosing a transport](#choosing-a-transport) |
| Page has no JSON-LD / Microdata / RDFa and produces 0 tools | Site only publishes OpenGraph or `<meta>` tags | Pass `fallback: true`, `--fallback`, or `data-fallback` on the `<script>` tag |
| A `data-*` option has no effect | `type="module"` on a self-hosted `src` without `agenticschema` in the filename | Drop `type="module"`, or add `data-agenticschema` |
| The script tag never runs | CSP blocks `cdn.jsdelivr.net` | Allow it in `script-src`, or self-host `dist/cdn/auto.js` |
| No action tool from a `SearchAction` | Cross-origin target, `POST`, placeholder in host, or no `baseUrl`/`pageOrigin` | Check `diagnostics` for `action-skipped`; pass `baseUrl` when running headless |
| `list_*` instead of several `get_*` | Same-type secondary entities collapse into one filterable tool | Pass `{ query, limit, offset }` when calling `list_*` |

---

## Packages

| Package | Purpose |
| --- | --- |
| [`@agenticschema/core`](packages/core) | Extraction, normalization, selection, mapping, guarding, and `scrape()`. Zero runtime dependencies. |
| [`@agenticschema/profiles`](packages/profiles) | 20+ curated Schema.org type profiles + compact 924-class Schema.org inheritance hierarchy. |
| [`@agenticschema/browser`](packages/browser) | W3C WebMCP adapter (`document.modelContext`). Self-contained IIFE script-tag build (~30.6 KB gzip, polyfill included). |
| [`@agenticschema/server`](packages/server) | MCP 2026-07-28 server over stdio and HTTP (`createServer`, `createHttpHandler`) + concurrent multi-page scraper (`scrapePages`, `--json`). |

---

## Development

```bash
npm install
npm test          # 286 tests across 16 test files in < 1s
npm run typecheck # strict TypeScript check across all workspaces
npm run build     # build all 4 packages + CDN IIFE bundle
npm run size      # enforces single-file IIFE < 30 KB (30,720 B) gzipped
```

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Status and disclaimer

Early, pre-1.0, API not stable. WebMCP is a W3C specification in active browser rollout (available in Chrome via `chrome://flags/#enable-web-model-context` / `#enable-webmcp-testing` and Chrome 149+ origin trial; polyfilled automatically everywhere else).

**Provided as is, with no warranty of any kind, express or implied.** See [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md).

MIT.
