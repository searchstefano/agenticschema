# @agenticschema/server

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
