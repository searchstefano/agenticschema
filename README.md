# AgenticSchema &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/searchstefano/agenticschema/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@agenticschema/core.svg?style=flat)](https://www.npmjs.com/package/@agenticschema/core) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/searchstefano/agenticschema/blob/main/CONTRIBUTING.md)

**Turn any webpage into typed JSON, callable MCP / WebMCP tools, or AI-native Epistemic Context — in 3 ms, using 2.7× to 28× fewer tokens than a text scraper and up to 1,449× fewer than raw HTML.**

Human scrapers treat a webpage as a flat text document. An LLM doing Live Search experiences the web completely differently: it already has language in its pre-trained weights, suffers from Transformer self-attention dilution on rhetorical filler, is vulnerable to temporal drift on old articles, and needs active navigation toward hidden APIs and primary sources. **AgenticSchema** closes that gap for both sides of the web:

- **For AI Live Search, scrapers & agent pipelines (`@agenticschema/core`, `@agenticschema/server`)**: Extract normalized entities, Dual-Plane Canonical Evidence Graphs (`evidence`) with zero-bloat Inline Epistemic Sigils (`[✓S1]`, `[~S2]`, `[#S3]`, `[§S4]`), Multi-Facet Epistemic Sufficiency Verdicts (`sufficiency`: `ANSWERABLE` | `PARTIAL_ESCALATE` | `ABSTAIN`), Surprisal-Distilled Epistemic Atoms (`atoms`), Relativistic Temporal Cones (`temporal`), Shadow JSON APIs (`machineTwins`), Information-Foraging Frontier Hops (`frontier`), Adaptive `L0 -> L1 -> L2` Wavefronts (`forageUrls`), and Copy-Discounted Bayesian Truth Fusion (`fuseUrls`).
- **For website owners (`@agenticschema/browser`)**: Drop one `<script>` tag onto your site to expose your existing markup as W3C **WebMCP** tools on `document.modelContext`. You write no new API and run no backend.

```
                         Website / HTML (442 KB mean)
                                      │
          JSON-LD · Microdata · RDFa · OpenGraph · <dl>/<table> · __NEXT_DATA__
                                      ▼
                            AgenticSchema (3 ms)
                                      │
      ┌───────────────────┬───────────┴───────────┬───────────────────┐
      ▼                   ▼                       ▼                   ▼
  L0 Pulse           Submodular b=120        L1 Epistemic        MCP / WebMCP
 (99 tokens)          (110 tokens)           (413 tokens)       (1,013 tokens)
 1,449× vs HTML      1,305× vs HTML          348× vs HTML        142× vs HTML
      └───────────────────┴───────────┬───────────┴───────────────────┘
                                      ▼
                     AI Agent (or npx @agenticschema/server --live)
```

---

## Why AgenticSchema beats normal scraping: the numbers

Everything below is measured and reproducible from this repository (`npm run test:corpus` and `npm run bench:report`) across **177 real pages** pulled from Common Crawl (shops, news, recipes, reference, books) and **120 agent trials**.

### 1. Token & payload compression vs. HTML and text scrapers

Tokens per page, averaged across all **177 real pages** (`442.0 KB` mean raw HTML), counted with `o200k_base`:

| What the model reads | Mean tokens / page | Mean size / page | vs. Raw HTML | vs. Competent text scraper |
| --- | ---: | ---: | ---: | ---: |
| **Raw HTML**, as served | 143,770 | 442.0 KB | — | — |
| **Extracted text** (Readability-style scraper: `<script>`, `<style>`, markup stripped) | 2,752 | ~11.2 KB | 52× | — |
| **AgenticSchema MCP tools** (`toTools` — full deduplicated entities + tools) | **1,013** | **3.0 KB** | **142×** | **2.7×** |
| **AgenticSchema `toContext L1`** (Epistemic Core: Schema + Specs + Surprisal Atoms + Inline Sigils) | **413** | **1.2 KB** | **348×** | **6.7×** |
| **AgenticSchema `toContext` Submodular** (Multi-Facet Query Bottleneck, hard `budget=120`) | **110** | **0.4 KB** | **1,305×** | **25×** |
| **AgenticSchema `toContext L0` Pulse** (1-line Semantic DNA strand with `[✓S1]`/`[~S2]` sigils) | **99** | **276 B** | **1,449×** | **28×** |

