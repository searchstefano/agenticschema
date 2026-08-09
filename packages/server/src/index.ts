import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
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
}

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
  const server = new McpServer({
    name: options.name ?? 'agenticschema',
    version: options.version ?? '0.0.0',
  });
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

/** happy-dom gives a real DOM, so microdata and RDFa work here. From a string they do not. */
export function parseDocument(html: string): Document {
  const window = new Window();
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
