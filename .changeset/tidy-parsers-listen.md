---
'@agenticschema/server': patch
---

Stop the DOM parser fetching whatever a page points at.

`parseDocument` built its happy-dom window with default settings, and happy-dom
loads external resources by default. Parsing a page therefore issued requests for
its stylesheets and iframes, to urls chosen by that page. On a server that is a
request originating inside the operator's network — link-local metadata
addresses included — and it bypassed every check the rest of this library applies
before touching a destination: action tools are vetted for same origin and
refuse redirects, while the parser underneath them was following anything in a
`<link href>` or an `<iframe src>`.

Script evaluation, script loading, stylesheet loading, iframe loading and image
loading are now all disabled, and timers are bounded. A regression test asserts
against a real socket rather than a stubbed `globalThis.fetch`: happy-dom loads
resources through its own client, so the stubbed version of that test passed
while the leak was wide open.
