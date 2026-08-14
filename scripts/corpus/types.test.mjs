import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, typesIn } from './types.mjs';

/** `depth` levels of array around a value: the cheapest way to blow a stack. */
const nest = (depth, value) => {
  let out = value;
  for (let i = 0; i < depth; i += 1) out = [out];
  return out;
};

describe('typesIn', () => {
  it('finds a type at the top level', () => {
    expect([...typesIn({ '@type': 'Product' })]).toEqual(['Product']);
  });

  it('finds types buried in nested objects and arrays', () => {
    const blob = {
      '@type': 'Product',
      offers: [{ '@type': 'Offer', seller: { '@type': 'Organization' } }],
    };
    expect([...typesIn(blob)].sort()).toEqual(['Offer', 'Organization', 'Product']);
  });

  it('reduces the several spellings of one type to the same name', () => {
    const blob = [
      { '@type': 'https://schema.org/Product' },
      { '@type': 'schema:Product' },
      { '@type': 'Product' },
    ];
    expect([...typesIn(blob)]).toEqual(['Product']);
  });

  it('keeps every type when @type holds a list', () => {
    expect([...typesIn({ '@type': ['Product', 'Book'] })].sort()).toEqual(['Book', 'Product']);
  });

  it('survives a blob nested far past anything real, instead of overflowing', () => {
    // Without the depth bound this throws RangeError and takes the report with
    // it. The JSON on these pages comes from strangers, so the bound is the
    // difference between a missed type and a dead run.
    const bomb = nest(200_000, { '@type': 'Product' });
    expect(() => typesIn(bomb)).not.toThrow();
  });

  it('stops descending at the limit', () => {
    const justInside = nest(MAX_DEPTH - 1, { '@type': 'Product' });
    const wellPast = nest(MAX_DEPTH + 10, { '@type': 'Product' });
    expect([...typesIn(justInside)]).toEqual(['Product']);
    expect([...typesIn(wellPast)]).toEqual([]);
  });

  it('ignores values that are not objects', () => {
    expect([...typesIn(null)]).toEqual([]);
    expect([...typesIn('Product')]).toEqual([]);
    expect([...typesIn(42)]).toEqual([]);
  });
});