Nobody serious feeds raw HTML to a model: a competent scraper strips the markup first, accounting for 52× of the reduction. **Against a competent text scraper, AgenticSchema cuts token consumption by another 2.7× (full MCP tools), 6.7× (`L1` Epistemic Core), 25× (Multi-Facet Submodular Query Bottleneck under a strict `120`-token ceiling), and 28× (`L0` Holographic Pulse)** — while returning machine-typed fields and verified epistemic claims instead of unstructured paragraphs:

| Vertical | Pages | Raw HTML | Text scraper | MCP `tools` | `L1` Epistemic | Submodular (`b=120`) | `L0` Pulse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **book** (Goodreads) | 2 | 287,454 | 11,534 | **191** *(61×)* | **460** *(25×)* | **100** *(115×)* | **95** *(121×)* |
| **reference** (Wikipedia, MDN) | 50 | 62,730 | 3,699 | **208** *(18×)* | **550** *(6.7×)* | **108** *(34×)* | **121** *(31×)* |
| **ecommerce** (IKEA, Patagonia, Backcountry) | 75 | 240,151 | 2,912 | **1,567** *(1.9×)* | **412** *(7.1×)* | **112** *(26×)* | **99** *(29×)* |
| **news** (Al Jazeera) | 25 | 90,530 | 882 | **528** *(1.7×)* | **259** *(3.4×)* | **110** *(8.0×)* | **67** *(13×)* |
| **recipe** (Marmiton) | 25 | 58,454 | 1,549 | **1,514** *(1.0×)* | **292** *(5.3×)* | **109** *(14×)* | **89** *(17×)* |
| **All corpus pages (mean)** | **177** | **143,770** | **2,752** | **1,013 *(2.7×)*** | **413 *(6.7×)*** | **110 *(25×)*** | **99 *(28×)*** |

*(Multipliers in parentheses are vs. a competent text scraper on the same vertical.)*

### 2. AI-Native Live Search Signals extracted across the 177 real pages

Beyond schema normalization, `toContext()`, `forageUrls()`, and `fuseUrls()` extract six AI-native layers that traditional text scrapers discard or miss completely:

| AI-Native Layer | Measured on 177-page Corpus | What it gives the LLM during Live Search |
| --- | ---: | --- |
| **Dual-Plane Evidence Graph & Inline Sigils** (`evidence`) | **100% of structured & tabular facts** | Typed `EvidenceNode[]` in code + zero-bloat 2-token sigils in the prompt (`[✓S1]` corroborated in DOM prose, `[~S2]` unverified markup, `[#S3]` `<dl>`/`<table>`/SSR, `[§S4]` prose atom, `[!CONFLICT]`). |
| **Multi-Facet Sufficiency Calculus** (`sufficiency`) | **110 tokens mean** *(at `budget=120`)* | Decomposes multi-part queries into orthogonal facets, maximizes $U(f,q) = R(f,q) \cdot C(f) \cdot T(f) \cdot N(f \mid S)$ so no single facet monopolizes the budget, and outputs `ANSWERABLE`, `PARTIAL_ESCALATE`, or `ABSTAIN`. |
| **Surprisal-Distilled Epistemic Atoms** (`atoms`) | **679 verified atoms** *(3.8 / page)* | Strips zero-surprise rhetorical filler and requires a non-parametric anchor (quantity/unit, constraint/negation, or temporal date) subordinated to query relevance. |
| **Relativistic Temporal Light-Cone** (`temporal`) | **125 / 177 pages (71%)** | Anchors `publishedAt` / `modifiedAt` / `priceValidUntil`, flags expired offers (`⚠️EXPIRED_OFFER`), and warns when older pages use indexical words (*"currently"*, *"this year"*, *"latest"*). |
| **Shadow APIs & Machine Twins** (`machineTwins`) | **102 endpoints discovered** | Autodiscovers native JSON/API twins embedded in HTML (`wp-json`, `/llms.txt`, `/_next/data/...json`, canonical Shopify `.json`, RSS/Atom/JSON feeds). |
| **Information-Foraging Frontier** (`frontier`) | **361 high-scent hops** | Scores outbound links by Pirolli-Card Information Scent (filtering out `/login`, `/privacy`, `/cart` chrome and surfacing `.pdf` datasheets, primary studies, `/specs`, and query-matching deep links). |
| **Adaptive `L0 -> L1 -> L2` Wavefront** (`forageUrls`) | **~1,600 tokens total** *(for 10 pages)* | Scans all 10 pages at `L0` (`99` tok), promotes the top 2 to `L1` (`413` tok), and dynamically escalates to `L2` only when `sufficiency.missingFacets` is non-empty. |

