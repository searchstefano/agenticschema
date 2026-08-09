import type { MapOptions } from '@agenticschema/core';
import { DIRECT_PARENTS } from './hierarchy.generated.js';
import { PROFILES } from './profiles.js';

export { PROFILES } from './profiles.js';
export { DIRECT_PARENTS } from './hierarchy.generated.js';

const cache = new Map<string, readonly string[]>();

/**
 * Antenati di un tipo Schema.org, dal più vicino al più lontano.
 * L'ordine conta: il mapper prende il primo profilo che trova risalendo, quindi
 * `FastFoodRestaurant` deve incontrare `FoodEstablishment` prima di `Thing`.
 *
 * La visita è in ampiezza perché la gerarchia Schema.org ammette ereditarietà
 * multipla (`Restaurant` è sia `FoodEstablishment` sia `LocalBusiness`).
 */
export function ancestorsOf(type: string): readonly string[] {
  const cached = cache.get(type);
  if (cached) return cached;

  const out: string[] = [];
  const seen = new Set<string>([type]);
  let frontier = [...(DIRECT_PARENTS[type] ?? [])];

  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      out.push(parent);
      next.push(...(DIRECT_PARENTS[parent] ?? []));
    }
    frontier = next;
  }

  cache.set(type, out);
  return out;
}

/**
 * Da passare direttamente a `mapToTools`:
 *
 *   mapToTools(graph, { ...schemaOrgProfiles })
 */
export const schemaOrgProfiles: Pick<MapOptions, 'profiles' | 'ancestorsOf'> = {
  profiles: [...PROFILES],
  ancestorsOf: (type) => [...ancestorsOf(type)],
};
