import type {
  Diagnostic,
  Entity,
  EntityGraph,
  JsonObject,
  JsonValue,
  PropertyValue,
  RawNode,
  SourceFormat,
} from '../types.js';

export interface NormalizeOptions {
  /** Base for resolving relative `@id` values, usually the page URL. */
  baseUrl?: string;
  /** Maximum nesting depth, the guard against circular references. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 12;

/** Contexts accepted as schema.org: http or https, with or without www, with or without a trailing slash. */
const SCHEMA_ORG_CONTEXT = /^https?:\/\/(www\.)?schema\.org\/?$/i;

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Turns raw blobs into an entity graph with a predictable shape: `@graph`
 * flattened, `@type` always an array, values always arrays, nested entities
 * hoisted to top-level nodes, and nodes sharing an `@id` merged.
 */
export function normalize(nodes: RawNode[], options: NormalizeOptions = {}): EntityGraph {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const diagnostics: Diagnostic[] = [];
  const graph = new Map<string, Entity>();
  const referenced = new Set<string>();
  const topLevel: string[] = [];

  let blankCounter = 0;
  const nextBlankId = () => `_:b${blankCounter++}`;

  const resolveId = (value: string): string => {
    if (!options.baseUrl) return value;
    try {
      return new URL(value, options.baseUrl).href;
    } catch {
      return value;
    }
  };

  /** Folds an entity into the graph. Nodes with the same @id merge rather than overwrite. */
  function upsert(entity: Entity): void {
    const existing = graph.get(entity.id);
    if (!existing) {
      graph.set(entity.id, entity);
      return;
    }
    existing.types = [...new Set([...existing.types, ...entity.types])];
    for (const [key, values] of Object.entries(entity.props)) {
      const current = existing.props[key];
      existing.props[key] = current ? dedupe([...current, ...values]) : values;
    }
  }

  function visit(data: JsonObject, format: SourceFormat, depth: number): PropertyValue | undefined {
    if (depth > maxDepth) {
      diagnostics.push({
        level: 'warn',
        code: 'depth-limit',
        message: `nesting deeper than ${maxDepth} levels: branch truncated (likely circular reference)`,
      });
      return undefined;
    }

    // `@value` collapses to a plain value. The language tag is of no use to a tool.
    if ('@value' in data) {
      const v = data['@value'];
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
    }

    const rawId = data['@id'];
    const id = typeof rawId === 'string' ? resolveId(rawId) : nextBlankId();

    // A bare reference: `{ "@id": "..." }` and nothing else.
    const keys = Object.keys(data).filter((k) => k !== '@context');
    if (keys.length === 1 && keys[0] === '@id') {
      referenced.add(id);
      return { ref: id };
    }

    const entity: Entity = { id, types: readTypes(data), props: {}, format };

    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('@')) continue;
      const values = (Array.isArray(value) ? value : [value])
        .map((item) => toPropertyValue(item, format, depth))
        .filter((v): v is PropertyValue => v !== undefined);
      if (values.length) entity.props[stripPrefix(key)] = values;
    }

    upsert(entity);
    return { ref: id };
  }

  function toPropertyValue(
    value: JsonValue,
    format: SourceFormat,
    depth: number
  ): PropertyValue | undefined {
    if (value === null) return undefined;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) return undefined; // the caller has already flattened nested arrays
    const result = visit(value, format, depth + 1);
    if (result && typeof result === 'object') referenced.add(result.ref);
    return result;
  }

  for (const node of nodes) {
    const context = node.data['@context'];
    if (typeof context === 'string' && !SCHEMA_ORG_CONTEXT.test(context)) {
      diagnostics.push({
        level: 'info',
        code: 'unknown-context',
        message: `@context not recognised as schema.org: ${context}`,
      });
    }

    // `@graph` gets flattened here rather than in extract: extract gathers, normalize interprets.
    const graphValue = node.data['@graph'];
    const items = Array.isArray(graphValue)
      ? graphValue.filter(isObject)
      : isObject(graphValue)
        ? [graphValue]
        : [node.data];

    for (const item of items) {
      const result = visit(item, node.format, 0);
      if (result && typeof result === 'object') topLevel.push(result.ref);
    }
  }

  const roots = topLevel.filter((id) => !referenced.has(id));

  return {
    nodes: graph,
    // When everything turns out to be referenced, which cyclic graphs do, fall
    // back to the top-level nodes, or the caller is left with no way in.
    roots: roots.length ? [...new Set(roots)] : [...new Set(topLevel)],
    diagnostics,
  };
}

function readTypes(data: JsonObject): string[] {
  const raw = data['@type'];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.filter((t): t is string => typeof t === 'string').map(stripPrefix);
}

/** `schema:Product` | `https://schema.org/Product` -> `Product` */
function stripPrefix(value: string): string {
  const slash = value.lastIndexOf('/');
  const hash = value.lastIndexOf('#');
  if (slash !== -1 || hash !== -1) return value.slice(Math.max(slash, hash) + 1);
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(colon + 1);
}

function dedupe(values: PropertyValue[]): PropertyValue[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = typeof v === 'object' ? `ref:${v.ref}` : `${typeof v}:${String(v)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
