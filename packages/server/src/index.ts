import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { parseHTML } from 'linkedom';
import {
  foragePages,
  fusePages,
  materialize,
  needsDocument,
  scrape,
  toContext,
  toTools,
  toSlug,
  type ContextOptions,
  type ContextResult,
  type Diagnostic,
  type ForagedWavefrontResult,
  type FusedContextResult,
  type PipelineOptions,
  type ScrapeResult,
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
  /**
   * Abort the HTTP stream as soon as `</head>` closes if at least one JSON-LD
   * block has already been received inside `<head>`. Saves up to 90% of
   * network bandwidth on large pages when only structured facts are needed.
   */
  earlyAbort?: boolean;
  /** Maximum HTML response size in bytes before aborting. Defaults to 5 MB. */
  maxHtmlBytes?: number;
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

  const pages = await Promise.all(
    sources.map(async (s) => {
      const page = typeof s === 'string' ? { url: s } : s;
      return {
        url: page.url,
        html: page.html ?? (await fetchHtml(page.url, options)),
      };
    })
  );
  const multi = pages.length > 1;

  const allTools: ToolDescriptor[] = [];
  const diagnostics: Diagnostic[] = [];
  const usedNames = new Set<string>();

  for (const [index, page] of pages.entries()) {
    const html = page.html;

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
        html: page.html ?? (await fetchHtml(page.url, options)),
      };
    })
  );
  return createMcpHandler(async () => (await createServer(pages, options)).server);
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_HTML_BYTES = 5_242_880; // 5 MB

export interface ScrapedPage extends Omit<ScrapeResult, 'tools' | 'graph'> {
  url: string;
  tools: Array<{
    name: string;
    description: string;
    kind: 'read' | 'action' | 'custom';
    entityType?: string;
  }>;
}

export interface ContextPage extends ContextResult {
  url: string;
}

/**
 * Scrapes one or more pages concurrently with full DOM support (JSON-LD,
 * Microdata, RDFa, OpenGraph, Twitter Card, HTML `<meta>` and `<form>` fallback)
 * and Schema.org profiles pre-wired.
 */
export async function scrapePages(
  sources: readonly (PageSource | string)[],
  options: CreateServerOptions = {}
): Promise<ScrapedPage[]> {
  return Promise.all(
    sources.map(async (s) => {
      const page = typeof s === 'string' ? { url: s } : s;
      const html = page.html ?? (await fetchHtml(page.url, options));
      const source = needsDocument(html, options) ? parseDocument(html) : html;
      const result = scrape(source, {
        ...schemaOrgProfiles,
        ...options,
        baseUrl: page.url,
      });
      return {
        url: page.url,
        ...(result.primary ? { primary: result.primary } : {}),
        entities: result.entities,
        meta: result.meta,
        actions: result.actions,
        tools: result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          kind: t.source.kind,
          ...(t.source.entityType ? { entityType: t.source.entityType } : {}),
        })),
        diagnostics: result.diagnostics,
      };
    })
  );
}

/**
 * Generates Zero-Turn Hybrid Contexts (`toContext`) for one or more pages
 * concurrently — combining normalized Schema.org/OpenGraph facts, `<dl>`/`<table>`
 * specs, SSR hydration state, anti-cloaking/byline verification, and deduplicated
 * body prose in a single pass.
 */
export async function contextPages(
  sources: readonly (PageSource | string)[],
  options: CreateServerOptions & ContextOptions = {}
): Promise<ContextPage[]> {
  return Promise.all(
    sources.map(async (s) => {
      const page = typeof s === 'string' ? { url: s } : s;
      const html = page.html ?? (await fetchHtml(page.url, options));
      const source = needsDocument(html, options) ? parseDocument(html) : html;
      const result = toContext(source, {
        ...schemaOrgProfiles,
        ...options,
        baseUrl: page.url,
      });
      return {
        url: page.url,
        ...result,
      };
    })
  );
}

/**
 * Fetches multiple pages concurrently and fuses them into a single multi-page
 * knowledge graph (`fusePages`) — performing Bayesian Truth Discovery when
 * pages describe the same entity, or synthesizing a Markdown Comparison Matrix
 * when pages describe distinct entities, plus cross-page SimHash prose deduplication.
 */
