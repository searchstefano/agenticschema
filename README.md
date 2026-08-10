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

---

## Contents

- [Read this first: registration is not transport](#read-this-first-registration-is-not-transport)
- [Quick start — copy and paste](#quick-start--copy-and-paste)
- [Try it without committing to anything](#try-it-without-committing-to-anything)
- [The script tag, in full](#the-script-tag-in-full)
  - [How the adapter finds its own tag](#how-the-adapter-finds-its-own-tag)
  - [Every attribute](#every-attribute)
  - [Content-Security-Policy](#content-security-policy)
  - [Version pinning](#version-pinning)
- [Choosing a transport](#choosing-a-transport)
  - [What `embed.js` actually does](#what-embedjs-actually-does)
  - [Keep the relay out of production](#keep-the-relay-out-of-production)
- [The JavaScript API](#the-javascript-api)
- [The core pipeline](#the-core-pipeline)
  - [Every pipeline option](#every-pipeline-option)
  - [Diagnostics](#diagnostics)
- [The Node server](#the-node-server)
- [What it produces on real pages](#what-it-produces-on-real-pages)
- [Three constraints that shaped the design](#three-constraints-that-shaped-the-design)
- [Actions are deliberately restricted](#actions-are-deliberately-restricted)
- [Custom tools](#custom-tools)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Known rough edges](#known-rough-edges)
- [Packages](#packages)
- [How it compares](#how-it-compares)
- [Development](#development)
- [Status and disclaimer](#status-and-disclaimer)

---

## Read this first: registration is not transport

This is the single thing that trips people up, so it comes before everything else.

Getting a page's data to an agent takes **two** steps, and this library only does the first one:

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

`@agenticschema/browser` writes tools into `document.modelContext`. That is the whole job. It
does **not** open a connection to anything, because a browser tab cannot listen on a port —
see [Three constraints](#three-constraints-that-shaped-the-design).

So after adding the script tag you have a page whose tools are correctly registered and that
**no agent can reach yet**. Nothing is broken; the second half is simply not there. You pick the
transport separately, and the choice depends on who is meant to call the tools —
see [Choosing a transport](#choosing-a-transport).

The symptom of forgetting step ② is very specific and worth recognising: **the tools show up in
Chrome DevTools (Application panel) but your MCP client reports zero sources.** DevTools reads
`document.modelContext` in-process; your MCP client is a separate program that cannot. Everything
is working, and nothing is connected.

---

## Quick start — copy and paste

Two tags. The first registers the tools, the second carries them to a local MCP client such as
Claude Desktop, Cursor or Claude Code.

```html
<!-- ① registration: read this page's Schema.org markup, publish it as WebMCP tools -->
<script type="module" data-agenticschema
        src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@0.1.2"></script>

<!-- ② transport (development only): bridge those tools to a local MCP relay -->
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4/dist/browser/embed.js"></script>
```

Then run the relay and point your MCP client at it:

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

Open the page, and the tools appear in your client. Verify with `webmcp_list_sources` — your tab
should be listed with a tool count above zero.

Four things worth knowing before you paste that in:

- **Order matters.** The relay embed reads whatever is already registered and subscribes to
  changes, so put it after the registration tag.
- **Self-hosting the bundle under a different filename?** Add `data-agenticschema` to the tag,
  or its `data-*` options are silently ignored — see
  [below](#how-the-adapter-finds-its-own-tag).
- **Tag ② is for development.** Shipping it to real visitors makes every one of their browsers
  probe `127.0.0.1` — see [Keep the relay out of production](#keep-the-relay-out-of-production).
- **Pin your versions.** Unversioned jsDelivr URLs are cached at the edge for days, long enough
  to keep serving a build you have already replaced. `@0.1.2` and `@4` above are pins.

If you only want the browser's own built-in agent to use the tools, you need tag ① alone.

---

## Try it without committing to anything

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

No browser, no transport question — the Node adapter fetches the page itself and speaks plain
MCP over stdio:

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

This is the shortest path to seeing real output, and the one with the fewest moving parts. If
you are evaluating the library, start here.

### 3. On your own site

See [Quick start](#quick-start--copy-and-paste) above, then
[The script tag, in full](#the-script-tag-in-full).

---

## The script tag, in full

### How the adapter finds its own tag

To read its `data-*` options the adapter first has to find the tag it was loaded from. In a
**module** script `document.currentScript` is `null` — that is what the HTML specification
requires, not a quirk of your browser — and the snippet everyone pastes is a module script. So
it falls back to searching the document, in this order:

1. `script[data-agenticschema]` — an explicit marker,
2. `script[src*="agenticschema"]` — the src of the standard snippet.

The CDN tag matches rule 2, so the plain snippet is configurable with no marker:

```html
<!-- options are read: the src identifies the tag -->
<script type="module" data-max-tools="8"
        src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@0.1.2"></script>
```

**Self-hosting under a different filename matches neither rule.** Add the marker there:

```html
<!-- nothing in this src says "agenticschema" -->
<script type="module" data-agenticschema data-max-tools="8"
        src="/assets/webmcp-bundle.js"></script>
```

> **Using 0.1.2 or earlier?** Rule 2 did not exist, so `data-agenticschema` was mandatory for
> *any* option to have an effect — and its absence was silent. Measured on one page with three
> JSON-LD blocks, `data-max-tools="2"` without the marker produced 5 tools instead of 2. If you
> are pinned to an old version, keep the marker.

When an option is ignored nothing warns you: the page keeps working and quietly uses defaults,
which is indistinguishable from success until you go counting tools. If you are unsure, adding
the marker is always safe.

### Every attribute

All options are optional. With none of them set you get every default in the right-hand column.

| Attribute | Values | Default | What it does |
| --- | --- | --- | --- |
| `data-agenticschema` | present / absent | absent | Marks the tag so the adapter can find it. Needed only when the script's `src` does not contain `agenticschema` — a self-hosted build under another filename. Always required in 0.1.2 and earlier. |
| `data-actions` | `off` | actions generated | Turns off executable tools entirely. Read tools are unaffected. Use this if you publish a `SearchAction` you would rather agents did not call. |
| `data-max-tools` | integer > 0 | `24` | Ceiling on generated tools. Agents degrade as a toolset grows; a page listing 200 products has no business producing 200 tools. Values that are not a finite number above zero are ignored. |
| `data-watch` | `off` | watching on | Stops the adapter following DOM changes and History API navigations. Turn it off on a static page to save a `MutationObserver`. |
| `data-allow-hosts` | comma-separated hosts | page origin only | Extra hosts an action's destination may point at, beyond the page's own origin. Whitespace around each entry is trimmed. Widening this deliberately widens the exfiltration surface — read [Security](#security) first. |

A page that uses all of them:

```html
<script type="module"
        data-agenticschema
        data-actions="off"
        data-max-tools="8"
        data-watch="off"
        data-allow-hosts="api.example.com, search.example.com"
        src="https://cdn.jsdelivr.net/npm/@agenticschema/browser@0.1.2"></script>
```

Anything not on this list — profiles, payload caps, custom tools, timeouts — is reachable only
from [the JavaScript API](#the-javascript-api). The attribute surface is deliberately the small,
safe subset that makes sense to set from markup.

### Content-Security-Policy

A page with a CSP has to allow `cdn.jsdelivr.net` in `script-src`, or the tag never executes:

```
Content-Security-Policy: script-src 'self' https://cdn.jsdelivr.net;
```

If you would rather not open the CDN, self-host `dist/cdn/auto.js` — it is a single
self-contained file, roughly 27 KB gzipped, with the WebMCP polyfill already inside.

The relay embed from tag ② is a **second** origin to allow, and it also creates a `blob:` iframe
and opens a WebSocket, so its CSP needs are wider:

```
Content-Security-Policy: script-src 'self' https://cdn.jsdelivr.net;
                         frame-src blob:;
                         connect-src ws://127.0.0.1:9333;
```

That is one more reason to keep the relay tag out of your production CSP entirely.

### Version pinning

Use an exact version in production. The unpinned specifier always serves the latest release, and
jsDelivr caches unversioned URLs at the edge for days.

**0.1.1 and earlier register no tools at all** on a browser without native WebMCP: the polyfill
was left out of the bundle, and because the failure was silent the page looked healthy. Use
`@0.1.2` or later.

---

## Choosing a transport

The tools are registered. Something has to carry them to an agent. There are three real options
and one non-option:

| Transport | Who calls the tools | Setup | Good for |
| --- | --- | --- | --- |
| **Native browser WebMCP** | the browser's own agent | none — the browser provides `document.modelContext` | the actual end state of the proposal, once shipped |
| **Local relay** (`embed.js`) | your desktop MCP client: Claude Desktop, Cursor, Claude Code | one script tag + `npx @mcp-b/webmcp-local-relay` | development, testing, personal automation |
| **Browser extension** | whatever the extension is wired to | install the extension | using tools across sites you do not control |
| **Nothing** | nobody | — | registering tools and wondering why no one calls them |

Only the local relay needs anything from your page's HTML. That is the one this section covers,
because it is the one people reach for first and the one whose failure mode is confusing.

Native WebMCP is still behind a flag. Chrome exposes it via `chrome://flags/#enable-webmcp-testing`
(restart required); some builds also need `--enable-experimental-web-platform-features`. Because
it is off by default for nearly everyone, `@mcp-b/webmcp-polyfill` is a hard dependency of the
browser adapter rather than an optional one — the polyfill is the normal case, not the exception.

### What `embed.js` actually does

Worth understanding before you put it on a page, because it does more than load a script:

```
  ┌──────────────────────────────────────┐
  │  Host page                           │
  │  document.modelContext + your tools  │   ← @agenticschema/browser put them here
  └──────────────────┬───────────────────┘
                     │ postMessage
  ┌──────────────────▼───────────────────┐
  │  Hidden iframe (blob: URL)           │   ← embed.js injects this
  │  injected by embed.js                │
  └──────────────────┬───────────────────┘
                     │ WebSocket ws://127.0.0.1:9333
  ┌──────────────────▼───────────────────┐
  │  webmcp-local-relay (Node process)   │   ← npx @mcp-b/webmcp-local-relay
  └──────────────────┬───────────────────┘
                     │ stdio / JSON-RPC
  ┌──────────────────▼───────────────────┐
  │  Claude Desktop / Cursor / any client│
  └──────────────────────────────────────┘
```

Concretely, on every page load it:

1. injects a hidden `<iframe>` from a `blob:` URL,
2. opens a **WebSocket to `ws://127.0.0.1:9333`** from inside that iframe,
3. enumerates the page's tools — `document.modelContext.listTools()` + `callTool()` when present,
   falling back to `navigator.modelContextTesting.listTools()` + `executeTool()`,
4. forwards them to the relay, which re-registers them as ordinary MCP tools over stdio,
5. **reconnects if the relay is not there**, with exponential backoff from 500 ms to 3 s
   (1.5× multiplier), giving up after 100 attempts.

Its own attributes:

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-relay-port` | `9333` | Port to connect to. Must match the relay's `--port`. |
| `data-request-timeout` | `60000` | Per-request ceiling in ms. Raise it if a tool chains slow API calls and might exceed a minute. |

And on the relay process:

```bash
npx @mcp-b/webmcp-local-relay --port 9444 --widget-origin http://localhost:4321
```

`--widget-origin` restricts which host page origins may register tools. The default is `*`,
meaning **any page open in your browser that loads the embed can expose tools to your MCP
client**. That is convenient in development and worth tightening as soon as it is not.

If a second relay instance starts while the port is taken, it does not fail: it falls back to
*client mode* and proxies through the existing one, so several MCP clients can share the same
browser tabs. A `"mode": "client"` in `webmcp_list_sources` output is normal and not a symptom of
anything.

### Keep the relay out of production

Tag ② should not reach real visitors. For each of them it would inject a hidden iframe and
attempt a WebSocket to `127.0.0.1:9333` — a port that, on their machine, is either nothing at all
or something that is none of your business. With the retry policy above that is roughly five
minutes of futile reconnection per page view, plus a page that visibly probes the visitor's own
loopback interface.

Gate it on your build's development flag. In Astro:

```astro
{import.meta.env.DEV && (
  <script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4/dist/browser/embed.js"></script>
)}
```

Next.js:

```jsx
{process.env.NODE_ENV === 'development' && (
  <script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@4/dist/browser/embed.js" />
)}
```

Vite or plain HTML with a bundler: wrap it in `import.meta.env.DEV`, or simply keep the tag in a
local-only template.

Tag ① — `@agenticschema/browser` — is designed to ship. It opens no connections, and on a browser
with no WebMCP and no polyfill available it registers nothing and logs a warning rather than
throwing.

---

## The JavaScript API

For anything the attributes cannot express, import the package instead of using the script tag:

```js
import { start } from '@agenticschema/browser';

const handle = await start({
  maxTools: 12,
  actions: 'off',
  allowedHosts: ['api.example.com'],
});

handle.tools();         // ToolDescriptor[] — what is currently registered
await handle.refresh(); // remap now; a no-op if the markup has not changed
handle.stop();          // unregister everything and stop watching
```

`start()` accepts every [pipeline option](#every-pipeline-option) plus four of its own:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `document` | `Document` | the page's own | The document to read. Lets you map an iframe, or a `linkedom`/`happy-dom` document under test. |
| `watch` | `boolean` | `true` | Follow route changes and markup edits in single-page apps. |
| `debounceMs` | `number` | `250` | How long to wait after a DOM change before remapping. |
| `modelContext` | `ModelContext` | `document.modelContext` | The WebMCP surface to register on. Injectable for tests. |

### The returned `Handle`

| Member | Returns | Notes |
| --- | --- | --- |
| `tools()` | `readonly ToolDescriptor[]` | What is registered right now. |
| `refresh()` | `Promise<void>` | Remaps immediately. Compares a fingerprint of the markup, so it does nothing when nothing changed. |
| `stop()` | `void` | Aborts every registration and detaches the watchers. |

### How watching works

WebMCP has no `unregisterTool`, so the adapter registers every tool with an `AbortSignal` and
aborts the whole batch to replace it. A remap is triggered by:

- a `MutationObserver` on `ld+json` script blocks and on the `itemscope`, `itemprop`, `itemtype`,
  `typeof` and `property` attributes,
- `history.pushState`, `history.replaceState` and `popstate`, because in a single-page app the
  route can change before the new markup arrives.

Both signals are debounced together by `debounceMs`. The comparison is made against a fingerprint
of the *markup*, not of the tool names: when only a price changes the names stay identical while
the tool closures are already stale.

---

## The core pipeline

`@agenticschema/core` has no MCP and no DOM assumptions, and zero runtime dependencies. It turns
a document into tool descriptors and nothing else:

```js
import { toTools } from '@agenticschema/core';

const { tools, diagnostics, graph } = toTools(documentOrHtmlString, options);
```

The five stages:

| Stage | Does |
| --- | --- |
| **extract** | Pulls out the raw structured-data blobs without interpreting them. |
| **normalize** | Flattens `@graph`, resolves `@id`, strips vocabulary prefixes, makes `@type` and all values arrays, hoists nested entities to top level, merges nodes sharing an `@id`. |
| **select** | Decides which entities deserve a tool and which collapse together. |
| **map** | Applies a type profile to produce names, descriptions and JSON Schemas. |
| **guard** | Validates names, cleans descriptions, caps payloads. |

One extraction detail that catches people out: **if `source` is an HTML string, only JSON-LD comes
out.** Microdata and RDFa need a real HTML parser. Pass a `Document` — the browser's own, or one
from `linkedom` or `happy-dom` on Node — to get all three formats.

### Every pipeline option

Shared by `toTools()`, `start()` and `createServer()`.

**Extraction**

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `formats` | `Array<'jsonld' \| 'microdata' \| 'rdfa'>` | all three | Which formats to read. Only `jsonld` has any effect when the source is an HTML string. |

**Normalisation**

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `baseUrl` | `string` | page URL in the browser | Base for resolving relative `@id` values. Also the fallback source of `pageOrigin`. |
| `maxDepth` | `number` | `12` | Maximum nesting depth. The guard against circular references; exceeding it emits a `depth-limit` diagnostic. |

**Mapping**

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `profiles` | `Profile[]` | generic profile only | The profile registry. `@agenticschema/profiles` supplies ~20 hand-written ones. Without it every entity falls back to generic naming. |
| `ancestorsOf` | `(type: string) => string[]` | none | Resolves a Schema.org type's ancestors, so `Vehicle` can use the `Product` profile without anyone declaring it. Also from `@agenticschema/profiles`. |
| `maxTools` | `number` | `24` | Ceiling on generated tools. Hitting it emits a `tool-limit` diagnostic. |

In the browser adapter `profiles` and `ancestorsOf` load automatically, in their own chunk, after
the adapter is already running — they weigh more than everything else combined, and a page that
includes the script should pay as little as possible up front. If that chunk never arrives the
adapter carries on with generic tool names and warns loudly, because tools with generic names look
healthy from the outside.

**Actions**

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `actions` | `'auto' \| 'off'` | `'auto'` | `off` disables executable tool generation entirely. |
| `pageOrigin` | `string` | derived from `baseUrl` | The origin actions are vetted against. **With neither this nor `baseUrl`, no action tools are generated at all** — there is no way to check where a request would go. |
| `allowedHosts` | `readonly string[]` | `[]` | Extra hosts allowed beyond the page's own origin. |
| `timeoutMs` | `number` | `10000` | Ceiling on an action request. Without one, an endpoint that never answers leaves the agent waiting forever. |
| `fetchImpl` | `typeof fetch` | global `fetch` | Injectable for tests and for the server adapter. |

**Guard**

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `maxDescriptionLength` | `number` | `320` | Longest a tool description may be. |
| `maxPayloadBytes` | `number` | `32000` | Ceiling on the bytes a tool may return. Truncation emits `field-truncated`. |

**Custom tools**

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `custom` | `readonly CustomTool[]` | `[]` | Hand-declared tools. On a name clash these win over generated ones. See [Custom tools](#custom-tools). |

### Diagnostics

`toTools()` returns a `diagnostics` array alongside the tools. Nothing throws for page-content
problems — a malformed page produces fewer tools and a diagnostic, never an exception.

| Code | Level | Means |
| --- | --- | --- |
| `json-parse-error` | warn | An `ld+json` block did not parse. The others are still processed. |
| `unknown-context` | warn | A node's `@context` is not recognisable as Schema.org. |
| `depth-limit` | warn | Nesting exceeded `maxDepth`; the branch was cut. |
| `no-structured-data` | info | The page carries none. Not an error. |
| `action-skipped` | info | A `potentialAction` did not pass the rules, with the reason. |
| `tool-limit` | info | `maxTools` was reached and the remainder dropped. |
| `field-truncated` | info | A value was cut to fit `maxPayloadBytes` or `maxDescriptionLength`. |

The Node server prints everything above `info` to stderr unless `--quiet` is passed. In the
browser, read them from `toTools()` directly — `start()` does not surface them.

---

## The Node server

`@agenticschema/server` fetches pages itself and speaks full MCP, so it needs no browser and no
transport decision. It is also the only adapter that can expose **resources**: every entity
becomes a readable MCP resource as well as a tool.

```bash
npx @agenticschema/server <url> [<url>...] [options]
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--max-tools <n>` | `24` | Cap on generated tools. |
| `--no-actions` | actions on | Do not build executable tools from `potentialAction`. |
| `--allow-host <host>` | none | Extra host allowed for actions. Repeatable. |
| `--quiet` | off | Keep diagnostics off stderr. |
| `-h`, `--help` | — | Print usage and exit. |

Multiple URLs are merged into one server. Diagnostics and the tool list go to **stderr**, always —
stdout belongs to the protocol.

Programmatic use:

```js
import { createServer } from '@agenticschema/server';

const { server, tools, diagnostics } = await createServer(
  ['https://example.test/product'],
  { maxTools: 12, actions: 'off', allowedHosts: [] }
);
```

---

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

---

## Three constraints that shaped the design

**A page cannot expose an MCP endpoint.** Not "it's hard" — a browser tab cannot listen on a
port. In the browser the transport is `document.modelContext`, provided by the browser itself.
This library is the mapping layer, not a transport. Everything in
[Read this first](#read-this-first-registration-is-not-transport) follows from this one sentence.

**WebMCP exposes tools only.** No resources, no prompts — the W3C explainer is explicit. So
entities become *read tools* in the browser. The Node adapter, which speaks full MCP, exposes
them as resources *as well*.

**`potentialAction` is rare in the wild.** In practice it is almost only `SearchAction`, and
Google retired the Sitelinks Searchbox in November 2024, so adoption is falling. Auto-derivation
alone would produce a read-only library. That is why `defineTool()` is a first-class feature,
not an afterthought.

---

## Actions are deliberately restricted

Read tools are always generated. Executable tools are not:

| Condition | Result |
| --- | --- |
| `SearchAction`, `FindAction`, `ReadAction`, `ViewAction` | eligible |
| `httpMethod` absent or `GET` | eligible |
| Destination same-origin (or explicitly allow-listed) | eligible |
| Anything else — `OrderAction`, `POST`, cross-origin, non-http scheme | **skipped, with a diagnostic** |

The four eligible types are all idempotent. An `OrderAction` or a `ReserveAction` has consequences
out in the world: generating those automatically would mean that dropping a script onto a site
makes its products orderable by any agent that wanders past.

A skipped action is never silent — it produces an `action-skipped` diagnostic naming the reason.
If you expected an action tool and did not get one, that diagnostic says why.

Anything with side effects goes through explicit opt-in instead.

---

## Custom tools

`custom` is the way in for everything auto-derivation cannot give you: actions with side effects,
private endpoints, anything `potentialAction` does not describe.

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

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `name` | yes | — | Must match what the MCP spec allows; the guard rejects anything else. |
| `description` | yes | — | Capped at `maxDescriptionLength`. |
| `inputSchema` | no | empty object schema | Standard JSON Schema with `additionalProperties: false`. |
| `execute` | yes | — | Returns `{ content: [{ type: 'text', text }] }`, optionally with `isError`. |
| `annotations` | no | `readOnlyHint: false`, `openWorldHint: true` | Defaults assume a hand-declared tool is meant to *do* something — the opposite of generated read tools, which are always `readOnlyHint: true`. |

Custom tools still pass through the guard: names are validated, descriptions cleaned, payloads
capped. They win over a generated tool of the same name.

---

## Security

The library takes page content and puts it into a model's context. Two attack channels are
closed in `core`, so every adapter inherits them:

- **Prompt injection.** A `ld+json` block injected through UGC or a compromised CMS can carry
  instructions. Page text never enters a tool's *description* — only its *data* — and is
  stripped of HTML and control characters, with length caps. HTML tags go first, since they are
  the usual way to hide instructions from a human reader but not from a model.
- **Exfiltration via `urlTemplate`.** A hostile action could point elsewhere and receive the
  parameters. Destinations are same-origin by default, https-only, RFC 6570 level 1 only, and
  re-validated **after** template expansion so a crafted value cannot move the target.

Plus a cap on tool count (default 24) and on payload size, because agents degrade badly with
large or bloated toolsets. Secondary entities of the same type collapse into a single tool —
nine indistinguishable `get_person` tools are useless to an agent; one `list_person` is not.

Two things that are **your** decision, not the library's:

- **`allowedHosts` / `--allow-host` widens the exfiltration surface on purpose.** Every host you
  add is a destination an action's expanded URL may reach. Add hosts you control.
- **The local relay's default `--widget-origin` is `*`.** Any page in your browser that loads the
  embed can register tools with your MCP client. Restrict it once you are past first setup.

If you put this in front of an agent that can act on someone's behalf, read
[SECURITY.md](SECURITY.md) first: it sets out what the threat model does and, more importantly,
does not cover.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tools visible in DevTools → Application, but the MCP client shows **0 sources** | Registration done, transport missing | Add the relay embed tag — [Choosing a transport](#choosing-a-transport) |
| `webmcp_list_sources` returns `count: 0` | The page never opened the WebSocket | Confirm `embed.js` is in the page *and* the relay process is running |
| A `data-*` option has no effect | The adapter cannot identify its own tag: a self-hosted `src` without `agenticschema` in it, or version 0.1.2 or earlier | Add `data-agenticschema` — [How the adapter finds its own tag](#how-the-adapter-finds-its-own-tag) |
| No tools at all, no errors | Version 0.1.1 or earlier on a browser without native WebMCP | Upgrade to `@0.1.2` or later |
| The script tag never runs | CSP blocks `cdn.jsdelivr.net` | Allow it in `script-src`, or self-host `dist/cdn/auto.js` |
| Tools appear with generic names | The profiles chunk failed to load | Check the console for the warning; check CSP and network |
| No action tool from a `SearchAction` | Cross-origin target, `POST`, non-http scheme, or no `pageOrigin` | Read the `action-skipped` diagnostic; set `baseUrl` if running headless |
| `list_*` instead of several `get_*` | Working as intended — same-type entities collapse | Nothing to fix |
| Tools stop updating in an SPA | `data-watch="off"`, or the markup is replaced in a way the observer misses | Remove `data-watch="off"`; call `handle.refresh()` manually |
| Fewer tools than entities | `maxTools` reached | Raise `data-max-tools`; check for the `tool-limit` diagnostic |
| Truncated values in a tool result | `maxPayloadBytes` reached | Raise it via the JS API; check for `field-truncated` |
| `"mode": "client"` in relay output | A second relay instance is sharing the first | Normal, not a fault |
| `Host response timeout` from the relay | A tool took longer than 60 s | Raise `data-request-timeout` on the embed tag |
| Connection refused on the relay port | Port mismatch | `data-relay-port` must equal the relay's `--port` |

---

## Known rough edges

Listed rather than hidden, because finding them yourself costs more than reading them here.

- **Tag identification is heuristic.** `document.currentScript` is `null` in module scripts, so
  the adapter looks for `data-agenticschema` or an `src` containing `agenticschema`. A
  self-hosted build under an unrelated filename and without the marker matches neither, and its
  options are ignored in silence.
- **`get_search_action`** — a read tool over an action's own definition, of no use to an agent.
- **No diagnostics from `start()`.** The browser adapter drops the diagnostics array. Call
  `toTools()` directly to see it.
- **WebMCP has no `unregisterTool`**, so every remap aborts and re-registers the whole batch.
- **Actions need an origin.** Headless use with neither `baseUrl` nor `pageOrigin` silently
  produces no action tools.

---

## Packages

| Package | Purpose |
| --- | --- |
| `@agenticschema/core` | The pipeline. No MCP, no DOM assumptions. Zero runtime dependencies. |
| `@agenticschema/profiles` | ~20 hand-written type profiles + the Schema.org hierarchy. |
| `@agenticschema/browser` | WebMCP adapter. Script-tag build is one self-contained file, 27 KB gzip, polyfill included. |
| `@agenticschema/server` | MCP server over stdio or Streamable HTTP. |

Third-party pieces this works with, both from the `@mcp-b` project: `@mcp-b/webmcp-polyfill`
(a dependency of the browser adapter) and `@mcp-b/webmcp-local-relay` (the optional transport).

---

## How it compares

- **`schema-org-mcp`** serves the Schema.org *vocabulary* to an LLM (validate types, generate
  snippets). It does not look at real pages.
- **`wmcp.sh`** is a hosted SaaS doing something adjacent server-side. This is an embeddable
  open-source library, client-side first.
- **`@mcp-b/*`** provide the WebMCP transport and polyfill. This builds on them; it does not
  replace them.

The mapping layer — Schema.org to MCP — is the part that did not exist.

---

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

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Status and disclaimer

Early, pre-1.0, API not stable. WebMCP itself is a proposal — Chrome 151 ships it only behind a
flag, which is why the polyfill is a hard dependency of the browser adapter rather than an
optional one.

**Provided as is, with no warranty of any kind, express or implied.** Use at your own risk. The
author accepts no liability for any damage, data loss, security incident, or other consequence
arising from use of this software — see the MIT licence for the binding terms. If you put this in
front of an agent that can act on someone's behalf, read [SECURITY.md](SECURITY.md) first: it
sets out what the threat model does and, more importantly, does not cover.

MIT.
