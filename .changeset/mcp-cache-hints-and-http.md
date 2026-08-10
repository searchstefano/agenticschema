---
'@agenticschema/server': minor
---

Emit the 2026-07-28 cache hints, and serve over HTTP as well as stdio.

The revision requires `ttlMs`/`cacheScope` on cacheable results, and the SDK fills the most
pessimistic pair it has when the server says nothing: `ttlMs: 0`, `cacheScope: 'private'`. That
told every client to refetch a listing that cannot have changed — pages are read once at startup
and never refetched. Listings now carry 5 minutes and `public`, since the guard keeps page text
out of tool descriptions and leaves nothing in them belonging to whoever asked. `resources/read`
carries the same lifetime but stays `private`: that is the page's own content, and a caller can
hand us `html` from somewhere we know nothing about. `cacheTtlMs` changes it, `0` restores the
old behaviour.

Found while wiring this up: the hints were first passed as part of the server's *identity*
object, whose contents are echoed to every client in `_meta`. Configuration put there ships on
the wire on every response. There is now a test asserting the identity carries nothing but
`name` and `version`.

`createHttpHandler()` serves the same mapping as a fetch-shaped handler, for a Worker or any
runtime that speaks `Request`/`Response`, and `--http` runs it from the CLI on `127.0.0.1`
behind the SDK's host and origin checks. Pages are read once when the handler is built rather
than per request: the revision is stateless and the SDK builds a server per request, but
refetching the origin that often is neither ours to spend nor theirs to absorb.

The root README claimed Streamable HTTP that no code provided. It is now true.
