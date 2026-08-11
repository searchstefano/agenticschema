import { isRef, type Entity, type EntityGraph, type JsonObject, type JsonValue } from '../types.js';

/** One read tool to generate for an entity. */
export interface ReadSpec {
  /** Name suffix: slug "product" plus name "offer" gives `get_product_offer`. Leave out for plain `get_product`. */
  name?: string;
  description: string;
  /** Follow this reference property first (`offers`, say) and read what it points at. */
  from?: string;
  /** Properties to include. Everything available if omitted. */
  pick?: string[];
  /** When `from` holds several values, return them all rather than just the first. */
  list?: boolean;
}

/**
 * Declares WHAT to generate for a type. The mechanics (naming, materialising,
 * caps, annotations) are shared and live in the mapper.
 */
export interface Profile {
  /** Schema.org types covered, variants included: `['Article','NewsArticle','BlogPosting']`. */
  types: string[];
  /** Base tool name, snake_case. */
  slug: string;
  read: ReadSpec[];
}

/**
 * Used when no profile covers the type, not even after walking up the hierarchy.
 * Guarantees that every entity still yields something usable.
 */
export function genericProfile(entity: Entity): Profile {
  const type = entity.types[0] ?? 'thing';
  return {
    types: entity.types,
    slug: toSlug(type),
    read: [{ description: `Structured data of type ${type} found on this page.` }],
  };
}

/**
 * Drops leading and trailing underscores. The obvious `/^_+|_+$/g` is quadratic:
 * `_+$` restarts inside every underscore run, so a long one costs the mapper
 * seconds. Scanning the two ends is the same result in linear time.
 */
function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '_') start += 1;
  while (end > start && value[end - 1] === '_') end -= 1;
  return value.slice(start, end);
}

export const toSlug = (value: string): string =>
  trimUnderscores(
    value
      // Acronym boundary before the ordinary one, or `FAQPage` comes out as `faqpage`.
      // One character plus a lookahead, never `[A-Z]+`: a repeated group here
      // backtracks quadratically over a run of capitals, and `@type` comes from
      // the page, so the run is the attacker's to choose.
      .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
  );

/**
 * Renders an entity as plain JSON, resolving references down to `depth`.
 * `seen` is what breaks cycles: without it, a graph with mutual references would
 * never finish, and `isRelatedTo` produces them constantly.
 */
export function materialize(
  graph: EntityGraph,
  entity: Entity,
  options: { pick?: string[]; depth?: number } = {}
): JsonObject {
  const depth = options.depth ?? 2;
  return render(graph, entity, options.pick, depth, new Set());
}

function render(
  graph: EntityGraph,
  entity: Entity,
  pick: string[] | undefined,
  depth: number,
  seen: Set<string>
): JsonObject {
  const out: JsonObject = {};
  if (entity.types.length) out['type'] = entity.types.length === 1 ? entity.types[0]! : entity.types;
  seen.add(entity.id);

  for (const [key, values] of Object.entries(entity.props)) {
    if (pick && !pick.includes(key)) continue;

    const rendered = values
      .map((value): JsonValue | undefined => {
        if (!isRef(value)) return value;
        const target = graph.nodes.get(value.ref);
        if (!target || depth <= 0 || seen.has(target.id)) {
          // Cannot resolve it, or we have been here already. Keep the identifier
          // so the agent still knows a link exists, without the graph blowing up.
          return target ? { id: target.id } : value.ref;
        }
        return render(graph, target, undefined, depth - 1, new Set(seen));
      })
      .filter((v): v is JsonValue => v !== undefined);

    if (rendered.length === 0) continue;
    out[key] = rendered.length === 1 ? rendered[0]! : rendered;
  }
  return out;
}
