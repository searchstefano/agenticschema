import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { Window } from 'happy-dom';
import {
  materialize,
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
    const document = parseDocument(html);

    const result = toTools(document, {
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
 * happy-dom gives a real DOM, so microdata and RDFa work here. From a string they do not.
 *
 * Every route out of the DOM is closed. happy-dom loads external resources by
 * default, and the urls it loads come from the page: a `<link>` or an `<iframe>`
 * is enough to make this process issue a request, to wherever the markup says.
 * On a server that is a request from inside the operator's network, link-local
 * metadata addresses included, and it walks past every check the rest of this
 * library applies before touching a destination.
 *
 * The timer bounds are here for the same reason. Script evaluation is off, so
 * nothing should be scheduling anything, but a default is not a guarantee and an
 * unbounded interval in a long-lived server never stops.
 */
export function parseDocument(html: string): Document {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      enableImageFileLoading: false,
      // Otherwise every blocked resource is reported as a load error, and a page
      // with two hundred of them buries anything worth reading.
      handleDisabledFileLoadingAsSuccess: true,
      timer: {
        maxTimeout: 1_000,
        maxIntervalTime: 1_000,
        maxIntervalIterations: 10,
        preventTimerLoops: true,
      },
    },
  });
  window.document.write(html);
  return window.document as unknown as Document;
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base.slice(0, 64);
  let n = 2;
  while (used.has(name)) name = `${base.slice(0, 60)}_${n++}`;
  used.add(name);
  return name;
}
