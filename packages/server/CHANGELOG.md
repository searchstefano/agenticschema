# @agenticschema/server

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
