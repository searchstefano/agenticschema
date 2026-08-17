import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { parseHTML } from 'linkedom';
import {
  materialize,
  needsDocument,
  toTools,
  toSlug,
  type Diagnostic,
  type PipelineOptions,
  type ToolDescriptor,
} from '@agenticschema/core';
import { schemaOrgProfiles } from '@agenticschema/profiles';

export interface PageSource {
  url: string;
  /** HTML you already have. Fetched if absent. */
  html?: string;
}

export interface CreateServerOptions extends PipelineOptions {
  name?: string;
  version?: string;
  fetchImpl?: typeof globalThis.fetch;
  /**
   * How long a client may reuse a cacheable result, in ms. Pages are fetched
   * and mapped once at startup and never refetched, so every answer is
   * identical for the life of the process, and the SDK's `ttlMs: 0` default
   * makes clients refetch a list that cannot have changed. `0` restores it.
   */
  cacheTtlMs?: number;
}

/** Long enough to stop the per-call refetch, short enough that a restarted server is picked up soon. */
const DEFAULT_CACHE_TTL_MS = 300_000;

export interface CreatedServer {
  server: McpServer;
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
}

/**
 * Builds an MCP server from the given pages.
 *
 * MCP resources are available on this path, unlike in the browser, so entities
 * are exposed both as tools and as readable resources. That is a real advantage
 * of running server-side and it would be a shame to waste it.
 */
export async function createServer(
  sources: readonly (PageSource | string)[],
  options: CreateServerOptions = {}
): Promise<CreatedServer> {
  // The listings describe a mapping that is fixed once the pages are read, so
  // they may be shared: the guard keeps page text out of tool descriptions,
  // which leaves nothing in them that belongs to whoever asked. Resource reads
  // are the page's own content and stay private — a caller can hand us `html`
  // from somewhere we know nothing about, and authorising a shared cache over
  // that is not ours to do.
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const shared = { ttlMs, cacheScope: 'public' } as const;
  const server = new McpServer(
    {
      name: options.name ?? 'agenticschema',
      version: options.version ?? '0.0.0',
    },
    // Second argument. The first is the server's identity and it is echoed to
    // every client in `_meta`, so anything put there ships on the wire.
    {
      cacheHints: {
        'tools/list': shared,
        'resources/list': shared,
        'resources/templates/list': shared,
        'server/discover': shared,
        'resources/read': { ttlMs, cacheScope: 'private' },
      },
    }
  );
  const validator = new AjvJsonSchemaValidator();

  const pages = sources.map((s) => (typeof s === 'string' ? { url: s } : s));
  const multi = pages.length > 1;

  const allTools: ToolDescriptor[] = [];
  const diagnostics: Diagnostic[] = [];
  const usedNames = new Set<string>();

  for (const [index, page] of pages.entries()) {
    const html = page.html ?? (await fetchHtml(page.url, options.fetchImpl, options.timeoutMs));

    // A DOM only earns its cost when the page carries microdata or RDFa, and
    // most pages do not. Parsing is 93% of the time from HTML to tools, so on a
    // JSON-LD-only page — around seven in ten — skipping it is the difference
    // between ~38 ms and well under one. `needsDocument` errs towards building
    // one, so what this drops is work that would have found nothing.
    const source = needsDocument(html, options) ? parseDocument(html) : html;

    const result = toTools(source, {
      ...schemaOrgProfiles,
      ...options,
      baseUrl: page.url,
    });
    diagnostics.push(...result.diagnostics);

    // With several pages the names need separating, or two products collide.
    const prefix = multi ? `${toSlug(new URL(page.url).hostname)}_` : '';

    for (const tool of result.tools) {
      const name = uniqueName(`${prefix}${tool.name}`, usedNames);
      allTools.push({ ...tool, name });

      server.registerTool(
        name,
        {
          description: tool.description,
          // Raw JSON Schema, no conversion to Zod: the v2 SDK takes it as is.
          // The type parameter has to be spelled out. Without it the schema is
          // `unknown` and TypeScript falls back to the legacy Zod overload.
          inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema, validator),
          annotations: tool.annotations,
        },
        async (args) => (await tool.execute(args ?? {})) as never
      );
    }

    for (const [entityIndex, entity] of [...result.graph.nodes.values()].entries()) {
      if (entity.types.length === 0) continue;
      const uri = `agenticschema://page-${index}/entity-${entityIndex}`;

      server.registerResource(
        `${entity.types[0]}-${index}-${entityIndex}`,
        uri,
        {
          title: entity.types[0] ?? 'Thing',
          description: `${entity.types.join(', ')} extracted from ${page.url}`,
          mimeType: 'application/json',
        },
        async () => ({
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(materialize(result.graph, entity), null, 2),
            },
          ],
        })
      );
    }
  }

  return { server, tools: allTools, diagnostics };
}

