import { isRef, type Entity, type EntityGraph, type JsonObject, type JsonValue } from '../types.js';

/** Un tool di lettura da generare per un'entità. */
export interface ReadSpec {
  /** Suffisso del nome: `slug` "product" + `name` "offer" -> `get_product_offer`. Omesso -> `get_product`. */
  name?: string;
  description: string;
  /** Prima di leggere, naviga in questa proprietà-riferimento (es. "offers"). */
  from?: string;
  /** Proprietà da includere. Se assente, tutte quelle disponibili. */
  pick?: string[];
  /** Se la proprietà `from` ha più valori, restituiscili tutti invece del primo. */
  list?: boolean;
}

/**
 * Dichiara COSA generare per un tipo. La meccanica (naming, materializzazione,
 * cap, annotazioni) è condivisa e sta nel mapper.
 */
export interface Profile {
  /** Tipi schema.org coperti, incluse le varianti (es. `['Article','NewsArticle','BlogPosting']`). */
  types: string[];
  /** Nome base del tool, in snake_case. */
  slug: string;
  read: ReadSpec[];
}

/**
 * Usato quando nessun profilo copre il tipo, nemmeno risalendo la gerarchia.
 * Garantisce che ogni entità produca comunque qualcosa di utile.
 */
export function genericProfile(entity: Entity): Profile {
  const type = entity.types[0] ?? 'thing';
  return {
    types: entity.types,
    slug: toSlug(type),
    // In inglese come le description dei profili: è testo che legge il modello,
    // su pagine di qualsiasi lingua.
    read: [{ description: `Structured data of type ${type} found on this page.` }],
  };
}

export const toSlug = (value: string): string =>
  value
    // Confine di acronimo prima del confine normale, altrimenti `FAQPage` -> `faqpage`.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * Rende un'entità in JSON semplice, risolvendo i riferimenti fino a `depth`.
 * I cicli sono interrotti da `seen`: senza, un grafo con riferimenti reciproci
 * (comunissimo con `isRelatedTo`) non terminerebbe.
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
          // Riferimento non risolvibile o già visitato: si conserva l'identificatore,
          // così l'agente sa che esiste un collegamento senza che il grafo esploda.
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
