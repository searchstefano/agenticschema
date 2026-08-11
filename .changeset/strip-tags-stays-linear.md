---
'@agenticschema/core': patch
---

Strip tags in linear time, so a hostile page cannot stall the guard.

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
