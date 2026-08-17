---
'@agenticschema/core': patch
'@agenticschema/server': patch
---

Read the ld+json type attribute the way a parser does, and stop building a DOM
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
