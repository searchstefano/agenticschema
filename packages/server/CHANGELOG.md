# @agenticschema/server

## 0.3.1

### Patch Changes

- 300e864: Read the ld+json type attribute the way a parser does, and stop building a DOM
  for pages that have nothing to gain from one.

  Two changes to the same seam, found while measuring where the time from a page
  to tools actually goes. On the 177-page corpus it is 93% happy-dom parsing, 6.4%
  walking the DOM for markup, and 0.6% everything else — normalizing, mapping,
  guarding, all of it.

  **The string path missed entity-encoded types.** `extract` scanned for a literal
  `type="application/ld+json"`, but the attribute is not always written literally:
  marmiton.org serves `type="application&#x2F;ld&#x2B;json"`. The DOM path decodes
  it and finds the block; the string path compared raw text and found nothing, on
  13 of 177 corpus pages. The only thing reported was `no-structured-data` at
  `info` level, which is what a page with no markup at all looks like, so
  `toTools(html)` returned an empty tool list and nothing said why. The type
  attribute is now decoded before it is compared, and matched case-insensitively,
  because HTML compares `type` that way in selectors and the two paths have to
  agree. They now agree on all 177 pages.

  **A DOM is only built when the page can repay it.** The new `needsDocument(html)`
  answers whether anything on the page needs a real tree: microdata anchors on
  `itemscope`, RDFa on `typeof`, and JSON-LD needs neither. `createServer` uses it
  to pass the HTML string straight through when no DOM is warranted, which is 71%
  of the corpus — roughly 2x overall, and 19-70x on pages carrying JSON-LD alone.
  Pages with real RDFa, such as MDN's, are unaffected: they genuinely need the
  parse. The check errs towards building a DOM, since a false positive costs one
  parse that finds nothing while a false negative would drop an entity, and it does
  not try to tell a schema.org `typeof` from another vocabulary's, because that
  judgement needs the parsed value.

  **Scanning is now linear.** The single pattern spanning `<script ...>…</script>`
  restarted at every opening tag that never closed: 20k of them took about four
  seconds, on input fetched from whatever URL the caller passed. Positions are now
  found once, by a scan that only moves forward, which puts those cases under a
  millisecond. Two of the three pathological inputs predate this release and one
  came from reading the type out of every script tag rather than only the matching
  ones; all three are closed, and a regression test sits beside the equivalent one
  for `sanitizeText`.

- 300e864: Parse with `linkedom` instead of `happy-dom`.

  About four times faster on the pages that need a parser at all, and since
  parsing is nearly all of the time from a page to tools, that is most of the
  end-to-end difference. Together with only building a DOM when the page carries
  microdata or RDFa, the corpus goes from 35.5 ms to 5.1 ms a page.

  Speed is the smaller half. `happy-dom` emulates a browser, so it can load what a
  page points at — that was closed by turning six settings off and bounding the
  timers, which works, but it is a defence that has to be remembered and sits one
  careless option away from coming back. `linkedom` is a parser and nothing else:
  `htmlparser2`, `css-select` and `cssom` underneath it, no HTTP client anywhere in
  the tree, no script evaluation, no timers to bound. The socket-level test
  asserting that parsing fetches nothing now passes because there is nothing that
  could fetch, rather than because six flags are set correctly. `happy-dom` is no
  longer a dependency of this package; it stays a dev dependency, where simulating
  a browser is the point.

  Checked before the swap rather than after: all 177 corpus pages were run through
  `toTools` with both parsers and compared on tool names, descriptions, input
  schemas, annotations and diagnostic codes. All 177 agreed.

  `parseDocument` also stopped throwing on input with no elements in it. `linkedom`
  leaves such a document without a root element, and `head` and `body` then throw
  rather than being absent — an empty response, a plain-text error page or a bare
  doctype was enough to do it. It now builds the shell a browser would, keeping the
  text of a page that is only text.

  Dropping `happy-dom` also uncovered something it had been hiding. This package
  uses `process`, `Buffer` and `node:http` across `cli.ts`, and never declared
  `@types/node` for any of them — the types resolved only because `happy-dom`
  depended on `@types/node` and npm nested a copy inside this workspace. Removing
  it took them away and the declaration build stopped compiling a global it had
  always used. `@types/node` is now a declared dev dependency and the tsconfig
  names it outright, so the build no longer rests on what a runtime dependency
  happens to drag in.

  The tradeoff, stated plainly: `htmlparser2` is not a spec-compliant HTML5 tree
  builder, so on badly broken markup it can build something a browser would not.
  The corpus suite is what guards that, and `npm run test:corpus` is the gate for
  any future change here.

