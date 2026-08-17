#!/usr/bin/env node
/**
 * One corpus page, served over stdio as an MCP server.
 *
 *   node scripts/bench/page-server.mjs <html-file> <url>
 *
 * Spawned by the `claude` CLI, once per trial of the `tools` arm, from the
 * config `run.mjs` writes. Nothing calls it by hand.
 *
 * It is a wrapper and deliberately nothing more. The mapping, the tool names,
 * the descriptions, the JSON the tools return: all of it comes from
 * `createServer`, the code that ships. A server written for the benchmark would
 * measure the benchmark.
 *
 * Two things it does that the published CLI does not:
 *
 * The page arrives as HTML rather than as a url. `createServer` takes
 * `{ url, html }` already, and passing the bytes Common Crawl gave us is what
 * makes a rerun comparable — and what keeps a benchmark of 177 pages from
 * becoming 177 live requests every time it runs.
 *
 * Actions are off. `potentialAction` tools execute a real request against the
 * site when called, so an agent that decided to try the search box would reach
 * out to marmiton.org or ikea.com from inside a benchmark that exists to leave
 * them alone. Every question in the task set is answered by reading, so nothing
 * that matters to the measurement is being removed.
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const [file, url] = process.argv.slice(2);

// stderr, always: stdout is the protocol, and one stray line on it is a client
// that cannot parse the handshake.
const fail = (message) => {
  process.stderr.write(`page-server: ${message}\n`);
  process.exit(1);
};

if (!file || !url) fail('usage: page-server.mjs <html-file> <url>');

let createServer;
try {
  ({ createServer } = await import('@agenticschema/server'));
} catch (error) {
  fail(`cannot load @agenticschema/server (run "npm run build" first): ${error.message}`);
}

let html;
try {
  html = readFileSync(file, 'utf8');
} catch (error) {
  fail(`cannot read ${file}: ${error.message}`);
}

const { server, tools, diagnostics } = await createServer([{ url, html }], { actions: 'off' });

process.stderr.write(`page-server: ${tools.length} tools from ${url}\n`);
for (const diagnostic of diagnostics) {
  if (diagnostic.level === 'error') process.stderr.write(`  [error] ${diagnostic.message}\n`);
}

// The CLI closes stdin when a trial ends, and on a killed run it closes because
// the parent is gone. Either way this process has nobody to talk to and no
// reason to stay: a run is hundreds of trials, and a leaked server per trial is
// hundreds of idle node processes holding a page in memory each.
process.stdin.on('close', () => process.exit(0));

await server.connect(new StdioServerTransport());
