#!/usr/bin/env node
import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { contextPages, createHttpHandler, createServer, forageUrls, fuseUrls, scrapePages } from './index.js';

const USAGE = `
agenticschema: serve or scrape a page's Schema.org markup

  npx @agenticschema/server <url> [<url>...] [options]

Options
  --max-tools <n>     cap on generated tools (default 24)
  --no-actions        do not build executable tools from potentialAction
  --allow-host <host> extra host allowed for actions (repeatable)
  --fallback          synthesise entities & search actions from OpenGraph/meta/forms
  --json              scrape and print structured JSON to stdout instead of serving MCP
  --context           print 1-turn hybrid LLM context (structured facts + deduplicated prose)
  --forage            foveated multi-page exploration (L1 fovea on best pages + L0 peripheral pulses)
  --fuse              fuse multiple URLs into a Bayesian consensus or comparison matrix
  --resolution <lvl>  holographic resolution: L0 (~35 tok pulse), L1 (epistemic atoms), L2 (full)
  --query <q>         query-focused Submodular Information Bottleneck projection
  --budget <tokens>   target token budget for --context / --fuse / --forage
  --early-abort       stop downloading HTML after </head> once JSON-LD is found
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
const MAX_HTTP_BODY_BYTES = 1_048_576;

interface Args {
  urls: string[];
  maxTools?: number;
  actions: 'auto' | 'off';
  allowedHosts: string[];
  fallback: boolean;
  json: boolean;
  context: boolean;
  forage: boolean;
  fuse: boolean;
  resolution?: 'L0' | 'L1' | 'L2';
  query?: string;
  tokenBudget?: number;
  earlyAbort: boolean;
  quiet: boolean;
  http: boolean;
  port: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    urls: [],
    actions: 'auto',
    allowedHosts: [],
    fallback: false,
    json: false,
    context: false,
    forage: false,
    fuse: false,
    earlyAbort: false,
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
    } else if (arg === '--fallback') {
      args.fallback = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--context') {
      args.context = true;
    } else if (arg === '--forage') {
      args.forage = true;
    } else if (arg === '--fuse') {
      args.fuse = true;
    } else if (arg === '--resolution') {
      const r = (argv[++i] ?? '').toUpperCase();
      if (r === 'L0' || r === 'L1' || r === 'L2') args.resolution = r;
    } else if (arg === '--query') {
      args.query = argv[++i] ?? '';
    } else if (arg === '--budget') {
      args.tokenBudget = Number(argv[++i]);
    } else if (arg === '--early-abort') {
      args.earlyAbort = true;
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
  ...(args.fallback ? { fallback: true } : {}),
  ...(args.earlyAbort ? { earlyAbort: true } : {}),
  ...(args.resolution ? { resolution: args.resolution } : {}),
  ...(args.query ? { query: args.query } : {}),
  ...(args.tokenBudget !== undefined && Number.isFinite(args.tokenBudget)
    ? { tokenBudget: args.tokenBudget }
    : {}),
  ...(args.maxTools ? { maxTools: args.maxTools } : {}),
};

if (args.forage) {
  const wave = await forageUrls(args.urls, pipeline);
  process.stdout.write(`${args.json ? JSON.stringify(wave, null, 2) : wave.context}\n`);
  process.exit(0);
}

if (args.fuse) {
  const fused = await fuseUrls(args.urls, pipeline);
  process.stdout.write(`${args.json ? JSON.stringify(fused, null, 2) : fused.context}\n`);
  process.exit(0);
}

if (args.context) {
  const pages = await contextPages(args.urls, pipeline);
  process.stdout.write(`${pages.map((p) => p.context).join('\n\n---\n\n')}\n`);
  process.exit(0);
}

if (args.json) {
  const scraped = await scrapePages(args.urls, pipeline);
  const output = scraped.length === 1 ? scraped[0] : scraped;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

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
      let totalBytes = 0;
      for await (const chunk of incoming) {
        const buf = chunk as Buffer;
        totalBytes += buf.byteLength;
        if (totalBytes > MAX_HTTP_BODY_BYTES) {
          outgoing.writeHead(413).end('Payload Too Large');
          incoming.destroy();
          return;
        }
        chunks.push(buf);
      }

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
