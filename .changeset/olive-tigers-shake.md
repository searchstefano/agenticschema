---
'@agenticschema/browser': patch
'@agenticschema/core': patch
---

Stop the adapter registering the same tools twice, which WebMCP answers with
`InvalidStateError: Duplicate tool name`.

Three separate routes led there, all of them fixed:

- **Two copies on one page.** The CDN build is an IIFE, so a page carrying the
  script twice — typically a hand-written tag plus a tag manager's, pinned to
  different versions — evaluated it twice and started twice. The script-tag entry
  point now latches on the document: a second copy reuses the first one's handle,
  registers nothing, and warns that its configuration is being ignored.
- **Two remaps overlapping.** `refresh()` recorded the markup fingerprint only
  after the profiles chunk had loaded, so a remap arriving in that window walked
  past the "nothing changed" guard and re-registered the whole batch. The
  fingerprint is now claimed up front, and a superseded remap bows out instead of
  registering. The same fix stops a batch being registered against a later
  batch's `AbortSignal`, which had been leaving tools that no abort could retire.
- **A refused registration escaping.** `registerTool` was called without anything
  attached to its promise, so a rejection surfaced in the host page's console as
  an uncaught error. It is now reported as a `register-failed` diagnostic, a new
  `DiagnosticCode`.