- Updated dependencies [300e864]
  - @agenticschema/core@0.3.1
  - @agenticschema/profiles@0.3.1

## 0.3.0

### Patch Changes

- d103e9c: Stop the DOM parser fetching whatever a page points at.

  `parseDocument` built its happy-dom window with default settings, and happy-dom
  loads external resources by default. Parsing a page therefore issued requests for
  its stylesheets and iframes, to urls chosen by that page. On a server that is a
  request originating inside the operator's network — link-local metadata
  addresses included — and it bypassed every check the rest of this library applies
  before touching a destination: action tools are vetted for same origin and
  refuse redirects, while the parser underneath them was following anything in a
  `<link href>` or an `<iframe src>`.

  Script evaluation, script loading, stylesheet loading, iframe loading and image
  loading are now all disabled, and timers are bounded. A regression test asserts
  against a real socket rather than a stubbed `globalThis.fetch`: happy-dom loads
  resources through its own client, so the stubbed version of that test passed
  while the leak was wide open.

- Updated dependencies [104f1c8]
- Updated dependencies [d9b5c6a]
  - @agenticschema/core@0.3.0
  - @agenticschema/profiles@0.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [682de47]
- Updated dependencies [e76ced9]
  - @agenticschema/core@0.2.3
  - @agenticschema/profiles@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [ff18644]
- Updated dependencies [ff18644]
- Updated dependencies [ff18644]
  - @agenticschema/core@0.2.2
  - @agenticschema/profiles@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [49cee61]
- Updated dependencies [44a8127]
  - @agenticschema/core@0.2.1
  - @agenticschema/profiles@0.2.1

## 0.2.0

### Minor Changes

- 0e6c58a: Emit the 2026-07-28 cache hints, and serve over HTTP as well as stdio.

  The revision requires `ttlMs`/`cacheScope` on cacheable results, and the SDK fills the most
  pessimistic pair it has when the server says nothing: `ttlMs: 0`, `cacheScope: 'private'`. That
  told every client to refetch a listing that cannot have changed — pages are read once at startup
  and never refetched. Listings now carry 5 minutes and `public`, since the guard keeps page text
  out of tool descriptions and leaves nothing in them belonging to whoever asked. `resources/read`
  carries the same lifetime but stays `private`: that is the page's own content, and a caller can
  hand us `html` from somewhere we know nothing about. `cacheTtlMs` changes it, `0` restores the
  old behaviour.

  Found while wiring this up: the hints were first passed as part of the server's _identity_
  object, whose contents are echoed to every client in `_meta`. Configuration put there ships on
  the wire on every response. There is now a test asserting the identity carries nothing but
  `name` and `version`.

  `createHttpHandler()` serves the same mapping as a fetch-shaped handler, for a Worker or any
  runtime that speaks `Request`/`Response`, and `--http` runs it from the CLI on `127.0.0.1`
  behind the SDK's host and origin checks. Pages are read once when the handler is built rather
  than per request: the revision is stateless and the SDK builds a server per request, but
  refetching the origin that often is neither ours to spend nor theirs to absorb.

  The root README claimed Streamable HTTP that no code provided. It is now true.

## 0.1.1

### Patch Changes

- a37d1aa: Ignore RDFa terms that belong to other vocabularies.

  RDFa is a generic mechanism and plenty of sites use it for their own purposes.
  MediaWiki annotates its own markup with `typeof="mw:Transclusion"`,
  `mw:File/Thumb`, `mw:Entity` and similar — a single Wikipedia article carries
  over 160 of them. All of these were being extracted as entities, so a real page
  produced eleven junk tools out of fourteen, crowding out the ones that mattered.

  Terms are now accepted only when they resolve to Schema.org: bare (`Product`),
  prefixed (`schema:Product`), or as a full IRI (`https://schema.org/Product`).
  The same filter applies to RDFa `property` attributes. JSON-LD and microdata
  extraction are unaffected.

  Package descriptions are now in English, matching the rest of the published
  metadata.

- Updated dependencies [a37d1aa]
  - @agenticschema/core@0.1.1
  - @agenticschema/profiles@0.1.1

## 0.1.0

### Minor Changes

- First release. Turns the Schema.org markup a page already has into MCP tools, with a browser adapter over WebMCP and an MCP server for any URL.

### Patch Changes

- Updated dependencies
  - @agenticschema/core@0.1.0
  - @agenticschema/profiles@0.1.0
