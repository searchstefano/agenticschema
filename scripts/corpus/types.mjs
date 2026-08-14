/**
 * Reading Schema.org types out of a raw JSON-LD blob.
 *
 * Pure, and kept apart from `report.mjs` because that file runs its report on
 * import: anything testable has to live where importing it does nothing.
 */

/** Types that describe the page's chrome rather than its subject. */
export const FURNITURE = new Set([
  'WebSite',
  'WebPage',
  'Organization',
  'BreadcrumbList',
  'ListItem',
  'SiteNavigationElement',
  'CollectionPage',
  'ItemList',
  'ImageObject',
  'SearchAction',
  'ReadAction',
]);

/**
 * Real JSON-LD does not nest anything like this deep; a blob built to crash a
 * reader does. Without a bound, one page of `[[[[[…]]]]]` takes the whole report
 * down with a stack overflow, and the JSON on these pages comes from strangers.
 */
export const MAX_DEPTH = 32;

/** Every `@type` in a blob, however deeply it is buried and however it is spelled. */
export function typesIn(value, found = new Set(), depth = 0) {
  if (depth > MAX_DEPTH) return found;

  if (Array.isArray(value)) {
    for (const item of value) typesIn(item, found, depth + 1);
    return found;
  }
  if (!value || typeof value !== 'object') return found;

  for (const [key, inner] of Object.entries(value)) {
    if (key === '@type') {
      for (const t of Array.isArray(inner) ? inner : [inner]) {
        // `https://schema.org/Product`, `schema:Product` and `Product` are one type.
        if (typeof t === 'string') found.add(t.replace(/^.*[/#:]/, ''));
      }
    } else {
      typesIn(inner, found, depth + 1);
    }
  }
  return found;
}
