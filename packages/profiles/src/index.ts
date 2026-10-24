import type { MapOptions } from '@agenticschema/core';
import { DIRECT_PARENTS } from './hierarchy.generated.js';
import { PROFILES } from './profiles.js';

export { PROFILES } from './profiles.js';
export { DIRECT_PARENTS } from './hierarchy.generated.js';

const cache = new Map<string, readonly string[]>();
let lowerMap: Map<string, string> | undefined;

function canonicalType(type: string): string {
  if (Object.hasOwn(DIRECT_PARENTS, type)) return type;
  if (!lowerMap) {
    lowerMap = new Map();
    for (const key of Object.keys(DIRECT_PARENTS)) {
      lowerMap.set(key.toLowerCase(), key);
    }
  }
  return lowerMap.get(type.toLowerCase()) ?? type;
}

/**
 * Ancestors of a Schema.org type, nearest first.
 *
 * The order matters. The mapper takes the first profile it finds on the way up,
 * so `FastFoodRestaurant` has to meet `FoodEstablishment` before it meets `Thing`.
 *
 * Breadth-first, because the Schema.org hierarchy allows multiple inheritance:
 * `Restaurant` is both a `FoodEstablishment` and a `LocalBusiness`.
 */
export function ancestorsOf(type: string): readonly string[] {
  const cached = cache.get(type);
  if (cached) return cached;

  const start = canonicalType(type);
  const out: string[] = [];
  const seen = new Set<string>([start]);
  let frontier = [...(Object.hasOwn(DIRECT_PARENTS, start) ? (DIRECT_PARENTS[start] ?? []) : [])];

  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      out.push(parent);
      if (Object.hasOwn(DIRECT_PARENTS, parent)) {
        next.push(...(DIRECT_PARENTS[parent] ?? []));
      }
    }
    frontier = next;
  }

  cache.set(type, out);
  return out;
}

/**
 * Hand this straight to `mapToTools`:
 *
 *   mapToTools(graph, { ...schemaOrgProfiles })
 */
export const schemaOrgProfiles: Pick<MapOptions, 'profiles' | 'ancestorsOf'> = {
  profiles: [...PROFILES],
  ancestorsOf: (type) => [...ancestorsOf(type)],
};
