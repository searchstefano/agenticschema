#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './index.js';

const USAGE = `
agenticschema — espone lo Schema.org di una pagina come server MCP

  npx @agenticschema/server <url> [<url>...] [opzioni]

Opzioni
  --max-tools <n>     tetto sui tool generati (default 24)
  --no-actions        non generare tool eseguibili da potentialAction
  --allow-host <host> host aggiuntivo ammesso per le azioni (ripetibile)
  --quiet             non stampare la diagnostica su stderr

Esempio di configurazione in claude_desktop_config.json:

  { "mcpServers": {
      "negozio": {
        "command": "npx",
        "args": ["-y", "@agenticschema/server", "https://esempio.test/prodotto"]
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
      throw new Error(`opzione sconosciuta: ${arg}`);
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
  // Sempre su stderr: stdout è il canale del protocollo.
  process.stderr.write(`agenticschema: ${tools.length} tool da ${args.urls.length} pagina/e\n`);
  for (const tool of tools) process.stderr.write(`  - ${tool.name}\n`);
  for (const d of diagnostics) {
    if (d.level !== 'info') process.stderr.write(`  [${d.level}] ${d.message}\n`);
  }
}

await server.connect(new StdioServerTransport());
