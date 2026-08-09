/**
 * Genera `src/hierarchy.generated.ts` dal vocabolario ufficiale Schema.org.
 *
 *   node scripts/build-hierarchy.mjs
 *
 * L'output è committato: la build non deve dipendere dalla rete. Si rigenera
 * a mano quando esce una nuova versione del vocabolario.
 *
 * Vengono tenuti solo gli archi tipo -> genitori. Etichette, commenti e proprietà
 * pesano megabyte e non servono a risolvere un profilo.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VOCAB_URL = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hierarchy.generated.ts');

// Il vocabolario usa IRI compatti (`schema:Product`) e contiene anche classi di
// altri vocabolari (`fibo-fnd-pas-pas:Product`, `dc:...`): vanno scartate.
const SCHEMA_PREFIX = 'schema:';
const isSchema = (iri) => typeof iri === 'string' && iri.startsWith(SCHEMA_PREFIX);

/** `schema:Product` -> `Product` */
const localName = (iri) => iri.slice(SCHEMA_PREFIX.length);

const asArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

const response = await fetch(VOCAB_URL);
if (!response.ok) {
  console.error(`vocabolario non scaricabile: HTTP ${response.status}`);
  process.exit(1);
}
const vocab = await response.json();

const parents = {};
let classCount = 0;

for (const node of vocab['@graph'] ?? []) {
  const types = asArray(node['@type']);
  if (!types.includes('rdfs:Class')) continue;

  const id = node['@id'];
  if (!isSchema(id)) continue;
  classCount++;

  const supers = asArray(node['rdfs:subClassOf'])
    .map((s) => (typeof s === 'string' ? s : s?.['@id']))
    .filter(isSchema)
    .map(localName);

  if (supers.length) parents[localName(id)] = supers;
}

const sorted = Object.keys(parents).sort();
const body = sorted.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(parents[k])},`).join('\n');

const file = `// GENERATO da scripts/build-hierarchy.mjs — non modificare a mano.
// Fonte: ${VOCAB_URL}
// Classi nel vocabolario: ${classCount}. Classi con almeno un genitore: ${sorted.length}.

/** Genitori diretti di ogni tipo Schema.org. */
export const DIRECT_PARENTS: Record<string, readonly string[]> = {
${body}
};
`;

await writeFile(OUT, file, 'utf8');
console.log(`scritte ${sorted.length} classi (su ${classCount}) in ${OUT}`);