### 3. Answer accuracy & hallucination rate (`sonnet`, 120 trials)

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

### 4. Runtime speed & web-scale coverage

| Metric | Value | Why it matters |
| --- | ---: | --- |
| **Pipeline execution time** (`extract` → `guard`) | **3 ms / page** | Identical to stripping HTML tags (`3 ms`). Zero LLM calls during extraction. |
| **Zero-DOM server fast path** (JSON-LD + Microdata + RDFa) | **0 ms DOM parse** | Server/Edge `toContext()` extracts JSON-LD, Microdata, RDFa, `<dl>`/`<table>` specs, and `__NEXT_DATA__` directly from raw HTML without instantiating a DOM. |
| **Streaming Early-Abort** (`earlyAbort: true`) | **Up to 90% less bandwidth** | Aborts the HTTP stream right after `</head>` once structured data is captured. |
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

`search_web_site` is an executable tool derived automatically from the page's `SearchAction`. Run it as an MCP server for Claude Desktop / Cursor / Claude Code / Antigravity, or dump the structured JSON / Epistemic Context directly for Live Search:

```bash
# Start a persistent Live Search MCP server (exposes fetch_evidence, forage_urls, fuse_sources for ANY URL):
npx @agenticschema/server --live

# Or start a page-bound MCP server over stdio for one or more URLs (fetched concurrently):
npx @agenticschema/server https://world.openfoodfacts.org/product/3017620422003

# Or print a 1-turn Hybrid LLM Context (Structured Facts + Specs + Inline Sigils + Deduplicated Prose):
npx @agenticschema/server --context --early-abort https://en.wikipedia.org/wiki/Backpack

# Multi-Facet Submodular Bottleneck: project a page down to a strict 120-token ceiling (~110 tok mean):
npx @agenticschema/server --context --query "waterproof warranty weight" --budget 120 https://en.wikipedia.org/wiki/Backpack

# Holographic Multi-Resolution: get a ~99-token L0 Semantic DNA Pulse or ~413-token L1 Epistemic Core:
npx @agenticschema/server --context --resolution L0 https://en.wikipedia.org/wiki/Backpack

# Adaptive Foveated Wavefront: explore N search results (L0 -> L1 -> automatic L2 escalation on missing facets):
npx @agenticschema/server --forage --query "price weight battery" https://example.com/p1 https://example.com/p2 https://example.com/p3

# Copy-Discounted Knowledge Graph Fusion: fuse N search results via SimHash independence + Bayesian Consensus:
npx @agenticschema/server --fuse --query "price weight battery" https://example.com/p1 https://example.com/p2

# Or scrape any page directly to structured JSON (with OpenGraph/meta/form fallback):
npx @agenticschema/server --json --fallback https://en.wikipedia.org/wiki/Backpack
```

> **Drop-in Agent Skill included:** Point Claude Code, Antigravity, Cursor, or Codex at [`.agent/skills/agentic-live-search/SKILL.md`](.agent/skills/agentic-live-search/SKILL.md) so your AI coding/research agent automatically uses `agenticschema` (`--live` MCP or CLI `--context`/`--forage`/`--fuse`) instead of raw `WebFetch`.

### 2. AI-Native Live Search (`toContext`, `forageUrls` & `fuseUrls`) & Edge Middleware

Human scrapers treat a web page as a static text document. An LLM doing Live Search (`WebFetch`, `OAI-SearchBot`, Perplexity, RAG) experiences the web completely differently: it already has language in its pre-trained weights, suffers from Transformer attention dilution on rhetorical filler, is vulnerable to temporal drift on old articles, and needs active navigation toward hidden APIs and primary sources.

