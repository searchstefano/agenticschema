---
'@agenticschema/browser': patch
---

Fix the script-tag build ignoring every `data-*` option on the snippet the README gives.

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
