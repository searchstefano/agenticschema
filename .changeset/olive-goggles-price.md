---
'@agenticschema/core': minor
'@agenticschema/profiles': minor
---

Follow a property one hop further, and reach the price and the rating of a
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
