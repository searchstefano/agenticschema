# AgenticSchema &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/searchstefano/agenticschema/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@agenticschema/core.svg?style=flat)](https://www.npmjs.com/package/@agenticschema/core) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/searchstefano/agenticschema/blob/main/CONTRIBUTING.md)

Turn the Schema.org markup a page already has into MCP tools an AI agent can call.

Most pages already publish structured data. Agents still scrape them. This library closes that
gap: it reads the `JSON-LD`, microdata and RDFa already in the page and emits Model Context
Protocol tools — no new API to write, no backend to run.

```
                    ┌──────────────── @agenticschema/core ─────────────────┐
 Document │ HTML    │                                                      │
 │ JSON-LD ───────► │  extract ──► normalize ──► select ──► map ──► guard  │ ──► ToolDescriptor[]
                    └──────────────────────────────────────────────────────┘
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
             @agenticschema/browser                   @agenticschema/server
             document.modelContext                    stdio / Streamable HTTP
             (script tag, WebMCP)                     (works with any MCP client today)
```

## Try it

Three ways in, in rising order of commitment.

### 1. In the browser, nothing installed

**[Open the playground →](https://searchstefano.github.io/agenticschema/)**

Paste any JSON-LD and watch the tools appear. Try the hostile sample: it is the fastest way to
see what the library *refuses* and why. Alongside it,
[a live page carrying the script tag](https://searchstefano.github.io/agenticschema/demo.html)
for the WebMCP path end to end.

Both pages load the packages from jsDelivr at exact versions, so what you are trying is what
you would ship, not a local build.

### 2. Read a real page from the terminal

```bash
npx @agenticschema/server https://en.wikipedia.org/wiki/Backpack
```

Wire it into Claude Desktop:

```json
{
  "mcpServers": {
    "page": {
      "command": "npx",
      "args": ["-y", "@agenticschema/server", "https://en.wikipedia.org/wiki/Backpack"]
    }
  }
}
```

Every entity also becomes a readable MCP resource, which the browser adapter cannot do.

### 3. On your own site

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@0.1"></script>
```

The page registers its tools through [WebMCP](https://github.com/webmachinelearning/webmcp)
(`document.modelContext`). SPA route changes are picked up automatically.

Three things to know before pasting that in:

- **Pin the version.** The unpinned specifier always serves the latest release, and jsDelivr
  caches unversioned URLs at the edge for days — long enough to keep handing out a build you
  have already replaced. Note that **0.1.1 and earlier register no tools at all** on a browser
  without native WebMCP: the polyfill was left out of the bundle.
- **Content-Security-Policy.** A page with a CSP has to allow `cdn.jsdelivr.net` in
  `script-src`, or the tag never executes. Self-host `dist/cdn/auto.js` if you would rather
  not open the CDN — it is a single self-contained file.
- **Registered is not the same as reachable.** The tag publishes the tools to the page. An
  agent still has to be attached to the tab to call them, through a WebMCP-capable browser or
  an extension. With nothing attached the tools are there and no one is asking.

## What it produces on real pages

Two pages, both openly licensed, run through the pipeline exactly as they are published today:

```
en.wikipedia.org/wiki/Backpack
  read    get_article
  read    get_article_author
  read    get_article_publisher
  read    get_media

world.openfoodfacts.org/product/3017620422003
  read    get_web_site
  read    get_organization
  read    get_search_action
  action  search_web_site(search_term_string)
```

The second one is the interesting case. `search_web_site` is **executable**: an agent holding
it queries Open Food Facts directly, instead of guessing a URL or going through a search
engine. It exists because that page publishes a `SearchAction` whose target sits on its own
origin, which is the only shape that gets past the guard described below.

`get_search_action` in that list is noise — a reader over the action's own definition, which
is of no use to an agent. It is a known rough edge, left visible here rather than trimmed out
of the example.

Sites were picked for their licensing, not their fame. Wikipedia and Open Food Facts both
publish under open licences and permit automated access; plenty of better-known sites forbid
it in their terms, and pointing this tool at them is on you.

## Three constraints that shaped the design

**A page cannot expose an MCP endpoint.** Not "it's hard" — a browser tab cannot listen on a
port. In the browser the transport is `document.modelContext`, provided by the browser itself.
This library is the mapping layer, not a transport.

**WebMCP exposes tools only.** No resources, no prompts — the W3C explainer is explicit. So
entities become *read tools* in the browser. The Node adapter, which speaks full MCP, exposes
them as resources *as well*.

**`potentialAction` is rare in the wild.** In practice it is almost only `SearchAction`, and
Google retired the Sitelinks Searchbox in November 2024, so adoption is falling. Auto-derivation
alone would produce a read-only library. That is why `defineTool()` is a first-class feature,
not an afterthought.

## Actions are deliberately restricted

Read tools are always generated. Executable tools are not:

| Condition | Result |
| --- | --- |
| `SearchAction`, `FindAction`, `ReadAction`, `ViewAction` | eligible |
| `httpMethod` absent or `GET` | eligible |
| Destination same-origin (or explicitly allow-listed) | eligible |
| Anything else — `OrderAction`, `POST`, cross-origin, non-http scheme | **skipped, with a diagnostic** |

A site adding one script tag must not become orderable by any passing agent. Anything with side
effects goes through explicit opt-in:

```js
import { start } from '@agenticschema/browser';

start({
  custom: [{
    name: 'check_stock',
    description: 'Check in-store availability for a postal code',
    inputSchema: {
      type: 'object',
      properties: { postalCode: { type: 'string' } },
      required: ['postalCode'],
      additionalProperties: false,
    },
    execute: async ({ postalCode }) => ({
      content: [{ type: 'text', text: await (await fetch(`/api/stock?cap=${postalCode}`)).text() }],
    }),
  }],
});
```

## Security

The library takes page content and puts it into a model's context. Two attack channels are
closed in `core`, so every adapter inherits them:

- **Prompt injection.** A `ld+json` block injected through UGC or a compromised CMS can carry
  instructions. Page text never enters a tool's *description* — only its *data* — and is
  stripped of HTML and control characters, with length caps.
- **Exfiltration via `urlTemplate`.** A hostile action could point elsewhere and receive the
  parameters. Destinations are same-origin by default, https-only, RFC 6570 level 1 only, and
  re-validated **after** template expansion so a crafted value cannot move the target.

Plus a cap on tool count (default 24) and on payload size, because agents degrade badly with
large or bloated toolsets. Secondary entities of the same type collapse into a single tool —
nine indistinguishable `get_person` tools are useless to an agent; one `list_person` is not.

## Packages

| Package | Purpose |
| --- | --- |
| `@agenticschema/core` | The pipeline. No MCP, no DOM assumptions. Zero runtime dependencies. |
| `@agenticschema/profiles` | ~20 hand-written type profiles + the Schema.org hierarchy. |
| `@agenticschema/browser` | WebMCP adapter. Script-tag build is one self-contained file, 27 KB gzip, polyfill included. |
| `@agenticschema/server` | MCP server over stdio or Streamable HTTP. |

## How it compares

- **`schema-org-mcp`** serves the Schema.org *vocabulary* to an LLM (validate types, generate
  snippets). It does not look at real pages.
- **`wmcp.sh`** is a hosted SaaS doing something adjacent server-side. This is an embeddable
  open-source library, client-side first.
- **`@mcp-b/*`** provide the WebMCP transport and polyfill. This builds on them; it does not
  replace them.

The mapping layer — Schema.org to MCP — is the part that did not exist.

## Development

```bash
npm install
npm test          # 100 tests, including a corpus captured from real pages
npm run typecheck
npm run build
npm run size      # fails if the script-tag build has an import a browser cannot
                  # resolve, or goes over 30 KB gzip
```

`npm run corpus:fetch` refreshes the real-page fixtures.
`npm run build:hierarchy -w @agenticschema/profiles` regenerates the Schema.org type hierarchy.

## Status and disclaimer

Early, pre-1.0, API not stable. WebMCP itself is a proposal — Chrome 151 ships it only behind
`--enable-experimental-web-platform-features`, which is why the polyfill is a hard dependency of
the browser adapter rather than an optional one.

**Provided as is, with no warranty of any kind, express or implied.** Use at your own risk. The
author accepts no liability for any damage, data loss, security incident, or other consequence
arising from use of this software — see the MIT licence for the binding terms. If you put this in
front of an agent that can act on someone's behalf, read [SECURITY.md](SECURITY.md) first: it
sets out what the threat model does and, more importantly, does not cover.

MIT.
