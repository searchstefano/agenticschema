---
'@agenticschema/browser': minor
---

Build the script-tag bundle as an IIFE, so it works through a tag manager.

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
