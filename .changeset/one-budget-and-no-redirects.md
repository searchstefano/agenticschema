---
'@agenticschema/core': patch
---

Put action tools under the tool cap, and stop their requests following redirects.

Two things `SECURITY.md` claimed that the code only half did.

**The cap covered read tools only.** `maxTools` lived in `mapToTools`, and `mapActions` had no
count of its own, so `toTools` concatenated an unbounded list onto a bounded one. A `WebSite`
whose `potentialAction` array held two hundred same-origin GET `SearchAction`s produced 202 tools
with `maxTools: 24` — every one of them registered with the WebMCP surface or the MCP server,
since nothing downstream caps count either. All the attacker has to meet is that each
`urlTemplate` points at the page's own origin, which on a page they are injecting into is free.
`mapActions` now takes the same budget, and the pipeline hands it whatever the read tools left:
what a page is about is worth more than its search box, so reads still spend first. The check
sits before the destination is vetted rather than after, because vetting parses a URL and the
page chooses how many there are.

**The action fetch followed redirects.** Destinations are checked before the request and again
after template expansion, and then `fetch` was called with no `redirect` option — which means
`follow`. A 3xx from the validated origin went anywhere it liked, past both checks: on the server
a request onto the host's own network, link-local metadata included; in the browser the same
request leaving with the user's cookies. It now sets `redirect: 'error'`. Following manually and
re-vetting the `Location` was the other option, but a browser hands back an opaque response for a
redirect, so there is no `Location` to re-vet on that side — and a site that genuinely needs the
hop can declare the tool with `defineTool`, where the behaviour is its own.
