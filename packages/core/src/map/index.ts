import { selectPrimary } from '../select/primary.js';
import {
  genericProfile,
  materialize,
  toSlug,
  type Profile,
  type ReadSpec,
} from './profile.js';
import { isRef, type Diagnostic, type Entity, type EntityGraph, type ToolDescriptor } from '../types.js';

export { type Profile, type ReadSpec, genericProfile, materialize, toSlug } from './profile.js';

export interface MapOptions {
  /** Registry dei profili. Senza, ogni entità ricade sul profilo generico. */
  profiles?: Profile[];
  /**
   * Risolve gli antenati di un tipo schema.org (fornito da `@agenticschema/profiles`).
   * Permette a `Vehicle` di usare il profilo di `Product` senza doverlo dichiarare.
   */
  ancestorsOf?: (type: string) => string[];
  /**
   * Tetto al numero di tool. Gli agenti degradano con toolset grandi, e una pagina
   * con 200 prodotti non deve generare 200 tool.
   */
  maxTools?: number;
}

export interface MapResult {
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
}

const DEFAULT_MAX_TOOLS = 24;

/** Trasforma il grafo in descrittori di tool di lettura. Nessun effetto collaterale. */
export function mapToTools(graph: EntityGraph, options: MapOptions = {}): MapResult {
  const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
  const diagnostics: Diagnostic[] = [];
  const tools: ToolDescriptor[] = [];
  const usedNames = new Set<string>();

  // L'entità primaria va per prima: se si tocca il cap, i tool che restano
  // sono quelli che descrivono il soggetto della pagina, non il contorno.
  const primaryId = selectPrimary(graph);
  const ordered = [
    ...(primaryId ? [primaryId] : []),
    ...graph.roots.filter((id) => id !== primaryId),
    ...[...graph.nodes.keys()].filter((id) => id !== primaryId && !graph.roots.includes(id)),
  ];

  // Un'entità raggiunta dal `from` di un'altra è già esposta da quel tool: darle
  // anche un tool proprio duplicherebbe gli stessi dati e consumerebbe il budget.
  const profiles = new Map<string, Profile>();
  const consumed = new Set<string>();
  for (const id of ordered) {
    const entity = graph.nodes.get(id);
    if (!entity) continue;
    const profile = resolveProfile(entity, options) ?? genericProfile(entity);
    profiles.set(id, profile);
    for (const spec of profile.read) {
      // `from` naviga verso l'entità; `pick` la rende inline dentro il genitore.
      // In entrambi i casi è già esposta, e un tool tutto suo la duplicherebbe.
      const properties = spec.from ? [spec.from] : (spec.pick ?? []);
      for (const property of properties) {
        for (const target of resolveTargets(graph, entity, property)) {
          if (target.id !== id) consumed.add(target.id);
        }
      }
    }
  }

  // Le entità secondarie dello stesso tipo vanno raggruppate. Una pagina di film
  // reale contiene nove Person: nove tool con la stessa description sono
  // inservibili per un agente, che non ha modo di sceglierne uno. Un solo tool
  // che le restituisce tutte sì. Metterne il nome nella description sarebbe
  // l'altra strada, ma farebbe entrare testo di pagina nelle istruzioni del tool.
  const groups = new Map<string, string[]>();
  for (const id of ordered) {
    if (id === primaryId || consumed.has(id)) continue;
    const entity = graph.nodes.get(id);
    if (!entity || isMachinery(entity)) continue;
    const slug = profiles.get(id)?.slug ?? 'thing';
    groups.set(slug, [...(groups.get(slug) ?? []), id]);
  }

  let capped = false;
  const emit = (built: ToolDescriptor | undefined): boolean => {
    if (tools.length >= maxTools) {
      capped = true;
      return false;
    }
    if (built) tools.push(built);
    return true;
  };

  // L'entità primaria conserva i suoi tool dedicati: è il soggetto della pagina.
  const primary = primaryId ? graph.nodes.get(primaryId) : undefined;
  if (primary) {
    const profile = profiles.get(primary.id) ?? genericProfile(primary);
    for (const spec of profile.read) {
      if (!emit(buildReadTool(graph, primary, profile, spec, usedNames))) break;
    }
  }

  for (const [, ids] of groups) {
    if (capped) break;
    const entities = ids.map((id) => graph.nodes.get(id)).filter((e): e is Entity => Boolean(e));
    const first = entities[0];
    if (!first) continue;
    const profile = profiles.get(first.id) ?? genericProfile(first);

    if (entities.length === 1) {
      for (const spec of profile.read) {
        if (!emit(buildReadTool(graph, first, profile, spec, usedNames))) break;
      }
      continue;
    }

    // Solo la ReadSpec principale: per le entità di contorno le sotto-letture
    // (offerta, recensioni…) sono rumore.
    const spec = profile.read[0];
    if (spec) emit(buildGroupTool(graph, entities, profile, spec, usedNames));
  }

  if (capped) {
    diagnostics.push({
      level: 'warn',
      code: 'tool-limit',
      message: `reached the ${maxTools} tool cap: remaining entities were not exposed`,
    });
  }

  return { tools, diagnostics };
}

