---
'@agenticschema/core': minor
'@agenticschema/browser': minor
---

Carry cancellation through to the work a tool actually does, keeping up with
WebMCP as of Chrome 153.

`ToolDescriptor.execute` and `CustomTool.execute` take an optional second
argument, `{ signal }`. The parameter is optional in both directions, so a tool
that ignores it still compiles and `defineTool` is unchanged for anyone.

The signal is what an action's `fetch` is now bound by, alongside its existing
timeout. This matters because from Chrome 153 taking a tool out of the registry
no longer cancels its in-flight executions: without this, a single-page app that
changed route left the previous route's request running to timeout — in the
browser, with the user's cookies on it. The browser adapter combines the signal
WebMCP passes with the one belonging to the registered batch, so both a remap
and `stop()` reach the request.

Also fixed: `guardTools` wrapped every tool's `execute` and dropped the second
argument, which would have disarmed cancellation for the entire toolset no
matter who passed a signal in.

`ModelContext.registerTool` is typed as returning `Promise<void>`, matching
Chrome 151. No change was needed for `navigator.modelContext` being deprecated in
Chrome 150: the adapter has always read `document.modelContext` first and treated
`navigator` as the fallback.
