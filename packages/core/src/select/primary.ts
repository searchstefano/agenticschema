import { isRef, type EntityGraph } from '../types.js';

/**
 * Tipi che descrivono il contorno della pagina, non il suo soggetto.
 * Se una pagina contiene solo questi, non c'è un'entità primaria interessante.
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
 * Decide di quale entità "parla" la pagina.
 *
 * L'ordine non è arbitrario: `mainEntity` e `mainEntityOfPage` sono dichiarazioni
 * esplicite dell'autore e vincono su qualunque euristica. Attenzione che puntano in
 * direzioni opposte — `WebPage.mainEntity` va verso l'entità, mentre
 * `Thing.mainEntityOfPage` parte dall'entità e va verso la pagina.
 */
export function selectPrimary(graph: EntityGraph): string | undefined {
  // 1. Un nodo dichiara la propria entità principale.
  for (const entity of graph.nodes.values()) {
    const main = entity.props['mainEntity']?.[0];
    if (main && isRef(main) && graph.nodes.has(main.ref)) return main.ref;
  }

  // 2. Un nodo dichiara di ESSERE l'entità principale di una pagina.
  for (const entity of graph.nodes.values()) {
    if (entity.props['mainEntityOfPage']) return entity.id;
  }

  // 3. `about` di una pagina.
  for (const entity of graph.nodes.values()) {
    if (!isPage(entity.types)) continue;
    const about = entity.props['about']?.[0];
    if (about && isRef(about) && graph.nodes.has(about.ref)) return about.ref;
  }

  // 4. Prima radice che non sia contorno.
  const root = graph.roots.find((id) => {
    const entity = graph.nodes.get(id);
    return entity !== undefined && entity.types.length > 0 && !isBoilerplate(entity.types);
  });
  if (root) return root;

  // 5. Qualsiasi nodo non-contorno, anche non radice (capita con i @graph piatti dei CMS).
  for (const entity of graph.nodes.values()) {
    if (entity.types.length > 0 && !isBoilerplate(entity.types)) return entity.id;
  }

  return graph.roots[0];
}
