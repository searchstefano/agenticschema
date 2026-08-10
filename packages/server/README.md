# @agenticschema/server

MCP server exposing any URL's Schema.org markup, over stdio or HTTP.

```bash
npx @agenticschema/server https://en.wikipedia.org/wiki/Backpack   # stdio
npx @agenticschema/server https://example.test/product --http      # 127.0.0.1:3111
```

`createHttpHandler()` returns the same mapping as a fetch-shaped handler, for a
Worker or any HTTP runtime that speaks `Request`/`Response`.

Works with any MCP client today. Unlike the browser adapter it also exposes
entities as MCP resources.

Part of [agenticschema](https://github.com/searchstefano/agenticschema) — turning the
Schema.org markup a page already has into MCP tools an agent can call. See the root
README for the full picture, the security model, and how the pieces fit together.

MIT.
