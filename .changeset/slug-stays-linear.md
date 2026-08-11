---
'@agenticschema/core': patch
---

Keep `toSlug` linear, so a hostile page cannot stall the mapper.

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