/**
 * The same mapping behind a fetch-shaped MCP endpoint, for a Worker or any
 * HTTP runtime. `createServer` covers the stdio path that `npx` gives you;
 * this covers everything that speaks `Request`/`Response`.
 *
 * The 2026-07-28 revision is stateless, so the SDK builds a fresh server per
 * request. The pages behind it are read once, here: refetching them per
 * request would turn every `tools/list` into a live hit on someone else's
 * origin, which is neither ours to spend nor theirs to absorb.
 *
 * This performs no authentication and no host or origin checking. Both are the
 * caller's, and the SDK ships `hostHeaderValidationResponse` and
 * `originValidationResponse` for exactly that.
 */
export async function createHttpHandler(
  sources: readonly (PageSource | string)[],
  options: CreateServerOptions = {}
): Promise<McpHttpHandler> {
  const pages = await Promise.all(
    sources.map(async (source) => {
      const page = typeof source === 'string' ? { url: source } : source;
      return {
        url: page.url,
        html: page.html ?? (await fetchHtml(page.url, options.fetchImpl, options.timeoutMs)),
      };
    })
  );
  return createMcpHandler(async () => (await createServer(pages, options)).server);
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchHtml(
  url: string,
  fetchImpl?: typeof globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  // A page that never answers would otherwise block startup, and over stdio the
  // agent just hangs with nothing to show for it.
  const response = await doFetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'agenticschema' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/**
 * A real DOM, so microdata and RDFa work here. From a string they do not.
 *
 * linkedom rather than happy-dom, for two reasons that point the same way.
 *
 * It is about four times faster on the pages that need a parser at all, and
 * parsing is where nearly all the time from a page to tools goes, so that is
 * most of the end-to-end difference. Extraction was compared node by node
 * across the corpus before the swap, and the two agreed on every page.
 *
 * The second reason matters more. happy-dom emulates a browser, which means it
 * can load what a page points at — a `<link>` or an `<iframe>` was enough to
 * make this process issue a request to wherever the markup said, from inside
 * the operator's network, past every destination check the rest of this library
 * applies. That was closed by turning six settings off and bounding the timers,
 * which works but has to be remembered: it is one careless option away from
 * coming back. linkedom is a parser and nothing more — htmlparser2, css-select
 * and cssom underneath it, no HTTP client anywhere in the tree, no script
 * evaluation, no timers to bound. The defence stops being a configuration and
 * becomes the absence of the capability.
 *
 * The tradeoff, stated: htmlparser2 is not a spec-compliant HTML5 tree builder,
 * so on badly broken markup it can differ from what a browser would build. The
 * corpus suite is what guards that, and `test:corpus` is the gate for any
 * change here.
 */
export function parseDocument(html: string): Document {
  const { document } = parseHTML(html);
  if (document.documentElement) return document as unknown as Document;

  // Input carrying no element at all — an empty response, a plain-text error
  // page, a bare doctype — leaves linkedom with a document that has no root,
  // and `head` and `body` then throw instead of being absent. A browser builds
  // the shell in that case, and so does this: what arrives here is whatever an
  // arbitrary url returned, and a parser is no place to be surprised by it.
  const shell = parseHTML('<html><head></head><body></body></html>').document;
  const text = [...document.childNodes]
    .filter((node) => node.nodeType === TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('');
  if (text) shell.body.textContent = text;
  return shell as unknown as Document;
}

const TEXT_NODE = 3;

function uniqueName(base: string, used: Set<string>): string {
  let name = base.slice(0, 64);
  let n = 2;
  while (used.has(name)) name = `${base.slice(0, 60)}_${n++}`;
  used.add(name);
  return name;
}
