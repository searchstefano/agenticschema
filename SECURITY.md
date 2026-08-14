# Security

## No warranty

This is free software published under the MIT licence. It is provided **as is**, without
warranty of any kind. There is no service level agreement, no guaranteed response time, and no
commitment that any given issue will ever be fixed. If you deploy it, you own the outcome —
including any security consequences.

That is not boilerplate. Read the threat model below before putting this in front of an agent
that can act on a user's behalf.

## What this project does

It reads structured data (JSON-LD, microdata, RDFa) that a web page already publishes and turns
it into Model Context Protocol tools. That means it takes **content it does not control** and
places it into the context of a language model that may act on it. That is the whole security
story, and it cuts both ways.

## What it defends against

These are enforced in `@agenticschema/core`, so both adapters inherit them, and each has a test:

- **Prompt injection through page text.** Markup injected via user-generated content or a
  compromised CMS can carry instructions aimed at the agent. Page text never enters a tool's
  *name* or *description* — only the *data* a tool returns, which is stripped of HTML tags and
  control characters and capped per field. The one exception is `@type`, which cannot be kept
  out: it is what a tool gets named after. So it is accepted only where it is shaped like a type
  — one word, letters and digits, 40 characters at most, which every class in the vocabulary fits
  — and becomes `Thing` where it is not. A sentence parked in `@type` has no separators left to
  survive that, which is what keeps prose out of the channel an agent reads as instructions.
- **Exfiltration through `urlTemplate`.** A hostile `potentialAction` could point at another
  host and receive the parameters. Destinations must be same-origin (or explicitly allow-listed),
  http/https only, RFC 6570 level 1 only, and are re-validated **after** template expansion so a
  crafted parameter value cannot move the target. Redirects are refused rather than followed: a
  3xx from the validated origin would otherwise land anywhere it liked, past both checks. A site
  that needs the hop can declare the tool with `defineTool`.
- **Side-effecting actions.** Only idempotent action types with `GET` (or no) `httpMethod` become
  executable tools. `OrderAction`, `ReserveAction`, anything `POST` — skipped, with a diagnostic.
- **Context flooding.** Caps on tool count (default 24) and on returned payload size. Read tools
  and action tools share the one budget, so a page cannot get past it by publishing its flood as
  `potentialAction` instead of as entities.
- **Requests made by the parser itself.** Reading a page server-side means building a DOM from it,
  and a DOM engine loads what the markup points at unless told otherwise: a `<link href>` or an
  `<iframe src>` is enough to make the process issue a request, to a url the page chose. On a
  server that request originates inside the operator's network, link-local metadata addresses
  included, and it would arrive underneath every check above. `parseDocument` disables script
  evaluation, script, stylesheet, iframe and image loading, and bounds timers. The regression test
  asserts against a real socket: happy-dom loads resources through its own client, so a test that
  stubs `globalThis.fetch` passes while the leak is wide open.

## What it explicitly does NOT defend against

- **A hostile site owner.** The protections assume an honest page whose *content* may be tainted.
  If the site itself is adversarial, it controls the markup, the `defineTool` calls, and the
  same-origin endpoints the action tools reach. Nothing here helps.
- **Truthfulness.** Nothing verifies that a page's structured data matches what it displays. A
  site can advertise one price in its markup and another to humans. This library faithfully
  reports the markup.
- **Ambient authority.** In the browser, action tools run inside the page and therefore inside the
  user's authenticated session. An agent invoking one acts with the user's cookies. Same-origin
  is a containment boundary, not an authorisation check.
- **Anything inside `defineTool`.** Tools you declare by hand execute the code you give them, with
  no sandboxing and no `readOnlyHint` by default. Their behaviour is entirely yours.
- **The rest of the chain.** The WebMCP polyfill, the local relay, the browser, and the MCP client
  are separate projects with their own trust assumptions.
- **Resource exhaustion.** The caps are heuristics tuned for typical pages, not guarantees against
  a page built to be pathological.

## Assumptions

The security model holds only if: the page is served over HTTPS, `baseUrl`/`pageOrigin` is set
correctly (without it, no action tools are generated at all), and you have not widened
`allowedHosts` past what you actually trust.

## Reporting a vulnerability

Open a GitHub issue for anything already public. For something not yet public, use GitHub's
**private vulnerability reporting** on this repository rather than a public issue.

Please include a reproduction — ideally a minimal HTML snippet — and what you expected instead.

There is no bounty, no guaranteed timeline, and no obligation to fix. Reports are read and
appreciated; that is the extent of the commitment.

## Supported versions

Pre-1.0. Only the latest release is looked at. There are no backports.
