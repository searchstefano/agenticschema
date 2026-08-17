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
  /** The profile registry. Without it every entity falls back to the generic profile. */
  profiles?: Profile[];
  /**
   * Resolves the ancestors of a Schema.org type. `@agenticschema/profiles`
   * supplies this, and it lets `Vehicle` use the `Product` profile without
   * anyone having to declare that.
   */
  ancestorsOf?: (type: string) => string[];
  /**
   * Ceiling on how many tools to generate. Agents get worse as a toolset grows,
   * and a page listing 200 products has no business producing 200 tools.
   */
  maxTools?: number;
}

export interface MapResult {
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
}

/** Shared with `mapActions`: one budget covers the whole toolset, not the reads alone. */
export const DEFAULT_MAX_TOOLS = 24;

/** Turns the graph into read-tool descriptors. Nothing here has side effects. */
export function mapToTools(graph: EntityGraph, options: MapOptions = {}): MapResult {
  const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
  const diagnostics: Diagnostic[] = [];
  const tools: ToolDescriptor[] = [];
  const usedNames = new Set<string>();

  // The primary entity goes first. If the cap does bite, what survives should
  // describe the subject of the page rather than the furniture around it.
  const primaryId = selectPrimary(graph);
  const ordered = [
    ...(primaryId ? [primaryId] : []),
    ...graph.roots.filter((id) => id !== primaryId),
    ...[...graph.nodes.keys()].filter((id) => id !== primaryId && !graph.roots.includes(id)),
  ];

  // An entity reached through another entity's `from` is already on show through
  // that tool. Giving it one of its own repeats the same data and eats budget.
  const profiles = new Map<string, Profile>();
  const consumed = new Set<string>();
  for (const id of ordered) {
    const entity = graph.nodes.get(id);
    if (!entity) continue;
    const profile = resolveProfile(entity, options) ?? genericProfile(entity);
    profiles.set(id, profile);
    for (const spec of profile.read) {
      // `from` navigates to the entity, `pick` renders it inline inside the
      // parent. Either way it is already visible, so a tool of its own is a copy.
      // Every candidate, not only the one that will be used: where a page
      // carries the fact twice, the profile shows one of them, and the other
      // must not come back as a tool of its own saying the same thing.
      //
      // Everything along the path, not only where it ends: reaching a group's
      // reviews through `isVariantOf` means the group is already represented,
      // and leaving it unconsumed gave a variant page a second `get_product`, a
      // second `get_product_variants` and a second `get_product_rating`, each
      // word for word the description of the first.
      const properties = spec.from ? candidatePaths(spec.from) : (spec.pick ?? []);
      for (const property of properties) {
        for (const target of entitiesAlong(graph, entity, property)) {
          if (target.id !== id) consumed.add(target.id);
        }
      }
    }
  }

  // Secondary entities of the same type get grouped. A film page carries nine
  // Person entities, and nine tools sharing one description leave an agent with
  // no way to choose between them. A single tool that returns all nine works.
  // Naming each one in its description is the other option, but that lets page
  // text into a tool's instructions.
  const groups = new Map<string, string[]>();
  for (const id of ordered) {
    if (id === primaryId || consumed.has(id)) continue;
    const entity = graph.nodes.get(id);
    if (!entity || isMachinery(entity) || isChrome(entity)) continue;
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

  // The primary entity keeps its own dedicated tools. It is what the page is about.
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

    // Only the main ReadSpec. On background entities the sub-reads (offer,
    // reviews and the rest) are noise.
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
 * Protocol machinery rather than content. A `SearchAction` says how to search
 * and an `EntryPoint` says where. As read tools they would give an agent a
 * `get_search_action` that answers no question anyone would ask. Actions become
 * executable tools if they become anything, and that is `mapActions`' job.
 */
function isMachinery(entity: Entity): boolean {
  return entity.types.some((type) => type === 'EntryPoint' || type.endsWith('Action'));
}

/**
 * Page chrome: the theme describing its own layout rather than the page's
 * subject. A `WPHeader` answers no question anyone would ask, and a CMS emits
 * several of these on every page, each taking one of the slots the content needs.
 *
 * Deliberately not `BOILERPLATE_TYPES` from `select/primary.ts`, which answers a
 * different question. `Organization` and `BreadcrumbList` make poor guesses at
 * what a page is ABOUT while still deserving tools of their own. Nor can the
 * hierarchy decide it: `FAQPage` and `QAPage` are `WebPage` subtypes and are
 * entirely content. So the list is explicit, and stays that way.
 */
const CHROME_TYPES = new Set([
  'WebPage',
  'AboutPage',
  'CollectionPage',
  'ContactPage',
  'ItemPage',
  'ProfilePage',
  'WebPageElement',
  'WPHeader',
  'WPFooter',
  'WPSideBar',
  'SiteNavigationElement',
]);

/**
 * Every type has to be chrome. A node typed both `WebPage` and something with
 * real content is content, and the page's own primary entity is picked before
 * this runs, so a page carrying nothing but a wrapper still gets its one tool.
 */
const isChrome = (entity: Entity): boolean =>
  entity.types.length > 0 && entity.types.every((type) => CHROME_TYPES.has(type));

/** Direct match on the type first, then up the hierarchy: Vehicle to Product. */
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
  // `from` follows a reference property. No property, no tool.
  const targets = spec.from ? firstResolved(graph, entity, spec.from) : [entity];
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
    // Built from markup already in the page. Nothing is written and nothing is fetched.
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

/** One tool covering N entities of a type, instead of N tools nobody can tell apart. */
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
    // The slug, not the entity's `@type`. A registered profile's slug is written
    // by whoever registered it, and the generic one is a type token and nothing
    // else, so this description is built from vetted material end to end.
    // Interpolating `@type` put page prose into a description — the channel an
    // agent reads as instructions — while the same prose was being kept out of
    // every other description on the page.
    description: `All ${entities.length} ${profile.slug} entries on this page. ${spec.description}`,
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

/** The paths a spec offers, in the order it wants them tried. */
const candidatePaths = (from: string | string[] | undefined): string[] =>
  from === undefined ? [] : Array.isArray(from) ? from : [from];

/**
 * Walks a dotted path one reference hop at a time, handing back what it found
 * at each hop.
 *
 * A single name is the ordinary case. The path exists because on real pages the
 * fact an agent wants often sits one hop further down than the vocabulary
 * suggests: a `ProductGroup` carries no `offers` of its own, and every price on
 * the page is in `hasVariant.offers`. Without it, the tool that would answer
 * "what does this cost" is never generated, and a shop page with thirteen prices
 * in its markup tells an agent there are none.
 *
 * Every step is a reference hop, so a path cannot loop: its length bounds the
 * walk whatever the graph does. Each hop deduplicates within itself, because the
 * same offer reached through two variants is one offer and a group of thirteen
 * colours at one price would otherwise return that price thirteen times.
 *
 * Within itself and not across hops, which is a distinction one refactor here
 * got wrong. A shared `Offer` given an `@id` is normalised into the graph
 * alongside the variants that point at it, so `hasVariant` finds the offer as
 * well as the products; a walk that remembered it from the first hop then
 * refused to arrive at it on the second, and the price tool disappeared. Hops
 * are separate places, and an entity may legitimately be at two of them.
 *
 * Returns one array per hop it managed to take, so a caller can tell a path that
 * arrived from one that ran out halfway. Two callers want different halves of
 * that, and both live below rather than in a second copy of this walk.
 */
function walkPath(graph: EntityGraph, entity: Entity, path: string): Entity[][] {
  const hops: Entity[][] = [];
  let current: Entity[] = [entity];

  for (const property of path.split('.')) {
    const next: Entity[] = [];
    const seen = new Set<string>();
    for (const node of current) {
      for (const value of node.props[property] ?? []) {
        if (!isRef(value)) continue;
        const target = graph.nodes.get(value.ref);
        if (target && !seen.has(target.id)) {
          seen.add(target.id);
          next.push(target);
        }
      }
    }
    if (next.length === 0) return hops;
    hops.push(next);
    current = next;
  }

  return hops;
}

/** What a path shows: where it ends, and nothing at all unless it got there. */
function resolveTargets(graph: EntityGraph, entity: Entity, path: string): Entity[] {
  const hops = walkPath(graph, entity, path);
  return hops.length === path.split('.').length ? (hops.at(-1) ?? []) : [];
}

/**
 * What a path accounts for: everything it touched, the hops in between
 * included. Repeats are harmless — every caller feeds this into a set.
 *
 * Reaching a group's rating through `isVariantOf` speaks for the group as well,
 * and saying so is what keeps the group from being described a second time in
 * the same words. It is a choice with a cost, and the cost is worth naming:
 * anything else that intermediate carried stops being offered separately too.
 * For the product profile that is the trade we want — a group's name is the
 * product's name — but a profile whose intermediate holds something of its own
 * should not reach through it.
 */
const entitiesAlong = (graph: EntityGraph, entity: Entity, path: string): Entity[] =>
  walkPath(graph, entity, path).flat();

/**
 * The first candidate path that leads anywhere.
 *
 * Order is how a profile says which source it trusts: a variant's own
 * `aggregateRating` before the group's, because the more specific one is what
 * the page is about. Falling through only when the previous candidate found
 * nothing is what stops a page carrying both from producing two tools with one
 * description and no way to tell them apart.
 */
function firstResolved(
  graph: EntityGraph,
  entity: Entity,
  from: string | string[] | undefined
): Entity[] {
  for (const path of candidatePaths(from)) {
    const targets = resolveTargets(graph, entity, path);
    if (targets.length > 0) return targets;
  }
  return [];
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}
