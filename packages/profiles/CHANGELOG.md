# @agenticschema/profiles

## 0.4.0

### Patch Changes

- Updated dependencies [7c15c1f]
- Updated dependencies [7c15c1f]
  - @agenticschema/core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [300e864]
  - @agenticschema/core@0.3.1

## 0.3.0

### Minor Changes

- d9b5c6a: Follow a property one hop further, and reach the price and the rating of a
  product whose page is built around variants.

  On real shop pages the fact an agent wants is often one step from where the
  vocabulary suggests, and a profile could only name one property to follow. Two
  consequences, mirror images of each other, both found by the agent benchmark in
  `docs/bench.md`:

  - A `ProductGroup` carries no `offers` of its own. Every price sits in
    `hasVariant[].offers`, often under the misspelled `"@type": "offer"`, so no
    price tool was generated at all and the variants that did get listed had their
    offers stripped by `pick`. Asked what the product cost, an agent was told the
    markup did not say — on a page carrying thirteen prices.
  - A page about a single variant has a `Product` with `isVariantOf` pointing up,
    and the reviews belong to the group. `ratingValue: 4.45, reviewCount: 147` sat
    one hop away with no tool able to reach it.

  `ReadSpec.from` now accepts a dotted path, resolved one reference hop at a time,
  and a list of such paths where the first that resolves wins. The product profile
  uses both:

  - `get_product_variants` returns each variant with its own price, from
    `hasVariant` or `isVariantOf.hasVariant`. The variants rather than their
    offers, because `sku`, `color` and `size` live on the variant while the price
    lives a hop below it — thirteen prices with nothing to attach them to do not
    answer "what does the large blue one cost".
  - `get_product_rating` reads `aggregateRating`, falling back to
    `isVariantOf.aggregateRating`. Candidates rather than two entries: a page
    carrying the rating in both places emitted `get_product_rating` and
    `get_product_rating_2`, identical in description, with no way for an agent to
    choose between them.

  An entity a path passes through counts as described, so reaching a group's
  rating through `isVariantOf` no longer leaves the group free to produce a second
  copy of every product tool. Targets are deduplicated, so thirteen colours
  sharing one price return one offer rather than that price thirteen times.

  Additive: a path whose hops do not resolve produces no tool, so pages without
  variants are unchanged. 46 of the 75 shop pages in the project's corpus are
  `ProductGroup`s and 21 carry `hasVariant`.

### Patch Changes

- Updated dependencies [104f1c8]
- Updated dependencies [d9b5c6a]
  - @agenticschema/core@0.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [682de47]
- Updated dependencies [e76ced9]
  - @agenticschema/core@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [ff18644]
- Updated dependencies [ff18644]
- Updated dependencies [ff18644]
  - @agenticschema/core@0.2.2

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
