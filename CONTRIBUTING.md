# Contributing

Thanks for looking. This is a small project maintained in spare time — issues and pull requests
are welcome, but there is no guaranteed response time and not every proposal will be a fit.

## Getting set up

```bash
npm install
npm test
```

Node 20 or newer. The repo is npm workspaces; there is no separate bootstrap step.

```bash
npm run typecheck   # tsc, no emit
npm run build       # all four packages, in dependency order
npm run size        # fails if the browser payload exceeds its budget
```

Tests resolve workspace packages to their **sources**, not their builds, so you do not need to
build before running them.

## How the pieces fit

```
core       extract -> normalize -> select -> map -> guard, emits ToolDescriptor[]
profiles   type profiles + the Schema.org hierarchy, injected into core
browser    registers descriptors on document.modelContext
server     registers them on an MCP server
```

`core` knows nothing about MCP or the DOM, and that is deliberate — it is what makes the pipeline
testable in isolation and reusable by adapters that do not exist yet. Please keep it that way:
transport-specific code belongs in an adapter.

Two constraints that are easy to break by accident:

- **`core` has no runtime dependencies.** Adding one is a real decision, not a convenience.
- **The browser payload has a budget** (see `scripts/check-size.mjs`). CI fails if it is exceeded.
  Anything large belongs behind a dynamic `import()`, the way profiles are.

## Changes that need a test

Anything touching `guard/` or `map/actions.ts`. Those enforce the security properties described
in [SECURITY.md](SECURITY.md) — an untested change there is not reviewable.

The most useful tests are the ugly ones. Real markup is malformed, uses `http://schema.org`,
nests six levels deep, and repeats the same type nine times. `packages/core/test/corpus.test.ts`
exists for exactly that, and the fixtures beside it are synthetic on purpose: JSON-LD from a real
site is that site's content, and this repo should not redistribute it. Use `npm run corpus:fetch`
to pull real pages into `fixtures/local/`, which is not tracked.

## Style

Match what is already there. Comments should explain *why* a decision was made, not restate what
the line does — most of the existing ones exist because the obvious approach was wrong for a
reason worth recording.

Tool descriptions and diagnostics are in English: a language model reads them, on pages in any
language.

## Pull requests

Keep them focused — one concern per PR. Run `npm test` and `npm run typecheck` first.

Add a changeset if your change affects a published package:

```bash
npm run changeset
```

For anything larger than a bug fix, open an issue first. It is disappointing to have a big PR
turned down over a direction disagreement that a five-line issue would have surfaced.

## Licence

By contributing you agree that your contributions are licensed under the MIT licence, the same as
the rest of the project.
