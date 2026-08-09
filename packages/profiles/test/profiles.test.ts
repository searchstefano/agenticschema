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
  it('risale la gerarchia fino alla radice', () => {
    expect(ancestorsOf('NewsArticle')).toContain('Article');
    expect(ancestorsOf('NewsArticle')).toContain('CreativeWork');
    expect(ancestorsOf('NewsArticle')).toContain('Thing');
  });

  it('mette gli antenati vicini prima di quelli lontani', () => {
    const chain = ancestorsOf('FastFoodRestaurant');
    expect(chain.indexOf('FoodEstablishment')).toBeLessThan(chain.indexOf('Thing'));
  });

  it('gestisce l-ereditarietà multipla', () => {
    // Restaurant eredita da FoodEstablishment, che a sua volta è LocalBusiness
    expect(ancestorsOf('Restaurant')).toContain('LocalBusiness');
  });

  it('restituisce vuoto per un tipo sconosciuto invece di lanciare', () => {
    expect(ancestorsOf('NonEsisteQuestoTipo')).toEqual([]);
  });

  it('non entra in loop su gerarchie con cicli', () => {
    // Se il vocabolario contenesse un ciclo, la visita deve comunque terminare.
    expect(() => ancestorsOf('Thing')).not.toThrow();
  });
});

describe('registry', () => {
  it('non ha slug duplicati', () => {
    const slugs = PROFILES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('non assegna lo stesso tipo a due profili', () => {
    const seen = new Map<string, string>();
    for (const profile of PROFILES) {
      for (const type of profile.types) {
        expect(seen.has(type), `${type} è in ${seen.get(type)} e in ${profile.slug}`).toBe(false);
        seen.set(type, profile.slug);
      }
    }
  });

  it('ogni ReadSpec ha una descrizione non vuota', () => {
    for (const profile of PROFILES) {
      for (const spec of profile.read) {
        expect(spec.description.length, `${profile.slug}/${spec.name ?? '-'}`).toBeGreaterThan(10);
      }
    }
  });
});

describe('profili applicati a pagine reali', () => {
  it('un e-commerce produce prodotto, offerta e recensioni', async () => {
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

  it('una FAQ espone le domande come lista', async () => {
    const tools = toolsFor(`{
      "@context":"https://schema.org","@type":"FAQPage",
      "mainEntity":[
        {"@type":"Question","name":"Si spedisce all-estero?","acceptedAnswer":{"@type":"Answer","text":"Sì, in tutta la UE."}},
        {"@type":"Question","name":"Quanto dura la garanzia?","acceptedAnswer":{"@type":"Answer","text":"Due anni."}}
      ]}`);

    const faq = tools.find((t) => t.name === 'get_faq_questions')!;
    expect(faq).toBeDefined();
    const questions = await run(faq);
    expect(questions).toHaveLength(2);
    expect(JSON.stringify(questions)).toContain('Due anni');
  });

  it('un ristorante usa il profilo business per ereditarietà, non il generico', async () => {
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

  it('un tipo fuori registry ricade sul generico senza rompersi', async () => {
    const tools = toolsFor('{"@context":"https://schema.org","@type":"Occupation","name":"Falegname"}');
    expect(tools.map((t) => t.name)).toEqual(['get_occupation']);
    expect(await run(tools[0]!)).toMatchObject({ name: 'Falegname' });
  });

  it('pick esclude davvero i campi non richiesti', async () => {
    const tools = toolsFor(`{
      "@context":"https://schema.org","@type":"Product","name":"Zaino",
      "sku":"ZT-45-BLU","weight":"1.2kg","award":"premio inventato"}`);
    const product = await run(tools[0]!);
    expect(product).toHaveProperty('sku');
    // `weight` e `award` non sono nel pick del profilo product
    expect(product).not.toHaveProperty('weight');
    expect(product).not.toHaveProperty('award');
  });
});
