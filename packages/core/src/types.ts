/** Contratti condivisi dalla pipeline. Nessun riferimento a MCP o al browser: il core resta neutro. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Diagnostica
// ---------------------------------------------------------------------------

export type DiagnosticCode =
  | 'json-parse-error'
  | 'unknown-context'
  | 'depth-limit'
  | 'no-structured-data'
  | 'action-skipped'
  | 'tool-limit'
  | 'field-truncated';

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  code: DiagnosticCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Estrazione
// ---------------------------------------------------------------------------

export type SourceFormat = 'jsonld' | 'microdata' | 'rdfa';

export interface RawNode {
  data: JsonObject;
  format: SourceFormat;
}

export interface ExtractResult {
  nodes: RawNode[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Grafo normalizzato
// ---------------------------------------------------------------------------

/** Riferimento a un'altra entità del grafo. Le entità annidate vengono issate in `nodes` e sostituite da questo. */
export interface EntityRef {
  ref: string;
}

export type PropertyValue = string | number | boolean | EntityRef;

export interface Entity {
  /** Sempre valorizzato: `@id` risolto, oppure un blank node generato (`_:b0`). */
  id: string;
  /** Sempre un array, senza prefissi di vocabolario. Può essere vuoto per nodi senza `@type`. */
  types: string[];
  /** Sempre array di valori, anche per una proprietà singola: elimina il ramo singolo/array a valle. */
  props: Record<string, PropertyValue[]>;
  format: SourceFormat;
}

export interface EntityGraph {
  nodes: Map<string, Entity>;
  /** Entità non referenziate da nessun'altra: le radici del documento. */
  roots: string[];
  diagnostics: Diagnostic[];
}

export const isRef = (v: PropertyValue): v is EntityRef =>
  typeof v === 'object' && v !== null && 'ref' in v;

// ---------------------------------------------------------------------------
// Descrittori di tool (output del core)
// ---------------------------------------------------------------------------

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonObject>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  /**
   * Segnali che i client MCP usano per decidere cosa invocare senza conferma umana.
   * I tool di lettura generati dal core sono sempre `readOnlyHint: true`.
   */
  annotations: {
    readOnlyHint: boolean;
    openWorldHint: boolean;
  };
  execute: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
  source: {
    kind: 'read' | 'action' | 'custom';
    entityId?: string;
    entityType?: string;
  };
}
