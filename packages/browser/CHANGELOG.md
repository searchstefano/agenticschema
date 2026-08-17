# @agenticschema/browser

## 0.3.1

### Patch Changes

- Updated dependencies [300e864]
  - @agenticschema/core@0.3.1
  - @agenticschema/profiles@0.3.1

## 0.3.0

### Minor Changes

- 104f1c8: `start()` now returns the pipeline's diagnostics. The `Handle` gains
  `diagnostics()`, alongside `tools()`: unparsable JSON-LD blocks, actions refused
  and the reason, fields truncated. Until now the browser adapter collected the
  array and threw it away, so the only way to find out why a tool was missing was
  to call `toTools()` by hand.

  The array is replaced on every remap rather than appended to, so in a
  single-page app it describes the current route and not the history of the tab.
  After `stop()` it reads empty, as `tools()` does. Both accessors hand back a
  copy: the signature says `readonly`, which settles it for TypeScript, but this
  handle's main audience reaches it through a script tag, from plain JavaScript,
  where nothing stopped a caller from emptying the adapter's own state.

  Two conditions the adapter could not previously report now have codes of their
  own, `remap-failed` and `no-webmcp-surface`, added to `DiagnosticCode` in the
  core. A browser without WebMCP used to be indistinguishable, to anything reading
  diagnostics, from a page where everything went fine.

  Fixes a remap that failed leaving the adapter frozen for the rest of the
  session. The markup fingerprint was recorded before the work succeeded, so after
  a failure every later refresh found it already stored and returned without doing
  anything, while the registered tools went on describing the page the user had
  left. The fingerprint is now recorded only on success, the stale tools are
  dropped rather than left in place, and the failure is reported. Along with it, a
  remap triggered by the single-page-app watcher no longer escapes as an unhandled
  rejection in the host page.

### Patch Changes

- Updated dependencies [104f1c8]
- Updated dependencies [d9b5c6a]
  - @agenticschema/core@0.3.0
  - @agenticschema/profiles@0.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [682de47]
- Updated dependencies [e76ced9]
  - @agenticschema/core@0.2.3
  - @agenticschema/profiles@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [ff18644]
- Updated dependencies [ff18644]
- Updated dependencies [ff18644]
  - @agenticschema/core@0.2.2
  - @agenticschema/profiles@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [49cee61]
- Updated dependencies [44a8127]
  - @agenticschema/core@0.2.1
  - @agenticschema/profiles@0.2.1

## 0.2.0

### Minor Changes

- 54164e7: Build the script-tag bundle as an IIFE, so it works through a tag manager.

  Google Tag Manager and Cloudflare Zaraz inject a plain `<script src>` and never set
  `type="module"`. The CDN build was ESM, so loading it that way was a syntax error before a line
  of it ran — `Unexpected token 'export'` — and setting `type="module"` by hand is not something a
  tag manager's UI generally lets you do. Between the two there was no way to ship the adapter
  through the tooling most sites actually use to add a script.

  The bundle at `unpkg`/`jsdelivr` (`dist/cdn/auto.js`) is now an IIFE under the global
  `agenticschema`. It is valid both with and without `type="module"`, so every tag already in the
  wild keeps working, and the README snippet drops the attribute. The npm builds are untouched and
  still ESM: `import { start } from '@agenticschema/browser'` is unaffected.

  Dropping `type="module"` also brings back `document.currentScript`, which a classic script has
  even when a tag manager inserted it. So `data-*` options are read straight off the tag, without
  depending on the marker or on the filename — which matters, since tag managers often serve
  third-party scripts from their own proxy under a name with no `agenticschema` in it.

  The size check gained a third promise to go with the other two: the built entry has to compile
  as a classic script. This shipped because nothing asserted it, and the failure is invisible from
  the TypeScript.

  **Breaking, narrowly:** importing the CDN URL as an ES module —
  `import { ready } from 'https://cdn.jsdelivr.net/npm/@agenticschema/browser/dist/cdn/auto.js'` —
  no longer works. Read `window.agenticschema.ready` instead, or import from the npm package. The
  bundled demo page did exactly that and has been updated.

### Patch Changes

- fa1c56c: Fix the script-tag build ignoring every `data-*` option on the snippet the README gives.

  The auto entry located its own tag through `document.currentScript`, falling back to
  `script[data-agenticschema]`. But `document.currentScript` is `null` inside a module script —
  the HTML spec requires it — and the documented snippet is `type="module"`. So the fallback was
  the only path that ever ran on a real page, and it needed a marker attribute the README never
  mentioned. Anyone setting `data-max-tools`, `data-actions`, `data-watch` or `data-allow-hosts`
  on the plain snippet got defaults instead, silently: the page kept working, registered tools
  under a configuration nobody asked for, and said nothing. Measured on a page with three JSON-LD
  blocks, `data-max-tools="2"` produced 5 tools.

  The tag is now also matched by `script[src*="agenticschema"]`, which the CDN snippet satisfies,
  so the plain copy-paste is configurable. `data-agenticschema` still works and is still the way
  to configure a self-hosted build whose filename the selector cannot guess.

  No test covered the script-tag entry at all, which is how this shipped. There is one now.

## 0.1.2

### Patch Changes

- 7f2d7a0: Fix the script-tag build, which registered no tools at all on browsers without native WebMCP.

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

- Updated dependencies [a37d1aa]
  - @agenticschema/core@0.1.1
  - @agenticschema/profiles@0.1.1

## 0.1.0

### Minor Changes

- First release. Turns the Schema.org markup a page already has into MCP tools, with a browser adapter over WebMCP and an MCP server for any URL.

### Patch Changes

- Updated dependencies
  - @agenticschema/core@0.1.0
  - @agenticschema/profiles@0.1.0
