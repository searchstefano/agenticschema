# @agenticschema/profiles

## 0.2.1

### Patch Changes

- 44a8127: Expose `image` on the profiles that describe something you would want to look at, and `logo` on
  `Organization`.

  No profile picked or followed `image`, so it was dropped from every tool the registry produced. An
  agent asked about a product, a recipe or a film got the name, the price and the description, and no
  way to show any of it. `image` sits in the 10M+ domains bucket of the usage statistics schema.org
  publishes from Google's crawl — after `name` and `url` it is about the most widely published
  property there is, and this library was throwing all of it away.

  It also cost a tool slot. An `image` given as one or more `ImageObject` entities was left
  unconsumed, so those entities fell through to the grouping pass and became a `list_media` tool of
  their own: the same pictures, detached from the article they belong to, one of the twenty-four
  slots gone. Picked, they render inline where they belong and the slot goes back to the budget.

  Affected profiles: `product`, `article`, `recipe`, `event`, `movie`, `book`, `business`, `person`,
  `organization`, `application`, `course`, `property`. `media` already carried `contentUrl` and
  `thumbnailUrl`, and profiles like `offer`, `rating` and `job` describe things that have no picture
  of their own.

  Released as a patch, since it restores a property that should never have been dropped. What tools
  return does change all the same, and it is worth knowing about: existing tools gain a field, and a
  page whose only extra entities were images no longer produces `list_media`.

- Updated dependencies [49cee61]
  - @agenticschema/core@0.2.1

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

## 0.1.0

### Minor Changes

- First release. Turns the Schema.org markup a page already has into MCP tools, with a browser adapter over WebMCP and an MCP server for any URL.

### Patch Changes

- Updated dependencies
  - @agenticschema/core@0.1.0
