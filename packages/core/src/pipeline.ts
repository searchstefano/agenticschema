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
   * Tool dichiarati dal proprietario del sito. Sono la via per tutto ciò che
   * l'auto-derivazione non può dare: azioni con effetti, endpoint privati,
   * qualunque cosa non sia descritta da `potentialAction`.
   * In caso di collisione di nome vincono sui generati.
   */
  custom?: readonly CustomTool[];
  /** `off` disattiva del tutto la generazione di azioni. */
  actions?: 'auto' | 'off';
}

export interface CustomTool {
  name: string;
  description: string;
  inputSchema?: JsonSchemaObject;
  execute: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
  /** Default `readOnlyHint: false`: chi dichiara un tool a mano di solito fa qualcosa. */
  annotations?: Partial<ToolDescriptor['annotations']>;
}

export interface PipelineResult {
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
  graph: EntityGraph;
}

/**
 * Da una pagina ai descrittori di tool, con i controlli di sicurezza applicati.
 * È la funzione che usano entrambi gli adapter: la differenza fra browser e
 * server sta solo in cosa si passa come `source` e in come si registrano i tool.
 */
export function toTools(source: Document | string, options: PipelineOptions = {}): PipelineResult {
  const extracted = extract(source, options);
  const graph = normalize(extracted.nodes, options);

  // Senza pageOrigin esplicito si prova a dedurlo da baseUrl: senza uno dei due
  // le azioni non vengono generate affatto (nessun modo di validare la destinazione).
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

/** Normalizza un tool dichiarato a mano nella forma interna. */
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
