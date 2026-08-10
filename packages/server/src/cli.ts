#!/usr/bin/env node
import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createHttpHandler, createServer } from './index.js';

const USAGE = `
agenticschema: serve a page's Schema.org markup as an MCP server

  npx @agenticschema/server <url> [<url>...] [options]

Options
  --max-tools <n>     cap on generated tools (default 24)
  --no-actions        do not build executable tools from potentialAction
  --allow-host <host> extra host allowed for actions (repeatable)
  --http              serve over HTTP on 127.0.0.1 instead of stdio
  --port <n>          port for --http (default 3111)
  --quiet             keep diagnostics off stderr

Example entry for claude_desktop_config.json:

  { "mcpServers": {
      "shop": {
        "command": "npx",
        "args": ["-y", "@agenticschema/server", "https://example.test/product"]
      } } }
`;

const DEFAULT_PORT = 3111;

interface Args {
  urls: string[];
  maxTools?: number;
  actions: 'auto' | 'off';
  allowedHosts: string[];
  quiet: boolean;
  http: boolean;
  port: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    urls: [],
    actions: 'auto',
    allowedHosts: [],
    quiet: false,
    http: false,
    port: DEFAULT_PORT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--max-tools') {
      args.maxTools = Number(argv[++i]);
    } else if (arg === '--no-actions') {
      args.actions = 'off';
    } else if (arg === '--allow-host') {
      args.allowedHosts.push(argv[++i] ?? '');
    } else if (arg === '--http') {
      args.http = true;
    } else if (arg === '--port') {
      args.port = Number(argv[++i]);
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      args.urls.push(arg);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.urls.length === 0) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const pipeline = {
  actions: args.actions,
  allowedHosts: args.allowedHosts,
  ...(args.maxTools ? { maxTools: args.maxTools } : {}),
};

const { server, tools, diagnostics } = await createServer(args.urls, pipeline);

if (!args.quiet) {
  // Always stderr. stdout belongs to the protocol.
  const pages = args.urls.length === 1 ? '1 page' : `${args.urls.length} pages`;
  process.stderr.write(`agenticschema: ${tools.length} tools from ${pages}\n`);
  for (const tool of tools) process.stderr.write(`  - ${tool.name}\n`);
  for (const d of diagnostics) {
    if (d.level !== 'info') process.stderr.write(`  [${d.level}] ${d.message}\n`);
  }
}

if (!args.http) {
  await server.connect(new StdioServerTransport());
} else {
  const { createServer: createHttpServer } = await import('node:http');
  const { Readable } = await import('node:stream');
  const handler = await createHttpHandler(args.urls, pipeline);

  createHttpServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk as Buffer);

      const host = incoming.headers.host ?? `127.0.0.1:${args.port}`;
      const request = new Request(`http://${host}${incoming.url ?? '/'}`, {
        method: incoming.method ?? 'GET',
        headers: Object.entries(incoming.headers).flatMap(([k, v]) =>
          v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]]
        ),
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      });

      // A local port is reachable from any page the browser happens to be on,
      // so DNS rebinding is the live risk here rather than a theoretical one.
      // These are the SDK's own checks for exactly this.
      const response =
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins()) ??
        (await handler.fetch(request));

      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      // Piped rather than buffered: a streamed response has to reach the
      // client as it is produced, not once it has finished.
      if (response.body) Readable.fromWeb(response.body as never).pipe(outgoing);
      else outgoing.end();
    })().catch((err: unknown) => {
      outgoing.writeHead(500).end();
      process.stderr.write(`agenticschema: ${String(err)}\n`);
    });
  }).listen(args.port, '127.0.0.1', () => {
    if (!args.quiet) {
      process.stderr.write(`agenticschema: listening on http://127.0.0.1:${args.port}\n`);
    }
  });
}
