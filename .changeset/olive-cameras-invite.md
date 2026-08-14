---
'@agenticschema/browser': minor
'@agenticschema/core': minor
---

`start()` now returns the pipeline's diagnostics. The `Handle` gains
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
