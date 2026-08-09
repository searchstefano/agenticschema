---
'@agenticschema/browser': patch
---

Fix the script-tag build, which registered no tools at all on browsers without native WebMCP.

The WebMCP polyfill was imported through a variable, so esbuild could not see the import and
left the bare specifier `@mcp-b/webmcp-polyfill` in the bundle. A browser has no resolver for
that, the import threw, and the failure was swallowed: `start()` returned an empty handle and
said nothing. Anyone without a WebMCP-capable browser or extension got a page that looked
fine and exposed nothing.

The CDN build also shipped as an entry plus a chunk. Relative chunk imports resolve against
the URL the entry was served from, so the short `/npm/@agenticschema/browser` URL — the one
the README gave — looked for the chunk one directory too high and 404'd, losing the profiles
and falling back to generic tool names. The build is now a single self-contained file, which
is correct from any URL. It costs nothing in practice: the profiles are needed on every
mapping, so the chunk was fetched on every page anyway.

Both fallbacks now warn on the console instead of degrading in silence, and `npm run size`
fails the build on any import a browser cannot resolve.