/**
 * Meccanica del protocollo, non contenuto. Un `SearchAction` descrive COME
 * cercare e un `EntryPoint` DOVE: esporli come tool di lettura darebbe a un
 * agente `get_search_action`, che non risponde a nessuna domanda.
 * Le azioni diventano semmai tool eseguibili, e di quello si occupa `mapActions`.
 */
function isMachinery(entity: Entity): boolean {
  return entity.types.some((type) => type === 'EntryPoint' || type.endsWith('Action'));
}

/** Match diretto sul tipo, poi risalita della gerarchia (Vehicle -> Product). */
function resolveProfile(entity: Entity, options: MapOptions): Profile | undefined {
  const profiles = options.profiles;
  if (!profiles?.length) return undefined;

  for (const type of entity.types) {
    const direct = profiles.find((p) => p.types.includes(type));
    if (direct) return direct;
  }
  if (!options.ancestorsOf) return undefined;

  for (const type of entity.types) {
    for (const ancestor of options.ancestorsOf(type)) {
      const inherited = profiles.find((p) => p.types.includes(ancestor));
      if (inherited) return inherited;
    }
  }
  return undefined;
}

function buildReadTool(
  graph: EntityGraph,
  entity: Entity,
  profile: Profile,
  spec: ReadSpec,
  usedNames: Set<string>
): ToolDescriptor | undefined {
  // `from` naviga in una proprietà-riferimento: niente proprietà, niente tool.
  const targets = spec.from ? resolveTargets(graph, entity, spec.from) : [entity];
  if (targets.length === 0) return undefined;

  const base = ['get', profile.slug, spec.name ? toSlug(spec.name) : '']
    .filter(Boolean)
    .join('_');
  const name = uniqueName(base, usedNames);

  const selected = spec.list ? targets : targets.slice(0, 1);

  return {
    name,
    description: spec.description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    // Generati dal markup della pagina: nessuna scrittura, nessuna chiamata di rete.
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: () => {
      const payload = selected.map((target) => materialize(graph, target, { pick: spec.pick }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(spec.list ? payload : payload[0] ?? {}, null, 2),
          },
        ],
      };
    },
    source: { kind: 'read', entityId: entity.id, entityType: entity.types[0] },
  };
}

/** Un solo tool per N entità dello stesso tipo, invece di N tool indistinguibili. */
function buildGroupTool(
  graph: EntityGraph,
  entities: readonly Entity[],
  profile: Profile,
  spec: ReadSpec,
  usedNames: Set<string>
): ToolDescriptor {
  const name = uniqueName(`list_${profile.slug}`, usedNames);
  const type = entities[0]?.types[0] ?? profile.slug;

  return {
    name,
    description: `All ${entities.length} ${type} entries on this page. ${spec.description}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            entities.map((e) => materialize(graph, e, { pick: spec.pick })),
            null,
            2
          ),
        },
      ],
    }),
    source: { kind: 'read', entityType: type },
  };
}

function resolveTargets(graph: EntityGraph, entity: Entity, property: string): Entity[] {
  const values = entity.props[property];
  if (!values) return [];
  return values
    .filter(isRef)
    .map((ref) => graph.nodes.get(ref.ref))
    .filter((e): e is Entity => e !== undefined);
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}
