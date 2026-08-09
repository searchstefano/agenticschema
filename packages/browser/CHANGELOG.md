# @agenticschema/browser

## 0.1.2

### Patch Changes

- 7f2d7a0: Fix the script-tag build, which registered no tools at all on browsers without native WebMCP.

  The WebMCP polyfill was imported through a variable, so esbuild could not see the import and
  left the bare specifier `@mcp-b/webmcp-polyfill` in the bundle. A browser has no resolver for
  that, the import threw, and the failure was swallowed: `start()` returned an empty handle and
  said nothing. Anyone without a WebMCP-capable browser or extension got a page that looked
  fine and exposed nothing.

  The CDN build also shipped as an entry plus a chunk. Relative chunk imports resolve against
  the URL the entry was served from, so the short `/npm/@agenticschema/browser` URL — the one
  the README gave — looked for the chunk one directory too high and 404'd, losing the profiles
  and falling back to generic tool names. The build is now a single self-contained file, which
  is correct from any URL. It costs nothing in practice: the profiles are needed on every
  mapping, so the chunk was fetched on every page anyway.

  Both fallbacks now warn on the console instead of degrading in silence, and `npm run size`
  fails the build on any import a browser cannot resolve.

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
