import { extract, type ExtractOptions } from './extract/index.js';
import { normalize, type NormalizeOptions } from './normalize/index.js';
import { mapToTools, type MapOptions } from './map/index.js';
import { mapActions, type ActionOptions } from './map/actions.js';
import { guardTools, type GuardOptions } from './guard/index.js';
import type { Diagnostic, EntityGraph, JsonSchemaObject, ToolDescriptor, ToolResult } from './types.js';

export interface PipelineOptions
  extends ExtractOptions,
    NormalizeOptions,
    MapOptions,
    ActionOptions,
    GuardOptions {
  /**
   * Tools declared by the site owner. This is the way in for everything
   * auto-derivation cannot give you: actions with side effects, private
   * endpoints, anything `potentialAction` does not describe.
   * On a name clash these win over the generated ones.
   */
  custom?: readonly CustomTool[];
  /** `off` disables action generation entirely. */
  actions?: 'auto' | 'off';
}

export interface CustomTool {
  name: string;
  description: string;
  inputSchema?: JsonSchemaObject;
  execute: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
  /** Defaults to `readOnlyHint: false`, since someone declaring a tool by hand usually means it to do something. */
  annotations?: Partial<ToolDescriptor['annotations']>;
}

export interface PipelineResult {
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
  graph: EntityGraph;
}

/**
 * From a page to tool descriptors, with the safety checks applied.
 * Both adapters call this. The only difference between browser and server is
 * what you hand in as `source` and how the tools get registered afterwards.
 */
export function toTools(source: Document | string, options: PipelineOptions = {}): PipelineResult {
  const extracted = extract(source, options);
  const graph = normalize(extracted.nodes, options);

  // With no explicit pageOrigin, try to derive it from baseUrl. Without either,
  // no action tools are generated at all, because there is no way to vet the destination.
  const pageOrigin = options.pageOrigin ?? originOf(options.baseUrl);

  const read = mapToTools(graph, options);
  const actions =
    options.actions === 'off'
      ? { tools: [], diagnostics: [] }
      : mapActions(graph, { ...options, ...(pageOrigin ? { pageOrigin } : {}) });

  const custom = (options.custom ?? []).map(defineTool);
  const customNames = new Set(custom.map((t) => t.name));

  const generated = [...read.tools, ...actions.tools].filter((tool) => !customNames.has(tool.name));
  const guarded = guardTools([...custom, ...generated], options);

  return {
    tools: guarded.tools,
    diagnostics: [
      ...extracted.diagnostics,
      ...graph.diagnostics,
      ...read.diagnostics,
      ...actions.diagnostics,
      ...guarded.diagnostics,
    ],
    graph,
  };
}

/** Puts a hand-declared tool into the shape the rest of the pipeline expects. */
export function defineTool(tool: CustomTool): ToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint ?? false,
      openWorldHint: tool.annotations?.openWorldHint ?? true,
    },
    execute: tool.execute,
    source: { kind: 'custom' },
  };
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
