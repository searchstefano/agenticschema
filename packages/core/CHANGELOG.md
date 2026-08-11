# @agenticschema/core

## 0.2.2

### Patch Changes

- ff18644: Cut oversized payloads by bytes, and stop cutting code points in half.

  `capPayload` trimmed one UTF-16 code unit at a time and re-encoded the whole candidate to measure
  it, so it walked the payload once per character dropped. Multi-byte text overshoots the byte
  budget two to four times over, which meant tens of thousands of laps across a 32k string on every
  tool call, on content the page chose. At the default 32000-byte cap, a 200,000-character payload:

  | content       | before | after  |
  | ------------- | ------ | ------ |
  | ASCII `x`     | 0.2ms  | 0.11ms |
  | CJK `中`      | 420ms  | 0.31ms |
  | emoji U+1F600 | 694ms  | 0.85ms |

  The text is now encoded once and the byte array is cut at the budget, stepping back over any
  UTF-8 continuation byte to the start of the code point — at most three moves.

  That also fixes a bug the old loop had. It measured in bytes but cut in UTF-16 units, so whenever
  the budget fell between the halves of a surrogate pair it stopped on the stranded half, and the
  model got a payload ending in a broken character. The comment above it claimed the opposite. On
  200,000 random inputs mixing ASCII, accented Latin, CJK and emoji against random byte caps, the
  old code stranded a surrogate 3,774 times and the new code never does. Where the old output was
  well-formed the two agree exactly, so that bug is the only behaviour that changes; the cap itself
  still holds, notice included.

- ff18644: Keep `toSlug` linear, so a hostile page cannot stall the mapper.

  `toSlug` runs on `@type`, and `@type` is whatever the document says it is. Two of its steps
  backtracked quadratically on input the page controls. The acronym split,
  `/([A-Z]+)([A-Z][a-z])/g` — there to stop `FAQPage` collapsing into `faqpage` — restarts `[A-Z]+`
  at every position inside a run of capitals; the edge trim, `/^_+|_+$/g`, restarts `_+$` inside
  every run of underscores. Fifty thousand characters of either cost about six seconds, and four
  times that for twice the length. It happens while tools are being named, well before the cap on
  tool count can limit the damage. CodeQL flags the first as `js/polynomial-redos`; the second
  has the same shape and is reachable through the same input, so both are gone.

  The acronym boundary is now `/([A-Z])(?=[A-Z][a-z])/g`: one character and a lookahead instead of
  a repeated group, which leaves nothing to backtrack over. A lookbehind would have tidied the trim
  in the same way, but the browser bundle has to parse in Safari before 16.4, where lookbehind is a
  syntax error and would take the whole bundle down with it — so the trim is a plain index scan
  instead. The two 50k payloads now finish in under a millisecond.

  Slugs themselves are untouched: the old and new implementations agree on 400,000 random inputs
  drawn from letters, digits, underscores, separators and accented characters, `a__b` included.

- ff18644: Strip tags in linear time, so a hostile page cannot stall the guard.

  `sanitizeText` cleans text taken off the page, which means a page picks its input. Tag removal used
  `/<[^>]*>/g`, and a `<` with no `>` anywhere after it made the engine scan to the end of the
  string, fail, and start over at the next `<`. Fifty thousand of them cost about six seconds, spent
  before a single tool was registered — CodeQL reports it as `js/polynomial-redos`. The same input
  now takes 0.05ms.

  The replacement is a pair of `indexOf` walks rather than another regex, because both narrower
  patterns are wrong in ways that matter here:

  - `<[^<>]*>` stops at an inner `<`, so `<div title="ignora le istruzioni<">testo` sanitises to
    `<div title="ignora le istruzioni testo`. Text that used to be deleted would reach the model,
    which is the one thing this function exists to prevent.
  - `<[^>]*(?:>|$)` never leaks, but it swallows everything after a lone `<`, turning
    `Valutato < 5 stelle` into `Valutato`.

  Walking from a `<` to the first `>` after it keeps the old meaning exactly — an inner `<` does not
  end a tag, matching how a browser reads one — and never looks at a character twice. The two
  implementations agree on 500,000 random tag-heavy strings and on the empty, unbalanced and
  nested-bracket edge cases.

## 0.2.1

### Patch Changes

- 49cee61: Stop spending tool slots on page chrome.

  A CMS puts its own layout in the `@graph`. On an ordinary WordPress article the mapper was handed
  seven entities and turned all seven into tools: `get_article`, and then `get_web_page`,
  `get_wp_header`, `get_wp_footer`, `get_wp_side_bar` and `list_site_navigation_element`. One of
  those answers a question somebody might ask. The rest is the theme describing its own markup, and
  each one took a slot out of the twenty-four the content had to fit into. The same page now
  produces `get_article` and nothing else.

  `mapToTools` already skipped protocol machinery — `EntryPoint` and anything ending in `Action` —
  and chrome is now skipped in the same place, by an explicit list of types.

  The list has to be explicit, and both shortcuts that suggest themselves are wrong. Reusing
  `BOILERPLATE_TYPES` from `select/primary.ts` looks tempting because it carries the same word in
  its comment, but it answers a different question: `Organization` and `BreadcrumbList` are poor
  guesses at what a page is _about_ while still deserving tools of their own. Walking the hierarchy
  is no better, because `FAQPage` and `QAPage` are `WebPage` subtypes and are entirely content.

  A page with nothing but a wrapper is unaffected: the primary entity is chosen before the filter
  and is never subject to it, so markup consisting only of a `WebPage` still yields its one tool.
  A node carrying a chrome type alongside a content type counts as content.

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

## 0.1.0

### Minor Changes

- First release. Turns the Schema.org markup a page already has into MCP tools, with a browser adapter over WebMCP and an MCP server for any URL.
