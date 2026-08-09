#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './index.js';

const USAGE = `
agenticschema: serve a page's Schema.org markup as an MCP server

  npx @agenticschema/server <url> [<url>...] [options]

Options
  --max-tools <n>     cap on generated tools (default 24)
  --no-actions        do not build executable tools from potentialAction
  --allow-host <host> extra host allowed for actions (repeatable)
  --quiet             keep diagnostics off stderr

Example entry for claude_desktop_config.json:

  { "mcpServers": {
      "shop": {
        "command": "npx",
        "args": ["-y", "@agenticschema/server", "https://example.test/product"]
      } } }
`;

interface Args {
  urls: string[];
  maxTools?: number;
  actions: 'auto' | 'off';
  allowedHosts: string[];
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { urls: [], actions: 'auto', allowedHosts: [], quiet: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--max-tools') {
      args.maxTools = Number(argv[++i]);
    } else if (arg === '--no-actions') {
      args.actions = 'off';
    } else if (arg === '--allow-host') {
      args.allowedHosts.push(argv[++i] ?? '');
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

const { server, tools, diagnostics } = await createServer(args.urls, {
  actions: args.actions,
  allowedHosts: args.allowedHosts,
  ...(args.maxTools ? { maxTools: args.maxTools } : {}),
});

if (!args.quiet) {
  // Always stderr. stdout belongs to the protocol.
  const pages = args.urls.length === 1 ? '1 page' : `${args.urls.length} pages`;
  process.stderr.write(`agenticschema: ${tools.length} tools from ${pages}\n`);
  for (const tool of tools) process.stderr.write(`  - ${tool.name}\n`);
  for (const d of diagnostics) {
    if (d.level !== 'info') process.stderr.write(`  [${d.level}] ${d.message}\n`);
  }
}

await server.connect(new StdioServerTransport());
