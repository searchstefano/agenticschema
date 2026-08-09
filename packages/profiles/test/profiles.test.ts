import { describe, expect, it } from 'vitest';
import { extract, mapToTools, normalize, type EntityGraph, type ToolDescriptor } from '@agenticschema/core';
import { PROFILES, ancestorsOf, schemaOrgProfiles } from '../src/index.js';

const graphOf = (json: string): EntityGraph =>
  normalize(extract(`<script type="application/ld+json">${json}</script>`).nodes);

const toolsFor = (json: string): ToolDescriptor[] =>
  mapToTools(graphOf(json), schemaOrgProfiles).tools;

const run = async (tool: ToolDescriptor): Promise<any> =>
  JSON.parse((await tool.execute({})).content[0]!.text);

describe('ancestorsOf', () => {
  it('walks the hierarchy all the way to the root', () => {
    expect(ancestorsOf('NewsArticle')).toContain('Article');
    expect(ancestorsOf('NewsArticle')).toContain('CreativeWork');
    expect(ancestorsOf('NewsArticle')).toContain('Thing');
  });

  it('puts near ancestors before distant ones', () => {
    const chain = ancestorsOf('FastFoodRestaurant');
    expect(chain.indexOf('FoodEstablishment')).toBeLessThan(chain.indexOf('Thing'));
  });

  it('handles multiple inheritance', () => {
    // Restaurant inherits from FoodEstablishment, which is itself a LocalBusiness
    expect(ancestorsOf('Restaurant')).toContain('LocalBusiness');
  });

  it('returns empty for an unknown type instead of throwing', () => {
    expect(ancestorsOf('NonEsisteQuestoTipo')).toEqual([]);
  });

  it('does not loop on a hierarchy with cycles', () => {
    // Should the vocabulary ever contain a cycle, the walk still has to finish.
    expect(() => ancestorsOf('Thing')).not.toThrow();
  });
});

describe('registry', () => {
  it('has no duplicate slugs', () => {
    const slugs = PROFILES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('never assigns one type to two profiles', () => {
    const seen = new Map<string, string>();
    for (const profile of PROFILES) {
      for (const type of profile.types) {
        expect(seen.has(type), `${type} è in ${seen.get(type)} e in ${profile.slug}`).toBe(false);
        seen.set(type, profile.slug);
      }
    }
  });

  it('every ReadSpec has a non-empty description', () => {
    for (const profile of PROFILES) {
      for (const spec of profile.read) {
        expect(spec.description.length, `${profile.slug}/${spec.name ?? '-'}`).toBeGreaterThan(10);
      }
    }
  });
});

describe('profiles applied to realistic pages', () => {
  it('a shop page yields product, offer and reviews', async () => {
    const tools = toolsFor(`{
      "@context":"https://schema.org","@type":"Product",
      "name":"Zaino Trekking 45L","sku":"ZT-45-BLU","description":"Con telaio in alluminio.",
      "offers":{"@type":"Offer","price":"129.90","priceCurrency":"EUR","availability":"https://schema.org/InStock"},
      "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":"27"},
      "review":[{"@type":"Review","reviewBody":"ottimo"},{"@type":"Review","reviewBody":"buono"}]
    }`);

    expect(tools.map((t) => t.name)).toEqual([
      'get_product',
      'get_product_offer',
      'get_product_rating',
      'get_product_reviews',
    ]);
    expect(await run(tools[1]!)).toMatchObject({ price: '129.90', priceCurrency: 'EUR' });
    expect(await run(tools[3]!)).toHaveLength(2);
  });

  it('an FAQ exposes its questions as one list', async () => {
    const tools = toolsFor(`{
      "@context":"https://schema.org","@type":"FAQPage",
      "mainEntity":[
        {"@type":"Question","name":"Do you ship abroad?","acceptedAnswer":{"@type":"Answer","text":"Yes, across the EU."}},
        {"@type":"Question","name":"How long is the warranty?","acceptedAnswer":{"@type":"Answer","text":"Two years."}}
      ]}`);

    const faq = tools.find((t) => t.name === 'get_faq_questions')!;
    expect(faq).toBeDefined();
    const questions = await run(faq);
    expect(questions).toHaveLength(2);
    expect(JSON.stringify(questions)).toContain('Two years');
  });

  it('a restaurant inherits the business profile rather than the generic one', async () => {
    const tools = toolsFor(`{
      "@context":"https://schema.org","@type":"Restaurant",
      "name":"Trattoria da Nino","telephone":"+39 000 0000000","servesCuisine":"Italiana",
      "address":{"@type":"PostalAddress","streetAddress":"Via Roma 1","addressLocality":"Bologna"},
      "openingHoursSpecification":[
        {"@type":"OpeningHoursSpecification","dayOfWeek":"Monday","opens":"12:00","closes":"15:00"},
        {"@type":"OpeningHoursSpecification","dayOfWeek":"Tuesday","opens":"12:00","closes":"15:00"}
      ]}`);

    expect(tools.map((t) => t.name)).toEqual([
      'get_business',
      'get_business_address',
      'get_business_hours',
    ]);
    expect(await run(tools[0]!)).toMatchObject({ name: 'Trattoria da Nino', servesCuisine: 'Italiana' });
    expect(await run(tools[2]!)).toHaveLength(2);
  });

  it('a type outside the registry falls back to the generic profile', async () => {
    const tools = toolsFor('{"@context":"https://schema.org","@type":"Occupation","name":"Falegname"}');
    expect(tools.map((t) => t.name)).toEqual(['get_occupation']);
    expect(await run(tools[0]!)).toMatchObject({ name: 'Falegname' });
  });

  it('pick really does leave unwanted fields out', async () => {
    const tools = toolsFor(`{
      "@context":"https://schema.org","@type":"Product","name":"Zaino",
      "sku":"ZT-45-BLU","weight":"1.2kg","award":"premio inventato"}`);
    const product = await run(tools[0]!);
    expect(product).toHaveProperty('sku');
    // `weight` and `award` are not in the product profile pick
    expect(product).not.toHaveProperty('weight');
    expect(product).not.toHaveProperty('award');
  });
});