`toContext()`, `forageUrls()`, and `fuseUrls()` implement **7 AI-native paradigms** in ~3 ms per page:
1. **Dual-Plane Canonical Evidence Graph (`evidence`) & Zero-Bloat Inline Epistemic Sigils**:
   - Instead of wrapping every fact in a 60-token JSON object (which would bloat LLM prompts by 7×), AgenticSchema exposes a full typed `EvidenceNode[]` graph (`subject`, `predicate`, `value`, `tier`, `provenance`, `confidence: { extraction, corroboration, freshness, utility }`) in code while embedding **2-token Inline Epistemic Sigils** in the LLM prompt:
     - **`[✓S1]`**: Structured Schema.org/Microdata/RDFa fact **corroborated verbatim in visible DOM text** ($C = 1.0$).
     - **`[~S2]`**: Unverified structured markup not echoed in visible prose ($C = 0.78$).
     - **`[#S3]`**: Tabular `<dl>`/`<table>` specification or SSR hydration state (`__NEXT_DATA__`).
     - **`[§S4]`**: High-surprisal quantitative/constraint/temporal prose atom.
     - **`[!CONFLICT]`**: Explicit contradiction between markup and visible text, or across sources.
2. **Multi-Facet Epistemic Utility & Sufficiency Calculus (`sufficiency`)**:
   - Decomposes multi-part queries into orthogonal **Query Facets** (`facets`) and maximizes marginal epistemic utility $U(f, q) = R(f, q) \cdot C(f) \cdot T(f) \cdot N(f \mid S)$, boosting uncovered facets by $4\times$ so a question like *"What is the price and what is the rating?"* never picks 5 price facts while dropping the rating.
   - Emits an explicit sufficiency verdict: **`ANSWERABLE`**, **`PARTIAL_ESCALATE`**, or **`ABSTAIN`**.
3. **Adaptive Holographic Resolution (`L0 -> L1 -> L2`) & Foveated Wavefront (`foragePages` / `forageUrls`)**:
   - **`L0` Pulse (~99 tokens/page — 1,449× smaller than HTML, 28× smaller than text)**: A 1-line "Semantic DNA strand" (`[L0 Product] Name | [✓S1]price=... | t=2025-11-10 | atoms: [§S4] ... | twin=...`).
   - **`L1` Epistemic Core (~413 tokens/page — 6.7× smaller than text)**: Schema + Specs + Surprisal-Distilled Epistemic Atoms + Temporal Cone + Machine Twins + Frontier (zero narrative prose).
   - **`forageUrls()` Adaptive Escalation**: Scans all $N$ URLs at `L0`, promotes the highest-resonance pages to `L1`, checks `sufficiency.missingFacets`, and **automatically escalates from `L1` to `L2` Deep Inspection** only when a query facet remains unresolved in `L1`.
4. **Surprisal-Driven Epistemic Distillation (`atoms` / `extractEpistemicAtoms`)**: Strips zero-surprise rhetorical scaffolding (*"Furthermore, it is important to note that..."*) and requires a non-parametric anchor (exact quantity/unit, constraint/negation, or temporal date) subordinated to semantic query relevance.
5. **Relativistic Temporal Light-Cone (`temporal` / `computeTemporalCone`)**: Extracts spacetime coordinates (`publishedAt`, `modifiedAt`, `validThrough`), flags expired commercial offers (`⚠️EXPIRED_OFFER`), and anchors indexical time words (*"currently"*, *"this year"*, *"latest"*) in older documents.
6. **Shadow API & Machine-Twin Autodiscovery (`machineTwins` / `discoverMachineTwins`)**: Detects native machine-readable twins hidden inside HTML — WordPress REST API (`application/json`), `/llms.txt`, Next.js SSR data routes (`/_next/data/<buildId>/...json`), Shopify `.json` product endpoints, and `/api/` or `/graphql` routes.
7. **Information Foraging (`frontier`) & Copy-Discounted Bayesian Truth Fusion (`fusePages` / `fuseUrls`)**: Scores outbound links by Pirolli-Card **Information Scent** and resolves cross-source contradictions by detecting syndicated/cloned pages via 64-bit **SimHash Hamming distance ($\le 14$)** and discounting copy clusters by $1 / \sqrt{\text{clusterSize}}$ so cloned aggregators cannot outvote an independent corroborated source.

