---
'@agenticschema/browser': minor
---

`start()` now returns the pipeline's diagnostics. The `Handle` gains
`diagnostics()`, alongside `tools()`: unparsable JSON-LD blocks, actions refused
and the reason, fields truncated. Until now the browser adapter collected the
array and threw it away, so the only way to find out why a tool was missing was
to call `toTools()` by hand.

The array is replaced on every remap rather than appended to, so in a
single-page app it describes the current route and not the history of the tab.
After `stop()` it reads empty, as `tools()` does.
