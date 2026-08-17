---
'@agenticschema/server': patch
---

Parse with `linkedom` instead of `happy-dom`.

About four times faster on the pages that need a parser at all, and since
parsing is nearly all of the time from a page to tools, that is most of the
end-to-end difference. Together with only building a DOM when the page carries
microdata or RDFa, the corpus goes from 35.5 ms to 5.1 ms a page.

Speed is the smaller half. `happy-dom` emulates a browser, so it can load what a
page points at — that was closed by turning six settings off and bounding the
timers, which works, but it is a defence that has to be remembered and sits one
careless option away from coming back. `linkedom` is a parser and nothing else:
`htmlparser2`, `css-select` and `cssom` underneath it, no HTTP client anywhere in
the tree, no script evaluation, no timers to bound. The socket-level test
asserting that parsing fetches nothing now passes because there is nothing that
could fetch, rather than because six flags are set correctly. `happy-dom` is no
longer a dependency of this package; it stays a dev dependency, where simulating
a browser is the point.

Checked before the swap rather than after: all 177 corpus pages were run through
`toTools` with both parsers and compared on tool names, descriptions, input
schemas, annotations and diagnostic codes. All 177 agreed.

`parseDocument` also stopped throwing on input with no elements in it. `linkedom`
leaves such a document without a root element, and `head` and `body` then throw
rather than being absent — an empty response, a plain-text error page or a bare
doctype was enough to do it. It now builds the shell a browser would, keeping the
text of a page that is only text.

Dropping `happy-dom` also uncovered something it had been hiding. This package
uses `process`, `Buffer` and `node:http` across `cli.ts`, and never declared
`@types/node` for any of them — the types resolved only because `happy-dom`
depended on `@types/node` and npm nested a copy inside this workspace. Removing
it took them away and the declaration build stopped compiling a global it had
always used. `@types/node` is now a declared dev dependency and the tsconfig
names it outright, so the build no longer rests on what a runtime dependency
happens to drag in.

The tradeoff, stated plainly: `htmlparser2` is not a spec-compliant HTML5 tree
builder, so on badly broken markup it can build something a browser would not.
The corpus suite is what guards that, and `npm run test:corpus` is the gate for
any future change here.