```js
import { contextPages, forageUrls, fuseUrls, createLiveSearchServer, createAgentMiddleware } from '@agenticschema/server';

// A. Adaptive Foveated Multi-Page Exploration (L0 -> L1 -> automatic L2 escalation on missing facets):
const wavefront = await forageUrls(
  ['https://lab.example/solid-state', 'https://blog.example/tips', 'https://news.example/trends'],
  { query: 'fast charge cycles at -30°C', foveaCount: 1 }
);
console.log(wavefront.context);      // Unified Foveated Wavefront with [✓S1]/[§S4] sigils
console.log(wavefront.sufficiency);  // { verdict: 'ANSWERABLE' | 'PARTIAL_ESCALATE' | 'ABSTAIN', ... }
console.log(wavefront.escalations);  // Automatic L0->L1 and L1->L2 escalations performed

// B. Single-page Live Search with Multi-Facet Submodular Bottleneck or Holographic Resolution:
const [page] = await contextPages(['https://en.wikipedia.org/wiki/Backpack'], {
  query: 'internal frame load capacity',
  resolution: 'L1', // 'L0' (~99 tok pulse) | 'L1' (~413 tok epistemic) | 'L2' (full hybrid)
});
console.log(page.evidence);      // Typed EvidenceNode[] graph (S1:corroborated .. S4:prose)
console.log(page.sufficiency);   // Multi-facet coverage & ANSWERABLE / PARTIAL_ESCALATE / ABSTAIN

// C. Copy-Discounted Multi-Page Knowledge Graph Fusion (SimHash Independence + Bayesian Consensus):
const fused = await fuseUrls(
  ['https://store-a.example/camera', 'https://review-b.example/camera'],
  { query: 'price sensor weight', tokenBudget: 400 }
);

// D. Edge Middleware (Cloudflare Workers / Next.js / Hono):
const agentMiddleware = createAgentMiddleware({ mcpEndpoint: '/mcp' });
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

`@agenticschema/server` fetches pages concurrently (with scheme, credential, and SSRF validation), parses HTML with `linkedom` when needed (skipping DOM construction entirely on JSON-LD-only pages), and speaks MCP 2026-07-28 over stdio or HTTP — or outputs Epistemic Context / scraped JSON directly.

```bash
npx @agenticschema/server [<url>...] [options]
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--live` | off | Start a persistent **Live Search MCP server** over stdio exposing `fetch_evidence`, `forage_urls`, and `fuse_sources` for any public URL on the fly (with SSRF protection). |
| `--context` | off | Generate a 1-turn Hybrid LLM Context (`toContext`: structured facts + `<dl>`/`<table>` specs + inline `[✓S1]`/`[~S2]` sigils + deduplicated prose) and print it to stdout. |
| `--forage` | off | Adaptive Foveated Multi-Page Wavefront (`forageUrls`): scan all URLs at `L0`, promote top resonant pages to `L1`, and auto-escalate to `L2` if query facets remain missing. |
| `--fuse` | off | Multi-Page Knowledge Graph Fusion (`fuseUrls`): SimHash copy-cluster discounting + Bayesian Truth Consensus or Markdown Comparison Matrix. |
| `--resolution <L0\|L1\|L2>` | `L2` | Holographic resolution level (`L0` ~99 tok pulse, `L1` ~413 tok epistemic core, `L2` full hybrid). |
| `--query <text>` | none | Focus extraction via the Multi-Facet Submodular Query Bottleneck and compute `sufficiency`. |
| `--budget <tokens>` | none | Hard BPE-calibrated token ceiling (`tokenBudget`) for `--context`, `--forage`, or `--fuse`. |
| `--json` | off | Scrape all given URLs concurrently and print structured JSON (`primary`, `entities`, `meta`, `actions`, `tools`) to stdout instead of starting an MCP server. |
| `--early-abort` | off | Abort the HTTP response stream right after `</head>` once JSON-LD is found, saving up to 90% of bandwidth on large pages. |
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
