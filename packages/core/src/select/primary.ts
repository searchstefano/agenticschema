import { isRef, type EntityGraph } from '../types.js';

/**
 * Types that describe the page's furniture rather than its subject.
 * A page carrying only these has no primary entity worth exposing.
 */
export const BOILERPLATE_TYPES = new Set([
  'BreadcrumbList',
  'WebSite',
  'Organization',
  'SiteNavigationElement',
  'WPHeader',
  'WPFooter',
  'WPSideBar',
  'ItemList',
  'ListItem',
]);

const isPage = (types: string[]): boolean => types.some((t) => t.endsWith('Page'));

const isBoilerplate = (types: string[]): boolean =>
  types.length > 0 && types.every((t) => BOILERPLATE_TYPES.has(t) || t.endsWith('Page'));

/**
 * Works out which entity a page is actually about.
 *
 * The order is not arbitrary. `mainEntity` and `mainEntityOfPage` are the author
 * saying so outright, and they beat any heuristic. Watch out that they point in
 * opposite directions: `WebPage.mainEntity` points at the entity, while
 * `Thing.mainEntityOfPage` starts from the entity and points back at the page.
 */
export function selectPrimary(graph: EntityGraph): string | undefined {
  // 1. A node names its main entity.
  for (const entity of graph.nodes.values()) {
    const main = entity.props['mainEntity']?.[0];
    if (main && isRef(main) && graph.nodes.has(main.ref)) return main.ref;
  }

  // 2. A node declares that it IS the main entity of some page.
  for (const entity of graph.nodes.values()) {
    if (entity.props['mainEntityOfPage']) return entity.id;
  }

  // 3. What a page says it is about.
  for (const entity of graph.nodes.values()) {
    if (!isPage(entity.types)) continue;
    const about = entity.props['about']?.[0];
    if (about && isRef(about) && graph.nodes.has(about.ref)) return about.ref;
  }

  // 4. First root that isn't furniture.
  const root = graph.roots.find((id) => {
    const entity = graph.nodes.get(id);
    return entity !== undefined && entity.types.length > 0 && !isBoilerplate(entity.types);
  });
  if (root) return root;

  // 5. Any non-furniture node, root or not. Flat @graph blocks from CMSs land here.
  for (const entity of graph.nodes.values()) {
    if (entity.types.length > 0 && !isBoilerplate(entity.types)) return entity.id;
  }

  return graph.roots[0];
}