export async function fuseUrls(
  sources: readonly (PageSource | string)[],
  options: CreateServerOptions & ContextOptions & { mode?: 'auto' | 'consensus' | 'comparison' } = {}
): Promise<FusedContextResult> {
  const pages = await contextPages(sources, options);
  return fusePages(pages, options);
}

/**
 * Foveated Multi-Page Wavefront Exploration (`foragePages`) across multiple URLs:
 * fetches all URLs concurrently, scores each page's Epistemic Resonance with
 * `options.query`, focuses foveal depth (`L1`) on the top winning pages, and
 * keeps peripheral pages as ~35-token `L0` Holographic Pulses while surfacing
 * discovered Shadow APIs (`machineTwins`) and high-scent next hops (`frontier`).
 */
export async function forageUrls(
  sources: readonly (PageSource | string)[],
  options: CreateServerOptions & ContextOptions & { foveaCount?: number } = {}
): Promise<ForagedWavefrontResult> {
  const pages = await contextPages(sources, { ...options, resolution: 'L1' });
  return foragePages(pages, options);
}

const PRIVATE_HOST_RE =
  /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1\]|\[fe80:|\[fc00:|\[fd00:|\.local$|\.internal$)/i;

function assertPublicUrl(rawUrl: string, allowedHosts: readonly string[] = []): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${rawUrl}: invalid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${rawUrl}: scheme ${parsed.protocol} is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${rawUrl}: credentials in URL are not allowed`);
  }
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host) && !allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new Error(`${rawUrl}: private/loopback host ${host} is blocked for SSRF protection`);
  }
  return parsed.href;
}

/**
 * Creates a dynamic Live Search MCP Server (`npx @agenticschema/server --live`)
 * that replaces an LLM's built-in raw `WebFetch` with three epistemic tools:
 * - `fetch_evidence`: Extracts the Canonical Evidence Graph (`[✓S1]`, `[#S3]`, `[§S4]`),
 *   Epistemic Sufficiency Verdict, Relativistic Temporal Frame, and Shadow APIs from any URL.
 * - `forage_urls`: Performs Adaptive Foveated Escalation (`L0 -> L1 -> L2`) across up to 10 URLs.
 * - `fuse_sources`: Runs Independence-Weighted Multi-Source Fusion & Contradiction Detection.
 */
export function createLiveSearchServer(options: CreateServerOptions = {}): CreatedServer {
  const server = new McpServer({
    name: options.name ?? 'agenticschema-live-search',
    version: options.version ?? '0.4.0',
  });
  const validator = new AjvJsonSchemaValidator();
  const allowedHosts = options.allowedHosts ?? [];

  server.registerTool(
    'fetch_evidence',
    {
      description:
        'Fetch any public URL and extract its AI-native Epistemic Context (Structured Schema + Specs + Surprisal Atoms + Provenance Sigils [✓S1]/[~S2]/[#S3]/[§S4] + Temporal Frame + Epistemic Sufficiency Verdict). Use this INSTEAD of raw WebFetch/curl to save 6x–32x tokens and verify claims.',
      inputSchema: fromJsonSchema<Record<string, unknown>>(
        {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Public http/https URL to inspect.' },
            query: {
              type: 'string',
              description: 'Question or search intent to project via Multi-Facet Submodular Bottleneck.',
            },
            resolution: {
              type: 'string',
              enum: ['L0', 'L1', 'L2'],
              description: 'L0 (~99 tok pulse), L1 (~413 tok epistemic core, default), or L2 (full hybrid with prose).',
            },
            tokenBudget: {
              type: 'number',
              description: 'Optional hard BPE token ceiling (e.g. 120 or 250).',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
        validator
      ),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const safeUrl = assertPublicUrl(String(args?.['url'] ?? ''), allowedHosts);
        const query = typeof args?.['query'] === 'string' ? args['query'] : undefined;
        const resRaw = typeof args?.['resolution'] === 'string' ? args['resolution'].toUpperCase() : 'L1';
        const resolution: 'L0' | 'L1' | 'L2' =
          resRaw === 'L0' || resRaw === 'L1' || resRaw === 'L2' ? resRaw : 'L1';
        const tokenBudget =
          typeof args?.['tokenBudget'] === 'number' && Number.isFinite(args['tokenBudget'])
            ? args['tokenBudget']
            : undefined;

        const [page] = await contextPages([safeUrl], {
          ...options,
          resolution,
          ...(query ? { query } : {}),
          ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        });
        return {
          content: [{ type: 'text' as const, text: page?.context ?? 'No content extracted.' }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    'forage_urls',
    {
      description:
        'Explore multiple search result URLs simultaneously via Adaptive Foveated Escalation (L0 -> L1 -> L2): scans all URLs at L0 peripheral resolution, focuses L1 Evidence on the highest-resonance pages, and automatically escalates to L2 Deep Inspection if any query facet remains unresolved.',
      inputSchema: fromJsonSchema<Record<string, unknown>>(
        {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of 2 to 10 public URLs to explore concurrently.',
            },
            query: {
              type: 'string',
              description: 'Multi-aspect question or research goal.',
            },
            foveaCount: {
              type: 'number',
              description: 'Number of top pages to inspect in the fovea (default 2).',
            },
          },
          required: ['urls', 'query'],
          additionalProperties: false,
        },
        validator
      ),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const rawUrls = Array.isArray(args?.['urls']) ? args['urls'].slice(0, 10) : [];
        const safeUrls = rawUrls.map((u) => assertPublicUrl(String(u), allowedHosts));
        const query = typeof args?.['query'] === 'string' ? args['query'] : undefined;
        const foveaCount =
          typeof args?.['foveaCount'] === 'number' && Number.isFinite(args['foveaCount'])
            ? args['foveaCount']
            : undefined;

        const htmlPages = await Promise.all(
          safeUrls.map(async (url) => ({
            url,
            html: await fetchHtml(url, options),
          }))
        );
        const wave = foragePages(
          htmlPages.map((p) => p.html),
          {
            ...schemaOrgProfiles,
            ...options,
            ...(query ? { query } : {}),
            ...(foveaCount !== undefined ? { foveaCount } : {}),
          }
        );
        return {
          content: [{ type: 'text' as const, text: wave.context }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    'fuse_sources',
    {
      description:
        'Cross-verify facts or compare products across multiple URLs using Independence-Weighted Truth Discovery (discounting syndicated copies via SimHash, weighting by DOM corroboration and freshness, and preserving unresolved conflicts or building a Markdown Comparison Matrix).',
      inputSchema: fromJsonSchema<Record<string, unknown>>(
        {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of 2 to 10 public URLs to fuse.',
            },
            query: {
              type: 'string',
              description: 'Optional query to focus the comparison or consensus.',
            },
            mode: {
              type: 'string',
              enum: ['auto', 'consensus', 'comparison'],
              description: 'Fusion mode (default auto).',
            },
          },
          required: ['urls'],
          additionalProperties: false,
        },
        validator
      ),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const rawUrls = Array.isArray(args?.['urls']) ? args['urls'].slice(0, 10) : [];
        const safeUrls = rawUrls.map((u) => assertPublicUrl(String(u), allowedHosts));
        const query = typeof args?.['query'] === 'string' ? args['query'] : undefined;
        const modeRaw = typeof args?.['mode'] === 'string' ? args['mode'] : 'auto';
        const mode: 'auto' | 'consensus' | 'comparison' =
          modeRaw === 'consensus' || modeRaw === 'comparison' ? modeRaw : 'auto';

        const fused = await fuseUrls(safeUrls, {
          ...options,
          mode,
          ...(query ? { query } : {}),
        });
        return {
          content: [{ type: 'text' as const, text: fused.context }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    }
  );

  return {
    server,
    tools: [],
    diagnostics: [],
  };
}

const AI_BOT_UA =
  /\b(ClaudeBot|Claude-Web|Anthropic-AI|OAI-SearchBot|ChatGPT-User|GPTBot|PerplexityBot|Google-Extended|CCBot|Applebot-Extended)\b/i;

/**
 * Returns true if the incoming HTTP `Request` is from a known AI search/scraping
 * bot or explicitly negotiates `text/markdown`, `application/schema+json`, or
 * `application/mcp+json`.
 */
export function isAiBotRequest(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  if (
    accept.includes('text/markdown') ||
    accept.includes('application/schema+json') ||
    accept.includes('application/mcp+json')
  ) {
    return true;
  }
  const ua = request.headers.get('user-agent') ?? '';
  return AI_BOT_UA.test(ua);
}

export interface AgentMiddlewareOptions extends ContextOptions {
  /** Optional MCP endpoint URL advertised in the `Link` response header. Defaults to `'/mcp'`. */
  mcpEndpoint?: string;
}

/**
 * Edge & server middleware for Cloudflare Workers, Next.js, Remix, Hono, or Node:
 * intercepts HTML responses destined for AI search bots (`ClaudeBot`, `OAI-SearchBot`,
 * `PerplexityBot`) or `Accept: text/markdown` / `application/schema+json` clients
 * and transforms them on the fly into a compact 1-turn `toContext()` payload.
 */
export function createAgentMiddleware(options: AgentMiddlewareOptions = {}) {
  const mcpEndpoint = options.mcpEndpoint ?? '/mcp';
  return async (
    request: Request,
    next: () => Promise<Response> | Response
  ): Promise<Response> => {
    const response = await next();
    if (!isAiBotRequest(request)) return response;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) return response;

    const html = await response.text();
    const accept = request.headers.get('accept') ?? '';
    const wantsJson =
      accept.includes('application/schema+json') || accept.includes('application/mcp+json');

    const source = needsDocument(html, options) ? parseDocument(html) : html;
    const reqQuery = request.headers.get('x-search-query') ?? options.query;
    const reqBudgetRaw = request.headers.get('x-token-budget');
    const reqBudget =
      reqBudgetRaw && Number.isFinite(Number(reqBudgetRaw))
        ? Number(reqBudgetRaw)
        : options.tokenBudget;
    const reqResRaw = request.headers.get('x-resolution')?.toUpperCase();
    const reqResolution =
      reqResRaw === 'L0' || reqResRaw === 'L1' || reqResRaw === 'L2'
        ? reqResRaw
        : options.resolution;

    const ctx = toContext(source, {
      ...schemaOrgProfiles,
      ...options,
      ...(reqQuery ? { query: reqQuery } : {}),
      ...(reqBudget !== undefined ? { tokenBudget: reqBudget } : {}),
      ...(reqResolution ? { resolution: reqResolution } : {}),
      baseUrl: request.url,
      format: wantsJson ? 'json' : 'markdown',
    });

    const headers = new Headers(response.headers);
    headers.set(
      'content-type',
      wantsJson ? 'application/schema+json; charset=utf-8' : 'text/markdown; charset=utf-8'
    );
    headers.set('vary', 'Accept, User-Agent, X-Search-Query, X-Token-Budget, X-Resolution');
    headers.set('link', `<${mcpEndpoint}>; rel="mcp-server"`);
    headers.set('x-markdown-tokens', String(ctx.estimatedTokens));
    headers.set('x-semantic-fingerprint', ctx.fingerprint);
    headers.set('x-holographic-pulse', ctx.pulse.slice(0, 240));
    headers.delete('content-length');
    headers.delete('content-encoding');

    return new Response(ctx.context, {
      status: response.status,
      headers,
    });
  };
}

async function fetchHtml(url: string, options: CreateServerOptions = {}): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${url}: invalid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${url}: scheme ${parsed.protocol} is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${url}: credentials in URL are not allowed`);
  }

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);

  // A page that never answers would otherwise block startup, and over stdio the
  // agent just hangs with nothing to show for it.
  const response = await doFetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'agenticschema' },
    signal,
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  if (!response.body || (!options.earlyAbort && options.maxHtmlBytes === undefined)) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        break;
      }
      html += decoder.decode(value, { stream: true });
      if (
        options.earlyAbort &&
        /<\/head\s*>/i.test(html) &&
        /<script\b[^>]*ld\+json[^>]*>[\s\S]*?<\/script\s*>/i.test(html)
      ) {
        controller.abort();
        await reader.cancel().catch(() => {});
        break;
      }
    }
    html += decoder.decode();
  } catch (err) {
    if (!html) throw err;
  }
  return html;
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
