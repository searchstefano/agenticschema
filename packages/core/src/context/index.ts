import { type PageMeta } from '../extract/index.js';
import { sanitizeText } from '../guard/index.js';
import { scrape, type PipelineOptions, type ScrapeActionSummary } from '../pipeline.js';
import type { Diagnostic, JsonObject, JsonValue, RawNode } from '../types.js';

export interface FieldProvenance {
  /** Field path or name on the primary entity (e.g. `name`, `author`, `offers.price`). */
  field: string;
  /** Stringified scalar value from the structured markup. */
  value: string;
  /** Which syntax provided the primary entity (`jsonld`, `microdata`, `rdfa`). */
  syntax?: 'jsonld' | 'microdata' | 'rdfa';
  /** True when the scalar value also appears in the page's visible text. */
  verifiedInText: boolean;
}

export interface EpistemicAtom {
  /** Compressed proposition stripped of zero-surprise rhetorical scaffolding. */
  claim: string;
  /** Non-parametric epistemic surprisal density (bits of novel information per token). */
  surprisal: number;
  /** Semantic category of the atomic proposition. */
  kind: 'metric' | 'constraint' | 'temporal' | 'fact';
}

export interface TemporalCone {
  /** ISO publication date if detected (`datePublished`, `article:published_time`, `<time>`). */
  publishedAt?: string;
  /** ISO modification date if detected (`dateModified`, `article:modified_time`). */
  modifiedAt?: string;
  /** Offer or event expiration date (`priceValidUntil`, `validThrough`, `expires`). */
  validThrough?: string;
  /** Document age in days relative to reference time. */
  ageDays?: number;
  /** True when `validThrough` / `priceValidUntil` is in the past light-cone (expired). */
  isExpiredOffer: boolean;
  /** True when an older document uses unanchored indexical time words ("currently", "this year", "latest"). */
  hasUnanchoredDeictics: boolean;
  /** Relativistic temporal warning anchoring indexical claims or flagging expired offers. */
  anchorWarning?: string;
}

export interface MachineTwin {
  /** Direct URL to the machine-readable twin or shadow API endpoint. */
  url: string;
  /** Endpoint protocol/format category. */
  kind: 'json-api' | 'llms-txt' | 'nextjs-data' | 'graphql' | 'feed';
  /** Human/agent-readable description of what this endpoint provides. */
  description: string;
}

export interface FrontierLink {
  /** Resolved URL of the next-hop link. */
  url: string;
  /** Visible anchor text or label. */
  anchor: string;
  /** Information Scent score (Pirolli-Card foraging metric). */
  scent: number;
  /** Why this hop has high epistemic value (e.g. `datasheet/pdf`, `query-match`, `primary-source`). */
  reason: string;
}

export interface ContextOptions extends PipelineOptions {
  /**
   * Optional search query or user question. When provided, `toContext()` uses
   * a Submodular Information Bottleneck (BM25F + character 3-gram similarity +
   * Schema.org property intent projection) to prioritize only the structured
   * fields, specs, and prose passages that answer the query.
   */
  query?: string;
  /**
   * Target token ceiling for `result.context` (1 token ≈ 4 chars). When set,
   * greedy submodular selection maximizes query coverage within this budget.
   */
  tokenBudget?: number;
  /**
   * Holographic multi-resolution level:
   * - `'L0'` (~35 tokens): Peripheral "Semantic DNA Pulse" (identity, key invariants, temporal frame, top atoms, twin URL).
   * - `'L1'` (~180 tokens): Epistemic Core (Schema + Specs + Temporal Cone + Surprisal-Distilled Epistemic Atoms + Machine Twins + Frontier, zero verbose prose).
   * - `'L2'` (default): Full Foveal Hybrid Context (Structured Facts + Specs + Epistemic Metadata + Deduplicated Prose).
   */
  resolution?: 'L0' | 'L1' | 'L2';
  /** Optional reference timestamp (ms or ISO string) for relativistic temporal calculations. Defaults to `Date.now()`. */
  referenceNow?: number | string;
  /** Maximum characters of deduplicated body prose to include. Defaults to 4000. */
  maxProseChars?: number;
  /** Output serialization format for `result.context`. Defaults to `'markdown'`. */
  format?: 'markdown' | 'json';
}

export interface ContextResult {
  /** One-shot hybrid context string ready to inject into an LLM prompt (zero extra turns). */
  context: string;
  /** Ultra-compact ~35-token `L0` Holographic Pulse ("Semantic DNA strand") of the page. */
  pulse: string;
  /** Primary entity materialized as clean JSON (projected to query-relevant fields if `query` + `tokenBudget` are set). */
  primary?: JsonObject;
  /** All non-action entities materialized on the page. */
  entities: JsonObject[];
  /** Key-value specifications extracted from semantic `<dl>` lists and 2-column `<table>`s. */
  specs: Record<string, string>;
  /** Structured fields recovered from SSR hydration state (`__NEXT_DATA__`, `__NUXT__`), if any. */
  hydration?: JsonObject;
  /** Surprisal-distilled atomic propositions (high-entropy facts stripped of rhetorical filler). */
  atoms: EpistemicAtom[];
  /** Relativistic temporal coordinates and offer-expiry / indexical-drift warnings. */
  temporal: TemporalCone;
  /** Discovered native JSON APIs, `/llms.txt`, Next.js data routes, or feeds embedded in the page. */
  machineTwins: MachineTwin[];
  /** Information-Foraging-ranked next-hop links that resolve what this page leaves unanswered. */
  frontier: FrontierLink[];
  /** Page-level metadata (`title`, `description`, `canonical`, `language`, `openGraph`, `twitter`). */
  meta: PageMeta;
  /** Discovered executable GET actions (`SearchAction`, `ReadAction`, etc.). */
  actions: ScrapeActionSummary[];
  /** Cross-check results comparing structured claims against visible text. */
  provenance: FieldProvenance[];
  /** Warnings when structured claims diverge from or are absent in the visible text (anti-cloaking / byline diff). */
  discrepancies: string[];
  /** Visible byline detected in the article prose (e.g. `"AFP"`, `"Reuters"`), if any. */
  visibleByline?: string;
  /** Deduplicated visible body prose with content already in `primary`/`entities` removed. */
  prose: string;
  /** 64-bit locality-sensitive SimHash fingerprint (16-char hex) of the page's semantic content. */
  fingerprint: string;
  /** Estimated token count (~4 chars/token heuristic) of `context`. */
  estimatedTokens: number;
  /** Pipeline diagnostics. */
  diagnostics: Diagnostic[];
}

export interface ForagedWavefrontResult {
  /** Unified foveated wavefront context (Foveal L1/L2 on winning pages + Peripheral L0 pulses on the rest + Global Frontier). */
  context: string;
  /** Pages selected for deep foveal inspection (`L1`/`L2`), ranked by epistemic resonance. */
  fovea: Array<{ url?: string; resonance: number; page: ContextResult }>;
  /** Remaining pages kept in peripheral vision as 1-line `L0` Holographic Pulses (~30 tokens each). */
  periphery: Array<{ url?: string; resonance: number; pulse: string }>;
  /** Deduped shadow APIs / machine twins discovered across all pages. */
  machineTwins: MachineTwin[];
  /** Global epistemic frontier: highest-scent unexplored next-hop links across all pages. */
  frontier: FrontierLink[];
  /** Estimated total tokens of `context`. */
  estimatedTokens: number;
}

export interface FieldConflict {
  field: string;
  values: Array<{
    value: string;
    sources: string[];
    verifiedInText: boolean;
    confidence: number;
  }>;
}

export interface FusedContextResult {
  /** Unified multi-page Markdown context (Consensus / Comparison Matrix + Conflicts + Deduplicated Cross-Page Prose). */
  context: string;
  /** Mode automatically chosen or requested (`'consensus'` for same-subject pages, `'comparison'` for distinct entities). */
  mode: 'consensus' | 'comparison';
  /** Bayesian consensus entity merged across pages ( weighted by `verifiedInText` provenance). */
  consensus?: JsonObject;
  /** Markdown comparison table aligning distinct entities side-by-side across pages. */
  comparisonTable?: string;
  /** Detected cross-page contradictions (e.g. different prices or dates across sources). */
  conflicts: FieldConflict[];
  /** Cross-page deduplicated prose passages with source citations `[1]`, `[2]`. */
  passages: Array<{ text: string; sources: string[] }>;
  /** Individual page context results. */
  pages: ContextResult[];
  /** Estimated total tokens of the fused `context`. */
  estimatedTokens: number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------------------
// 1. 64-Bit Locality-Sensitive SimHash & Hamming Distance
// ---------------------------------------------------------------------------

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(str: string): bigint {
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

/**
 * Computes a deterministic 64-bit locality-sensitive SimHash fingerprint
 * (16-character lowercase hex string) over word and character 3-gram shingles.
 * Near-identical pages or paragraphs produce fingerprints with a small Hamming
 * distance, enabling $O(1)$ semantic deduplication and change detection.
 */
export function simhash64(text: string): string {
  const norm = text.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();
  if (!norm) return '0000000000000000';

  const weights = new Int32Array(64);
  const words = norm.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.length < 2) continue;
    // Hash both individual words and adjacent word bigrams
    const token = i + 1 < words.length ? `${w} ${words[i + 1]!}` : w;
    const h = fnv1a64(token);
    for (let bit = 0; bit < 64; bit++) {
      if ((h >> BigInt(bit)) & 1n) weights[bit]! += 1;
      else weights[bit]! -= 1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit]! > 0) fingerprint |= 1n << BigInt(bit);
  }
  return fingerprint.toString(16).padStart(16, '0');
}

/**
 * Returns the Hamming distance (0 to 64 differing bits) between two 64-bit
 * SimHash hex fingerprints. A distance ≤ 10 indicates near-duplicate content.
 */
export function hammingDistance( hexA: string, hexB: string ): number {
  try {
    let xor = (BigInt(`0x${hexA}`) ^ BigInt(`0x${hexB}`)) & MASK_64;
    let dist = 0;
    while (xor > 0n) {
      xor &= xor - 1n;
      dist++;
    }
    return dist;
  } catch {
    return 64;
  }
}

// ---------------------------------------------------------------------------
// 2. Submodular Information Bottleneck (Query-Focused Projection & Scoring)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which', 'how', 'much', 'many', 'does', 'are', 'was', 'were',
  'con', 'per', 'che', 'del', 'della', 'dei', 'degli', 'delle', 'nel', 'nella', 'sul', 'sulla', 'sono', 'come', 'quanto', 'qual', 'quale',
  'les', 'des', 'est', 'dans', 'pour', 'avec', 'sur', 'que', 'qui', 'quel', 'quelle',
]);

/** Maps multilingual query concepts to Schema.org property names for zero-LLM intent projection. */
const INTENT_MAP: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\b(price|prezzo|prezzi|cost|costo|costa|combien|prix|eur|usd|euro|dollar|cheap|economico|buy|acquisto)\b/i, ['offers', 'price', 'priceCurrency', 'availability', 'sku']],
  [/\b(rating|voto|recensioni|review|reviews|stars|stelle|avis|score|punteggio|valutazione)\b/i, ['aggregateRating', 'ratingValue', 'reviewCount', 'bestRating', 'review']],
  [/\b(author|autore|who|chi|written|scritto|byline|journalist|giornalista|creator|publisher|editore)\b/i, ['author', 'creator', 'publisher', 'visibleByline']],
  [/\b(when|quando|date|data|published|pubblicato|modified|aggiornato|start|inizio|uscita)\b/i, ['datePublished', 'dateModified', 'startDate', 'endDate', 'uploadDate']],
  [/\b(time|tempo|minutes|minuti|hours|ore|cook|cottura|prep|preparazione|duration|durata)\b/i, ['cookTime', 'prepTime', 'totalTime', 'duration']],
  [/\b(yield|servings|porzioni|persone|dosi|makes|quantit)\b/i, ['recipeYield', 'nutrition', 'calories']],
  [/\b(ingredient|ingredienti|ingredients|ingrédients)\b/i, ['recipeIngredient']],
  [/\b(step|steps|instruction|istruzioni|procedimento|ricetta|prepare|preparare)\b/i, ['recipeInstructions']],
  [/\b(weight|peso|dimension|dimensioni|size|taglia|material|materiale|spec|specifiche|warranty|garanzia|waterproof|impermeabile)\b/i, ['weight', 'height', 'width', 'depth', 'material', 'color', 'brand', 'sku']],
];

interface QueryProfile {
  terms: string[];
  trigrams: Set<string>;
  boostedFields: Set<string>;
}

function buildQueryProfile(query: string): QueryProfile {
  const norm = query.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();
  const terms = norm.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  const trigrams = new Set<string>();
  for (const term of terms) {
    if (term.length < 3) {
      trigrams.add(term);
      continue;
    }
    for (let i = 0; i <= term.length - 3; i++) {
      trigrams.add(term.slice(i, i + 3));
    }
  }
  const boostedFields = new Set<string>(['type', 'name', 'headline', 'title']);
  for (const [pattern, fields] of INTENT_MAP) {
    if (pattern.test(query)) {
      for (const f of fields) boostedFields.add(f.toLowerCase());
    }
  }
  return { terms, trigrams, boostedFields };
}

function extractFeatures(text: string, profile: QueryProfile): Set<string> {
  const matched = new Set<string>();
  const norm = text.toLowerCase();
  for (const term of profile.terms) {
    if (norm.includes(term)) matched.add(`w:${term}`);
  }
  for (const tri of profile.trigrams) {
    if (norm.includes(tri)) matched.add(`g:${tri}`);
  }
  return matched;
}

/**
 * Projects a structured JSON entity down to its core identity (`type`, `name`,
 * `headline`) plus the properties with highest mutual information with `query`.
 */
function projectEntityForQuery(
  entity: JsonObject,
  profile: QueryProfile,
  tokenBudget?: number
): JsonObject {
  if (profile.terms.length === 0 && !tokenBudget) return entity;

  const projected: JsonObject = {};
  for (const coreKey of ['type', 'name', 'headline', 'url']) {
    if (Object.hasOwn(entity, coreKey)) projected[coreKey] = entity[coreKey]!;
  }

  const scoredKeys: Array<{ key: string; val: JsonValue; score: number; cost: number }> = [];
  for (const [key, rawVal] of Object.entries(entity)) {
    if (Object.hasOwn(projected, key) || rawVal === undefined) continue;
    const val: JsonValue =
      tokenBudget !== undefined && Array.isArray(rawVal) && rawVal.length > 3
        ? (rawVal.slice(0, 2) as JsonValue)
        : rawVal;
    const serialized = JSON.stringify(val);
    const features = extractFeatures(`${key} ${serialized}`, profile);
    const keyLower = key.toLowerCase();
    let score = features.size * 2;
    if (profile.boostedFields.has(keyLower)) score += 10;
    for (const term of profile.terms) {
      if (keyLower.includes(term)) score += 6;
    }
    if (profile.terms.length === 0 && ['offers', 'aggregaterating', 'brand', 'author', 'datepublished', 'sku', 'totaltime', 'recipeyield'].includes(keyLower)) {
      score += 8;
    }
    const cost = Math.max(1, Math.ceil((key.length + serialized.length) / 4));
    scoredKeys.push({ key, val, score, cost });
  }

  // Sort by relevance density (score / sqrt(cost))
  scoredKeys.sort((a, b) => b.score / Math.sqrt(b.cost) - a.score / Math.sqrt(a.cost));

  let usedTokens = Math.ceil(JSON.stringify(projected).length / 4);
  const entityCeiling = tokenBudget ? Math.max(25, Math.floor(tokenBudget * 0.5)) : Infinity;

  for (const item of scoredKeys) {
    // If a strict tokenBudget is active and this field has 0 query relevance, skip it
    if (tokenBudget !== undefined && item.score === 0 && Object.keys(projected).length >= 2) {
      continue;
    }
    if (usedTokens + item.cost > entityCeiling && Object.keys(projected).length >= 2) {
      continue;
    }
    projected[item.key] = item.val;
    usedTokens += item.cost;
  }

  return projected;
}

/**
 * Greedy Submodular Maximum Coverage under a Knapsack Token Budget:
 * selects prose segments that maximize coverage of uncovered query terms and
 * character 3-grams per token spent.
 */
function selectSubmodularSegments(
  segments: readonly string[],
  profile: QueryProfile,
  maxTokens: number
): string[] {
  if (maxTokens <= 0 || segments.length === 0) return [];
  if (profile.terms.length === 0) {
    const out: string[] = [];
    let tokens = 0;
    for (const seg of segments) {
      const cost = Math.ceil(seg.length / 4);
      if (tokens + cost > maxTokens) break;
      out.push(seg);
      tokens += cost;
    }
    return out;
  }

  const candidates = segments.map((seg, idx) => ({
    seg,
    idx,
    features: extractFeatures(seg, profile),
    cost: Math.max(1, Math.ceil(seg.length / 4)),
    picked: false,
  }));

  const covered = new Set<string>();
  const selectedIndices: number[] = [];
  let usedTokens = 0;

  while (usedTokens < maxTokens) {
    let best: (typeof candidates)[0] | undefined;
    let bestRatio = 0;

    for (const cand of candidates) {
      if (cand.picked) continue;
      if (usedTokens + cand.cost > maxTokens && usedTokens > 0) continue;
      let gain = 0;
      for (const feat of cand.features) {
        const weight = feat.startsWith('w:') ? 4.0 : 1.0;
        gain += covered.has(feat) ? weight * 0.15 : weight;
      }
      // Small position prior so lead summary sentences win ties
      if (cand.idx === 0) gain += 0.5;
      const ratio = gain / Math.pow(cand.cost + 4, 0.65);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = cand;
      }
    }

    if (!best || bestRatio <= 0) break;
    best.picked = true;
    selectedIndices.push(best.idx);
    usedTokens += best.cost;
    for (const feat of best.features) covered.add(feat);
  }

  // Preserve original document reading order among selected segments
  selectedIndices.sort((a, b) => a - b);
  return selectedIndices.map((i) => segments[i]!);
}

// ---------------------------------------------------------------------------
// 3. Technical Specs (<dl>/<table>), Hydration (__NEXT_DATA__) & Zero-DOM
// ---------------------------------------------------------------------------

/**
 * Extracts key-value technical specifications from `<dl><dt><dd>` and 2-column
 * `<table><tr><th>/<td>` elements in either a `Document` or raw HTML string.
 */
export function extractSpecs(source: Document | string): Record<string, string> {
  const specs: Record<string, string> = {};
  let count = 0;
  const add = (rawKey: string, rawVal: string): void => {
    if (count >= 40) return;
    const k = sanitizeText(rawKey, 80).replace(/[:：]+$/, '').trim();
    const v = sanitizeText(rawVal, 240).trim();
    if (!k || !v || k.length > 60 || UNSAFE_KEYS.has(k) || k === v) return;
    if (!Object.hasOwn(specs, k)) {
      specs[k] = v;
      count++;
    }
  };

  if (typeof source !== 'string') {
    for (const dl of source.querySelectorAll('dl')) {
      const children = dl.children;
      let currentDt = '';
      for (let i = 0; i < children.length; i++) {
        const el = children[i]!;
        const tag = el.tagName.toLowerCase();
        if (tag === 'dt') {
          currentDt = el.textContent ?? '';
        } else if (tag === 'dd' && currentDt) {
          add(currentDt, el.textContent ?? '');
          currentDt = '';
        }
      }
    }
    for (const tr of source.querySelectorAll('table tr')) {
      const cells = tr.querySelectorAll('th, td');
      if (cells.length === 2) {
        add(cells[0]!.textContent ?? '', cells[1]!.textContent ?? '');
      }
    }
    return specs;
  }

  const dtDdRe = /<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = dtDdRe.exec(source)) !== null && count < 40) {
    add(m[1] ?? '', m[2] ?? '');
  }

  const trRe = /<tr\b[^>]*>\s*<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>\s*<td\b[^>]*>([\s\S]*?)<\/td\s*>\s*<\/tr\s*>/gi;
  while ((m = trRe.exec(source)) !== null && count < 40) {
    add(m[1] ?? '', m[2] ?? '');
  }
  return specs;
}

const HYDRATION_FIELDS = new Set([
  'name',
  'title',
  'headline',
  'description',
  'price',
  'currency',
  'priceCurrency',
  'sku',
  'brand',
  'author',
  'publishedAt',
  'datePublished',
  'dateModified',
  'ratingValue',
  'reviewCount',
  'availability',
  'category',
]);

/**
 * Extracts structured fields from Next.js (`__NEXT_DATA__`) or generic SSR JSON
 * hydration script blocks when a modern web app omits Schema.org markup.
 */
export function extractHydrationData(source: Document | string): JsonObject | undefined {
  let rawJson = '';
  if (typeof source !== 'string') {
    const el =
      source.querySelector('script#__NEXT_DATA__') ??
      source.querySelector('script#__NUXT_DATA__');
    rawJson = el?.textContent?.trim() ?? '';
  } else {
    const match = /<script\b[^>]*\bid\s*=\s*["'](?:__NEXT_DATA__|__NUXT_DATA__)["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(
      source
    );
    rawJson = match?.[1]?.trim() ?? '';
  }
  if (!rawJson) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return undefined;
  }

  const found: JsonObject = {};
  let fieldCount = 0;

  const walk = (node: unknown, depth: number): void => {
    if (depth > 7 || fieldCount >= 24 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 5); i++) walk(node[i], depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (UNSAFE_KEYS.has(key)) continue;
      const val = record[key];
      if (
        HYDRATION_FIELDS.has(key) &&
        (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
      ) {
        const cleanVal = typeof val === 'string' ? sanitizeText(val, 400) : val;
        if (cleanVal !== '' && !Object.hasOwn(found, key)) {
          found[key] = cleanVal;
          fieldCount++;
        }
      } else if (val && typeof val === 'object') {
        walk(val, depth + 1);
      }
    }
  };

  const root =
    parsed && typeof parsed === 'object' && 'props' in (parsed as Record<string, unknown>)
      ? (parsed as Record<string, unknown>)['props']
      : parsed;
  walk(root, 0);

  return fieldCount > 0 ? found : undefined;
}

/**
 * Extracts Microdata (`itemscope`/`itemprop`) and RDFa (`typeof`/`property`)
 * directly from an HTML string without constructing a DOM tree.
 */
export function extractZeroDomNodes(html: string): RawNode[] {
  const nodes: RawNode[] = [];
  const scopeRe =
    /<([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*?\b(?:itemscope\b|typeof\s*=\s*["'][^"']+["'])[^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scopeRe.exec(html)) !== null) {
    const attrs = match[2] ?? '';
    const inner = match[3] ?? '';
    const isMicrodata = /\bitemscope\b/i.test(attrs);
    const itemtypeMatch = /\bitemtype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const typeofMatch = /\btypeof\s*=\s*["']([^"']+)["']/i.exec(attrs);

    const rawType = itemtypeMatch?.[1] ?? typeofMatch?.[1] ?? 'Thing';
    if (!isMicrodata && /^(?:mw|dc|foaf|og|fb|twitter):/i.test(rawType.trim())) continue;

    const item: JsonObject = {
      '@context': 'https://schema.org',
      '@type': rawType.trim().split(/\s+/),
    };

    const propRe =
      /<([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*?\b(?:itemprop|property)\s*=\s*["']([^"']+)["'][^>]*)(?:\/>|>(?:([\s\S]*?)<\/\1\s*>)?)/gi;
    let pm: RegExpExecArray | null;
    let propCount = 0;
    while ((pm = propRe.exec(inner)) !== null) {
      const propAttrs = pm[2] ?? '';
      const propName = (pm[3] ?? '').trim();
      if (!propName || UNSAFE_KEYS.has(propName) || /^(?:mw|dc|foaf|og):/i.test(propName)) continue;
      const contentAttr =
        /\bcontent\s*=\s*["']([^"']*)["']/i.exec(propAttrs)?.[1] ??
        /\bdatetime\s*=\s*["']([^"']*)["']/i.exec(propAttrs)?.[1] ??
        /\bhref\s*=\s*["']([^"']*)["']/i.exec(propAttrs)?.[1];
      const val = sanitizeText(contentAttr ?? pm[4] ?? '', 500);
      if (!val) continue;
      propCount++;
      const existing = Object.hasOwn(item, propName) ? item[propName] : undefined;
      item[propName] =
        existing === undefined ? val : Array.isArray(existing) ? [...existing, val] : [existing, val];
    }

    if (propCount > 0 || itemtypeMatch || typeofMatch) {
      nodes.push({ format: isMicrodata ? 'microdata' : 'rdfa', data: item });
    }
  }
  return nodes;
}

function collectStrings(value: JsonValue | undefined, out: Set<string>): void {
  if (!value) return;
  if (typeof value === 'string') {
    const norm = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm.length >= 25) out.add(norm);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'type' || k === 'id') continue;
      collectStrings(v, out);
    }
  }
}

function extractRawProseSegments(source: Document | string): {
  fullText: string;
  segments: string[];
} {
  if (typeof source !== 'string') {
    const root = (source.body ?? source.documentElement)?.cloneNode(true) as Element | undefined;
    if (!root) return { fullText: '', segments: [] };
    for (const el of root.querySelectorAll(
      'script, style, noscript, template, svg, nav, footer, aside, [aria-hidden="true"]'
    )) {
      el.remove();
    }
    const fullText = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
    const blocks = root.querySelectorAll('h1, h2, h3, p, li, blockquote, article');
    const segments: string[] = [];
    if (blocks.length > 0) {
      for (const b of blocks) {
        const text = sanitizeText(b.textContent ?? '', 600);
        if (!text || text.length < 15) continue;
        const tag = b.tagName.toLowerCase();
        const formatted =
          tag === 'h1'
            ? `# ${text}`
            : tag === 'h2'
              ? `## ${text}`
              : tag === 'h3'
                ? `### ${text}`
                : text;
        if (segments[segments.length - 1] !== formatted) segments.push(formatted);
      }
    } else if (fullText) {
      segments.push(sanitizeText(fullText, 4000));
    }
    return { fullText, segments };
  }

  const cleaned = source
    .replace(/<(script|style|noscript|template|svg|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const fullText = sanitizeText(cleaned, 100_000);
  const rawChunks = cleaned.split(/<\/(?:p|h[1-6]|li|div|article|section|blockquote)\s*>/i);
  const segments: string[] = [];
  for (const chunk of rawChunks) {
    const headingMatch = /<h([1-3])\b[^>]*>([\s\S]*?)$/i.exec(chunk);
    const text = sanitizeText(headingMatch ? headingMatch[2] ?? '' : chunk, 600);
    if (!text || text.length < 15) continue;
    const prefix = headingMatch ? `${'#'.repeat(Number(headingMatch[1]))} ` : '';
    const line = `${prefix}${text}`;
    if (segments[segments.length - 1] !== line) segments.push(line);
  }
  if (segments.length === 0 && fullText) segments.push(fullText.slice(0, 4000));
  return { fullText, segments };
}

const BYLINE_RE =
  /\b(?:by|par|di|von|por)\s+([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})\b/;
const WIRE_AGENCIES = /\b(AFP|Reuters|Associated Press|AP|Bloomberg|EFE|ANSA|dpa)\b/;

function verifyClaimsAndByline(
  primary: JsonObject | undefined,
  fullText: string,
  primarySyntax?: 'jsonld' | 'microdata' | 'rdfa'
): {
  provenance: FieldProvenance[];
  discrepancies: string[];
  visibleByline?: string;
} {
  const provenance: FieldProvenance[] = [];
  const discrepancies: string[] = [];
  const normText = fullText.toLowerCase().replace(/\s+/g, ' ');

  const leadText = fullText.slice(0, 1200);
  const wireMatch = WIRE_AGENCIES.exec(leadText);
  const bylineMatch = BYLINE_RE.exec(leadText);
  const visibleByline = wireMatch?.[1] ?? bylineMatch?.[1]?.trim();

  if (!primary) {
    return {
      provenance,
      discrepancies,
      ...(visibleByline ? { visibleByline } : {}),
    };
  }

  const checkScalar = (field: string, raw: unknown): void => {
    if (raw === undefined || raw === null) return;
    let str = '';
    if (typeof raw === 'string' || typeof raw === 'number') {
      str = String(raw).trim();
    } else if (Array.isArray(raw)) {
      checkScalar(field, raw[0]);
      return;
    } else if (typeof raw === 'object') {
      const obj = raw as JsonObject;
      if (typeof obj['name'] === 'string') str = obj['name'];
      else if (typeof obj['price'] === 'string' || typeof obj['price'] === 'number')
        str = String(obj['price']);
      else if (typeof obj['ratingValue'] === 'string' || typeof obj['ratingValue'] === 'number')
        str = String(obj['ratingValue']);
    }
    if (!str || str.length > 200) return;

    const normVal = str.toLowerCase().replace(/\s+/g, ' ');
    const altDecimal = /^\d+\.\d+$/.test(normVal) ? normVal.replace('.', ',') : normVal;
    const verifiedInText =
      normText.length > 0 && (normText.includes(normVal) || normText.includes(altDecimal));

    provenance.push({
      field,
      value: str,
      ...(primarySyntax ? { syntax: primarySyntax } : {}),
      verifiedInText,
    });

    if (field === 'author' && visibleByline && !str.toLowerCase().includes(visibleByline.toLowerCase())) {
      discrepancies.push(
        `Author mismatch: structured markup declares "${str}", while visible page text credits "${visibleByline}".`
      );
    } else if ((field === 'offers.price' || field === 'price') && !verifiedInText && normText.length > 50) {
      discrepancies.push(
        `Unverified price: structured markup declares "${str}", which was not found verbatim in the visible page text.`
      );
    }
  };

  for (const key of ['name', 'headline', 'author', 'sku', 'recipeYield', 'datePublished']) {
    if (Object.hasOwn(primary, key)) checkScalar(key, primary[key]);
  }
  if (Object.hasOwn(primary, 'offers')) checkScalar('offers.price', primary['offers']);
  if (Object.hasOwn(primary, 'aggregateRating'))
    checkScalar('aggregateRating.ratingValue', primary['aggregateRating']);

  return {
    provenance,
    discrepancies,
    ...(visibleByline ? { visibleByline } : {}),
  };
}

// ---------------------------------------------------------------------------
// 3b. AI-Native Epistemic Surprisal, Temporal Cone, Machine Twins & Foraging
// ---------------------------------------------------------------------------

const RHETORICAL_SCAFFOLDING_RE =
  /^(?:furthermore|moreover|in addition|additionally|it is (?:important|worth) (?:to note|noting) that|in this (?:article|section|review|guide)[^,]*,|as a result|consequently|in conclusion|inoltre|pertanto|va (?:notato|sottolineato) che|in questo articolo[^,]*,|come abbiamo visto)\s*,?\s*/i;

const METRIC_UNIT_RE =
  /\b\d+(?:[.,]\d+)?\s*(?:%|kg|g|mg|lb|oz|km|m|cm|mm|nm|l|ml|gb|tb|mb|kb|ghz|mhz|w|kw|wh|mah|v|fps|ms|s|sec|min|h|hr|hrs|hours?|days?|months?|years?|giorni|mesi|anni|ore|€|\$|£|¥|usd|eur|gbp|chf|°c|°f|k)\b/i;

const CONSTRAINT_NEGATION_RE =
  /\b(?:not|never|no longer|only|except|requires?|mandatory|prohibited|incompatible|deprecated|recalled|warning|caution|warranty|guarantee|limit|max|min|non|mai|solo|eccetto|richiede|obbligatorio|vietato|incompatibile|garanzia|limite|massimo|minimo)\b/i;

const TEMPORAL_MARKER_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|\b(?:19|20)\d{2}\b|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i;

const DEICTIC_TIME_RE =
  /\b(?:currently|presently|today|right now|this year|this month|recently|latest|new|in stock|attualmente|oggi|quest'anno|questo mese|recentemente|ultimo|disponibile)\b/i;

/**
 * Surprisal-Driven Epistemic Distillation:
 * Strips zero-surprise rhetorical scaffolding (narrative filler that an LLM
 * already has in its weights and that dilutes Transformer self-attention) and
 * isolates high-surprisal propositions containing non-parametric facts:
 * exact quantities/units, hard constraints/negations, temporal anchors, and
 * query-aligned claims.
 */
export function extractEpistemicAtoms(
  segments: readonly string[],
  query?: string,
  maxAtoms = 8
): EpistemicAtom[] {
  const profile = query ? buildQueryProfile(query) : undefined;
  const atoms: EpistemicAtom[] = [];
  const seen = new Set<string>();

  for (const seg of segments) {
    if (seg.startsWith('#')) continue;
    const cleaned = seg
      .replace(/^[-*]\s+/, '')
      .replace(RHETORICAL_SCAFFOLDING_RE, '')
      .trim();
    if (cleaned.length < 18) continue;

    const norm = cleaned.toLowerCase();
    if (seen.has(norm)) continue;

    let bits = 0;
    let kind: EpistemicAtom['kind'] = 'fact';

    const metricMatches = cleaned.match(new RegExp(METRIC_UNIT_RE.source, 'gi'));
    if (metricMatches) {
      bits += metricMatches.length * 4.5;
      kind = 'metric';
    } else if (/\b\d+(?:[.,]\d+)?\b/.test(cleaned)) {
      bits += 2.2;
    }

    if (CONSTRAINT_NEGATION_RE.test(cleaned)) {
      bits += 3.8;
      if (kind === 'fact') kind = 'constraint';
    }

    if (TEMPORAL_MARKER_RE.test(cleaned)) {
      bits += 2.5;
      if (kind === 'fact') kind = 'temporal';
    }

    if (profile && profile.terms.length > 0) {
      const feats = extractFeatures(cleaned, profile);
      bits += feats.size * 3.0;
    }

    const tokenCost = Math.max(4, Math.ceil(cleaned.length / 4));
    const surprisal = Number((bits / Math.pow(tokenCost, 0.55)).toFixed(2));
    if (surprisal < 0.75) continue;

    seen.add(norm);
    atoms.push({
      claim: cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned,
      surprisal,
      kind,
    });
  }

  atoms.sort((a, b) => b.surprisal - a.surprisal);
  return atoms.slice(0, maxAtoms);
}

function findDateField(obj: unknown, keys: readonly string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const val = rec[k];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  for (const v of Object.values(rec)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const nested = findDateField(item, keys);
        if (nested) return nested;
      }
    } else if (v && typeof v === 'object') {
      const nested = findDateField(v, keys);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Computes the Relativistic Temporal Light-Cone of a page:
 * extracts publication/modification/expiration timestamps, calculates document
 * age, detects expired commercial offers (`priceValidUntil < now`), and anchors
 * indexical time words ("currently", "this year", "latest") so the LLM never
 * mistakes stale historical claims for present-day truth.
 */
export function computeTemporalCone(
  primary: JsonObject | undefined,
  meta: PageMeta,
  rawHtmlOrText: string,
  referenceNow: number | string = Date.now()
): TemporalCone {
  const nowMs =
    typeof referenceNow === 'number' ? referenceNow : Date.parse(referenceNow) || Date.now();

  const publishedAt =
    findDateField(primary, ['datePublished', 'dateCreated', 'uploadDate', 'startDate']) ??
    meta.openGraph['article:published_time'] ??
    meta.openGraph['og:updated_time'] ??
    rawHtmlOrText.match(/<time[^>]+datetime=["']([^"']{10,30})["']/i)?.[1];

  const modifiedAt =
    findDateField(primary, ['dateModified']) ?? meta.openGraph['article:modified_time'];

  const validThrough = findDateField(primary, ['priceValidUntil', 'validThrough', 'expires', 'endDate']);

  const refDateStr = modifiedAt ?? publishedAt;
  let ageDays: number | undefined;
  if (refDateStr) {
    const parsed = Date.parse(refDateStr);
    if (!Number.isNaN(parsed) && nowMs >= parsed) {
      ageDays = Math.floor((nowMs - parsed) / 86_400_000);
    }
  }

  let isExpiredOffer = false;
  if (validThrough) {
    const validMs = Date.parse(validThrough);
    if (!Number.isNaN(validMs) && validMs < nowMs) {
      isExpiredOffer = true;
    }
  }

  const hasUnanchoredDeictics = DEICTIC_TIME_RE.test(rawHtmlOrText);
  const warnings: string[] = [];

  if (isExpiredOffer && validThrough) {
    warnings.push(`Offer/validity expired on ${validThrough.slice(0, 10)} (in the past light-cone).`);
  }
  if (ageDays !== undefined && ageDays > 180 && hasUnanchoredDeictics && refDateStr) {
    const anchorDate = refDateStr.slice(0, 10);
    warnings.push(
      `Document reference frame is ${anchorDate} (${ageDays} days old); indexical claims ("currently", "this year", "latest") refer to ${anchorDate.slice(0, 4)}, not present day.`
    );
  }

  return {
    ...(publishedAt ? { publishedAt } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(validThrough ? { validThrough } : {}),
    ...(ageDays !== undefined ? { ageDays } : {}),
    isExpiredOffer,
    hasUnanchoredDeictics,
    ...(warnings.length > 0 ? { anchorWarning: warnings.join(' ') } : {}),
  };
}

function resolveHref(href: string, baseUrl?: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed || /^(?:javascript:|mailto:|tel:|data:|#)/i.test(trimmed)) return undefined;
  try {
    if (baseUrl) return new URL(trimmed, baseUrl).href;
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Shadow API & Machine-Twin Autodiscovery:
 * Inspects a page for native machine-readable twins embedded alongside HTML —
 * such as WordPress REST API (`application/json`), `/llms.txt`, Next.js SSR
 * data routes (`/_next/data/<buildId>/...json`), Shopify product `.json` twins,
 * RSS/Atom feeds, or inline `/api/` & `/graphql` endpoints.
 */
export function discoverMachineTwins(
  source: Document | string,
  baseUrl?: string
): MachineTwin[] {
  const html =
    typeof source === 'string'
      ? source
      : (source.documentElement?.outerHTML ?? source.body?.innerHTML ?? '');

  const twins: MachineTwin[] = [];
  const seen = new Set<string>();
  const addTwin = (url: string | undefined, kind: MachineTwin['kind'], description: string) => {
    const resolved = url ? resolveHref(url, baseUrl) : undefined;
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    twins.push({ url: resolved, kind, description });
  };

  // 1. <link rel="alternate" type="application/json|text/markdown|application/rss+xml..." href="...">
  const linkRe = /<link\b([^>]+)>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const attrs = linkMatch[1]!;
    const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;

    if (
      rel.includes('alternate') &&
      (type.includes('application/json') || type.includes('application/activity+json'))
    ) {
      addTwin(href, 'json-api', `Native JSON twin (${type})`);
    } else if (type.includes('text/markdown') || href.endsWith('/llms.txt') || href.endsWith('/llms-full.txt')) {
      addTwin(href, 'llms-txt', 'LLM-optimized Markdown twin');
    } else if (
      rel.includes('alternate') &&
      (type.includes('rss+xml') || type.includes('atom+xml') || type.includes('feed+json'))
    ) {
      addTwin(href, 'feed', `Syndication feed (${type})`);
    }
  }

  // 2. Next.js SSR data route from __NEXT_DATA__
  const nextMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextMatch?.[1]) {
    try {
      const parsed = JSON.parse(nextMatch[1].trim()) as Record<string, unknown>;
      const buildId = typeof parsed['buildId'] === 'string' ? parsed['buildId'] : undefined;
      const pagePath = typeof parsed['page'] === 'string' ? parsed['page'] : undefined;
      if (buildId && pagePath) {
        const cleanPage = pagePath === '/' ? '/index' : pagePath;
        addTwin(
          `/_next/data/${buildId}${cleanPage}.json`,
          'nextjs-data',
          'Next.js SSR JSON route'
        );
      }
    } catch {
      // Ignore malformed __NEXT_DATA__
    }
  }

  // 3. Shopify / e-commerce canonical product `.json` twin
  if (
    baseUrl &&
    /\/products\/[a-z0-9-_]+\/?$/i.test(baseUrl) &&
    (html.includes('Shopify.') || /property=["']og:type["'][^>]+content=["']product["']/i.test(html))
  ) {
    const cleanUrl = baseUrl.replace(/\/$/, '');
    addTwin(`${cleanUrl}.json`, 'json-api', 'Canonical product JSON endpoint');
  }

  // 4. Inline /llms.txt or /api/v... or /graphql endpoints in HTML
  const apiRe = /["']((?:https?:\/\/[^"'/\s]+)?\/(?:api\/v\d+\/[a-z0-9/_-]+|graphql|llms(?:-full)?\.txt))["']/gi;
  let apiMatch: RegExpExecArray | null;
  while ((apiMatch = apiRe.exec(html)) !== null) {
    const rawPath = apiMatch[1]!;
    if (rawPath.endsWith('.txt')) {
      addTwin(rawPath, 'llms-txt', 'Site /llms.txt index');
    } else if (rawPath.endsWith('/graphql')) {
      addTwin(rawPath, 'graphql', 'GraphQL API endpoint');
    } else {
      addTwin(rawPath, 'json-api', 'Discovered REST API endpoint');
    }
  }

  return twins.slice(0, 6);
}

const LOW_SCENT_HREF_RE =
  /\/(?:login|signin|signup|register|logout|cart|checkout|privacy|terms|cookie|account|password|wishlist|share|intent\/tweet|sharer\.php)\b/i;

const HIGH_SCENT_PATH_RE =
  /\.(?:pdf|json|csv|xml)$|\/(?:specs?|specifications?|datasheet|technical|pricing|plans|api|docs|documentation|benchmark|study|paper|research|whitepaper|changelog|release-notes|download)\b/i;

/**
 * Epistemic Frontier & Information Foraging (Pirolli-Card):
 * Evaluates links on the page to identify the highest-Information-Scent next
 * hops that answer what the current page leaves unresolved (e.g. datasheets,
 * PDFs, primary studies, pricing tables, API docs, or query-matching deep links),
 * while stripping zero-scent navigation chrome.
 */
export function extractEpistemicFrontier(
  source: Document | string,
  baseUrl?: string,
  query?: string,
  maxLinks = 5
): FrontierLink[] {
  const html =
    typeof source === 'string'
      ? source
      : (source.documentElement?.outerHTML ?? source.body?.innerHTML ?? '');
  const profile = query ? buildQueryProfile(query) : undefined;

  const stripped = html
    .replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  const linkRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const candidates = new Map<string, FrontierLink>();
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(stripped)) !== null) {
    const rawHref = match[1]!;
    const resolved = resolveHref(rawHref, baseUrl);
    if (!resolved || resolved === baseUrl || LOW_SCENT_HREF_RE.test(resolved)) continue;

    const anchor = sanitizeText(match[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (anchor.length < 3 || anchor.length > 120) continue;
    if (/^(?:read more|learn more|click here|home|menu|close|next|prev|back|scopri di più|clicca qui)$/i.test(anchor)) {
      continue;
    }

    let scent = 0;
    const reasons: string[] = [];

    if (HIGH_SCENT_PATH_RE.test(resolved) || HIGH_SCENT_PATH_RE.test(anchor)) {
      scent += 4.5;
      reasons.push('deep-evidence');
    }

    if (/\b(?:arxiv\.org|doi\.org|github\.com|wikipedia\.org|pubmed|\.gov\b|\.edu\b)/i.test(resolved)) {
      scent += 3.5;
      reasons.push('primary-source');
    }

    if (profile && profile.terms.length > 0) {
      const feats = extractFeatures(`${anchor} ${resolved}`, profile);
      if (feats.size > 0) {
        scent += feats.size * 3.0;
        reasons.push('query-match');
      }
    } else {
      // Without a query, boost links with specific technical/factual anchors
      if (METRIC_UNIT_RE.test(anchor) || /\b(?:spec|datasheet|price|api|pdf|guide|manual|report|data)\b/i.test(anchor)) {
        scent += 2.5;
        reasons.push('factual-anchor');
      }
    }

    if (scent <= 0) continue;
    const existing = candidates.get(resolved);
    if (!existing || scent > existing.scent) {
      candidates.set(resolved, {
        url: resolved,
        anchor,
        scent: Number(scent.toFixed(2)),
        reason: reasons.join('+') || 'relevant-hop',
      });
    }
  }

  return [...candidates.values()].sort((a, b) => b.scent - a.scent).slice(0, maxLinks);
}

/**
 * Synthesizes the ~35-token `L0` Holographic Pulse ("Semantic DNA strand") of a page.
 */
function buildHolographicPulse(
  title: string,
  primary: JsonObject | undefined,
  specs: Record<string, string>,
  atoms: readonly EpistemicAtom[],
  temporal: TemporalCone,
  machineTwins: readonly MachineTwin[],
  discrepancies: readonly string[]
): string {
  const type = String(primary?.['type'] ?? 'Page');
  const parts: string[] = [`[L0 ${type}] ${title}`];

  // Key scalar invariants from primary entity or specs
  const invariants: string[] = [];
  const price = scalarOf(primary?.['offers']);
  if (price) invariants.push(`price=${price}`);
  const rating = scalarOf(primary?.['aggregateRating']);
  if (rating) invariants.push(`rating=${rating}`);
  for (const k of ['sku', 'brand', 'author', 'totalTime', 'recipeYield']) {
    const v = scalarOf(primary?.[k]);
    if (v && invariants.length < 4) invariants.push(`${k}=${v}`);
  }
  for (const [k, v] of Object.entries(specs)) {
    if (invariants.length >= 4) break;
    invariants.push(`${k}=${v}`);
  }
  if (invariants.length > 0) parts.push(invariants.join(', '));

  const refDate = (temporal.modifiedAt ?? temporal.publishedAt)?.slice(0, 10);
  if (temporal.isExpiredOffer) {
    parts.push('⚠️EXPIRED_OFFER');
  } else if (refDate) {
    parts.push(`t=${refDate}`);
  }

  if (discrepancies.length > 0) {
    parts.push(`⚠️${discrepancies.length}_DISCREPANCY`);
  }

  if (atoms.length > 0) {
    parts.push(
      `atoms: ${atoms
        .slice(0, 2)
        .map((a) => a.claim.slice(0, 75))
        .join(' ; ')}`
    );
  }

  if (machineTwins.length > 0) {
    parts.push(`twin=${machineTwins[0]!.url}`);
  }

  return parts.join(' | ');
}

/**
 * Generates a Zero-Turn Hybrid Context for LLM Live Search (`WebFetch`,
 * `OAI-SearchBot`, Perplexity, RAG).
 *
 * Supports Holographic Multi-Resolution (`resolution: 'L0' | 'L1' | 'L2'`),
 * Submodular Information Bottleneck (`query` + `tokenBudget`), Surprisal-Distilled
 * Epistemic Atoms (`atoms`), Relativistic Temporal Light-Cone (`temporal`),
 * Shadow API Autodiscovery (`machineTwins`), and Information Foraging (`frontier`).
 */
export function toContext(source: Document | string, options: ContextOptions = {}): ContextResult {
  const maxProseChars = options.maxProseChars ?? 4000;
  const format = options.format ?? 'markdown';
  const resolution = options.resolution ?? 'L2';
  const queryProfile = options.query ? buildQueryProfile(options.query) : undefined;
  const rawHtml =
    typeof source === 'string'
      ? source
      : (source.documentElement?.outerHTML ?? source.body?.innerHTML ?? '');

  const scraped = scrape(source, { fallback: true, ...options });
  const allSpecs = extractSpecs(source);
  const hydration = extractHydrationData(source);

  let fullPrimary = scraped.primary;
  const entities = [...scraped.entities];
  if (!fullPrimary && typeof source === 'string') {
    const zeroDom = extractZeroDomNodes(source);
    if (zeroDom.length > 0) {
      const rescraped = scrape(
        source +
          zeroDom
            .map((n) => `<script type="application/ld+json">${JSON.stringify(n.data)}</script>`)
            .join(''),
        { fallback: true, ...options }
      );
      fullPrimary = rescraped.primary;
      entities.splice(0, entities.length, ...rescraped.entities);
    }
  }

  if (!fullPrimary && hydration) {
    fullPrimary = { type: 'Thing', ...hydration };
    entities.push(fullPrimary);
  }

  const { fullText, segments } = extractRawProseSegments(source);
  const { provenance, discrepancies, visibleByline } = verifyClaimsAndByline(fullPrimary, fullText);

  // Deduplicate prose segments against strings already present in full structured entities
  const structuredStrings = new Set<string>();
  collectStrings(fullPrimary, structuredStrings);
  for (const entity of entities) collectStrings(entity, structuredStrings);

  const dedupedSegments: string[] = [];
  const seenSegments = new Set<string>();

  for (const seg of segments) {
    const norm = seg.replace(/^#+\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenSegments.has(norm)) continue;
    let alreadyInSchema = false;
    for (const s of structuredStrings) {
      if (s.includes(norm) || (norm.length > 40 && norm.includes(s))) {
        alreadyInSchema = true;
        break;
      }
    }
    if (alreadyInSchema) continue;
    seenSegments.add(norm);
    dedupedSegments.push(seg);
  }

  // AI-Native Epistemic Layers: Surprisal Atoms, Temporal Cone, Machine Twins, Frontier
  const atoms = extractEpistemicAtoms(dedupedSegments, options.query);
  const canonicalOrBase = scraped.meta.canonical ?? options.baseUrl;
  const temporal = computeTemporalCone(fullPrimary, scraped.meta, `${rawHtml}\n${fullText}`, options.referenceNow);
  const machineTwins = discoverMachineTwins(source, canonicalOrBase);
  const frontier = extractEpistemicFrontier(source, canonicalOrBase, options.query);

  const effectiveBudget =
    options.tokenBudget ?? (resolution === 'L1' ? 240 : undefined);

  // Apply Query-Focused Information Bottleneck if `query`, `tokenBudget`, or `L1` resolution is active
  const primary =
    fullPrimary && (queryProfile || effectiveBudget !== undefined)
      ? projectEntityForQuery(
          fullPrimary,
          queryProfile ?? { terms: [], trigrams: new Set(), boostedFields: new Set(['type', 'name', 'headline']) },
          effectiveBudget
        )
      : fullPrimary;

  // Filter specs by query relevance & token ceiling when a budget or L1 resolution is active
  let specs = allSpecs;
  if (effectiveBudget !== undefined) {
    const specCeiling = Math.max(25, Math.floor(effectiveBudget * 0.35));
    let specTokens = 0;
    const filteredSpecs: Record<string, string> = {};
    const entries = Object.entries(allSpecs);
    for (const [k, v] of entries) {
      const cost = Math.ceil((k.length + v.length + 6) / 4);
      if (specTokens + cost > specCeiling) continue;
      if (queryProfile && queryProfile.terms.length > 0) {
        const feats = extractFeatures(`${k} ${v}`, queryProfile);
        if (feats.size > 0 || queryProfile.boostedFields.has(k.toLowerCase())) {
          filteredSpecs[k] = v;
          specTokens += cost;
        }
      } else {
        filteredSpecs[k] = v;
        specTokens += cost;
      }
    }
    specs = filteredSpecs;
  }

  // Determine remaining token budget for prose
  const structuredTokensUsed = Math.ceil(
    (JSON.stringify(primary ?? {}).length + JSON.stringify(specs).length) / 4
  );
  const proseTokenCap =
    options.tokenBudget !== undefined
      ? Math.max(25, options.tokenBudget - structuredTokensUsed)
      : Math.ceil(maxProseChars / 4);

  const selectedSegments = queryProfile
    ? selectSubmodularSegments(dedupedSegments, queryProfile, proseTokenCap)
    : selectSubmodularSegments(
        dedupedSegments,
        { terms: [], trigrams: new Set(), boostedFields: new Set() },
        proseTokenCap
      );

  const prose =
    resolution === 'L0' || resolution === 'L1'
      ? ''
      : selectedSegments.join('\n').slice(0, maxProseChars);

  const title =
    (typeof primary?.['name'] === 'string' ? primary['name'] : undefined) ??
    (typeof primary?.['headline'] === 'string' ? primary['headline'] : undefined) ??
    scraped.meta.title ??
    'Page Context';

  const pulse = buildHolographicPulse(
    title,
    primary ?? fullPrimary,
    specs,
    atoms,
    temporal,
    machineTwins,
    discrepancies
  );

  let context: string;
  if (resolution === 'L0') {
    context = format === 'json' ? JSON.stringify({ pulse, ...(scraped.meta.canonical ? { url: scraped.meta.canonical } : {}) }) : pulse;
  } else if (format === 'json') {
    context = JSON.stringify({
      title,
      ...(scraped.meta.canonical ? { url: scraped.meta.canonical } : {}),
      ...(temporal.anchorWarning ? { temporalWarning: temporal.anchorWarning } : {}),
      ...(primary ? { primary } : {}),
      ...(Object.keys(specs).length > 0 ? { specs } : {}),
      ...(hydration && !primary ? { hydration } : {}),
      ...(atoms.length > 0 ? { atoms } : {}),
      ...(machineTwins.length > 0 ? { machineTwins } : {}),
      ...(frontier.length > 0 ? { frontier } : {}),
      ...(visibleByline ? { visibleByline } : {}),
      ...(discrepancies.length > 0 ? { discrepancies } : {}),
      ...(scraped.actions.length > 0 ? { actions: scraped.actions } : {}),
      ...(prose ? { prose } : {}),
    });
  } else {
    const sections: string[] = [`# ${title}`];
    if (scraped.meta.canonical) sections.push(`URL: ${scraped.meta.canonical}`);
    if (visibleByline) sections.push(`Visible Byline: ${visibleByline}`);
    if (temporal.anchorWarning) {
      sections.push(`⏱️ Temporal Frame: ${temporal.anchorWarning}`);
    }
    if (discrepancies.length > 0) {
      sections.push(`## Discrepancy Warnings\n${discrepancies.map((d) => `- ${d}`).join('\n')}`);
    }
    if (primary) {
      sections.push(
        `## Structured Facts (${String(primary['type'] ?? 'Thing')})\n\`\`\`json\n${JSON.stringify(primary)}\n\`\`\``
      );
    }
    if (entities.length > 1 && options.tokenBudget === undefined && resolution === 'L2') {
      const secondary = entities.filter((e) => e !== fullPrimary).slice(0, 10);
      if (secondary.length > 0) {
        sections.push(`## Additional Entities\n\`\`\`json\n${JSON.stringify(secondary)}\n\`\`\``);
      }
    }
    if (Object.keys(specs).length > 0) {
      sections.push(`## Technical Specifications\n\`\`\`json\n${JSON.stringify(specs)}\n\`\`\``);
    }
    if (resolution === 'L1' && atoms.length > 0) {
      sections.push(
        `## Epistemic Atoms (High-Surprisal Claims)\n${atoms
          .map((a) => `- [${a.kind}, s=${a.surprisal}] ${a.claim}`)
          .join('\n')}`
      );
    }
    if (machineTwins.length > 0 && (resolution === 'L1' || options.tokenBudget === undefined)) {
      sections.push(
        `## Machine Twins & Shadow APIs\n${machineTwins
          .map((t) => `- [${t.kind}] ${t.url} — ${t.description}`)
          .join('\n')}`
      );
    }
    if (frontier.length > 0 && resolution === 'L1') {
      sections.push(
        `## Epistemic Frontier (Next Hops)\n${frontier
          .map((f) => `- [scent=${f.scent}, ${f.reason}] [${f.anchor}](${f.url})`)
          .join('\n')}`
      );
    }
    if (scraped.actions.length > 0 && options.tokenBudget === undefined && resolution === 'L2') {
      sections.push(
        `## Available Site Actions\n${scraped.actions
          .map((a) => `- \`${a.name}(${a.parameters.join(', ')})\`: ${a.description}`)
          .join('\n')}`
      );
    }
    if (prose) {
      sections.push(`## Main Content (Deduplicated)\n${prose}`);
    }
    context = sections.join('\n\n');
  }

  const fingerprint = simhash64(`${JSON.stringify(fullPrimary ?? {})} ${JSON.stringify(allSpecs)} ${prose || atoms.map((a) => a.claim).join(' ')}`);

  return {
    context,
    pulse,
    ...(primary ? { primary } : {}),
    entities,
    specs,
    ...(hydration ? { hydration } : {}),
    atoms,
    temporal,
    machineTwins,
    frontier,
    meta: scraped.meta,
    actions: scraped.actions,
    provenance,
    discrepancies,
    ...(visibleByline ? { visibleByline } : {}),
    prose,
    fingerprint,
    estimatedTokens: Math.ceil(context.length / 4),
    diagnostics: scraped.diagnostics,
  };
}

// ---------------------------------------------------------------------------
// 4. Multi-Page Knowledge Graph Fusion & Bayesian Truth Discovery
// ---------------------------------------------------------------------------

function scalarOf(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    const s = String(val).trim();
    return s || undefined;
  }
  if (Array.isArray(val)) return scalarOf(val[0]);
  if (typeof val === 'object') {
    const obj = val as JsonObject;
    return (
      scalarOf(obj['price']) ??
      scalarOf(obj['ratingValue']) ??
      scalarOf(obj['name']) ??
      scalarOf(obj['headline'])
    );
  }
  return undefined;
}

/**
 * Fuses multiple pages (`ContextResult`, `Document`, or HTML string) into a
 * single deduplicated multi-page context:
 * - **Same-subject pages (`mode: 'consensus'`)**: Runs Bayesian Truth Discovery
 *   weighted by `verifiedInText` provenance to compute a single `consensus`
 *   entity and isolates cross-source disagreements in `conflicts`.
 * - **Distinct-entity pages (`mode: 'comparison'`)**: Synthesizes a unified
 *   Markdown Comparison Matrix (`comparisonTable`) aligning all entities and
 *   their `<dl>`/`<table>` specs side-by-side.
 * - **Cross-Page SimHash Prose Deduplication**: Eliminates syndicated/repeated
 *   paragraphs across pages (Hamming distance ≤ 10) and cites their sources `[1, 2]`.
 */
export function fusePages(
  inputs: readonly (ContextResult | Document | string)[],
  options: ContextOptions & { mode?: 'auto' | 'consensus' | 'comparison' } = {}
): FusedContextResult {
  const pages: ContextResult[] = inputs.map((inp) =>
    typeof inp === 'object' && 'context' in inp && 'fingerprint' in inp
      ? inp
      : toContext(inp as Document | string, options)
  );

  // Determine whether pages describe the same entity or distinct entities
  const names = pages
    .map((p) => scalarOf(p.primary?.['name'] ?? p.primary?.['headline'] ?? p.meta.title))
    .filter((n): n is string => Boolean(n));

  let sameSubject = false;
  if (names.length >= 2) {
    const firstNorm = names[0]!.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    sameSubject = names.every((n) => {
      const norm = n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return norm === firstNorm || norm.includes(firstNorm) || firstNorm.includes(norm);
    });
  }
  const mode: 'consensus' | 'comparison' =
    options.mode === 'consensus' || options.mode === 'comparison'
      ? options.mode
      : sameSubject
        ? 'consensus'
        : 'comparison';

  const conflicts: FieldConflict[] = [];
  let consensus: JsonObject | undefined;
  let comparisonTable: string | undefined;

  if (mode === 'consensus') {
    consensus = {};
    const allFields = new Set<string>();
    for (const p of pages) {
      for (const k of Object.keys(p.primary ?? {})) allFields.add(k);
      for (const k of Object.keys(p.specs)) allFields.add(`spec:${k}`);
    }

    for (const field of allFields) {
      const isSpec = field.startsWith('spec:');
      const rawKey = isSpec ? field.slice(5) : field;
      const bucket = new Map<
        string,
        { display: string; raw: JsonValue; sources: string[]; verifiedInText: boolean; confidence: number }
      >();

      pages.forEach((p, idx) => {
        const sourceId = p.meta.canonical ?? `[${idx + 1}]`;
        const val = isSpec ? p.specs[rawKey] : p.primary?.[rawKey];
        const scalar = scalarOf(val);
        if (!scalar || val === undefined) return;

        const normKey = scalar.toLowerCase().replace(/\s+/g, ' ');
        const prov = p.provenance.find((pr) => pr.field === rawKey || pr.field.startsWith(`${rawKey}.`));
        const verified = prov?.verifiedInText ?? isSpec;
        // Bayesian weight: verified in visible text = 2.0, unverified markup = 1.0
        const weight = verified ? 2.0 : 1.0;

        const existing = bucket.get(normKey);
        if (existing) {
          existing.sources.push(sourceId);
          existing.confidence += weight;
          existing.verifiedInText = existing.verifiedInText || verified;
        } else {
          bucket.set(normKey, {
            display: scalar,
            raw: val,
            sources: [sourceId],
            verifiedInText: verified,
            confidence: weight,
          });
        }
      });

      if (bucket.size === 0) continue;
      const ranked = [...bucket.values()].sort((a, b) => b.confidence - a.confidence);
      consensus[rawKey] = ranked[0]!.raw;

      if (ranked.length > 1 && rawKey !== 'type' && rawKey !== 'url') {
        conflicts.push({
          field: rawKey,
          values: ranked.map((r) => ({
            value: r.display,
            sources: r.sources,
            verifiedInText: r.verifiedInText,
            confidence: r.confidence,
          })),
        });
      }
    }
  } else {
    // Build a side-by-side Markdown comparison matrix across distinct entities
    const headers = pages.map(
      (p, i) =>
        scalarOf(p.primary?.['name'] ?? p.primary?.['headline'] ?? p.meta.title) ?? `Page ${i + 1}`
    );
    const rowKeys = new Set<string>(['type']);
    for (const p of pages) {
      for (const k of Object.keys(p.primary ?? {})) {
        if (k !== 'name' && k !== 'headline') rowKeys.add(k);
      }
      for (const k of Object.keys(p.specs)) rowKeys.add(k);
    }

    const lines: string[] = [
      `| Feature | ${headers.map((h) => h.replace(/\|/g, '/')).join(' | ')} |`,
      `| --- | ${headers.map(() => '---').join(' | ')} |`,
    ];

    for (const key of [...rowKeys].slice(0, 20)) {
      const cells = pages.map((p) => {
        const val = p.primary?.[key] ?? p.specs[key];
        const s = scalarOf(val) ?? (val !== undefined ? JSON.stringify(val) : '—');
        return s.replace(/\|/g, '/').slice(0, 80);
      });
      if (cells.some((c) => c !== '—')) {
        lines.push(`| **${key}** | ${cells.join(' | ')} |`);
      }
    }
    comparisonTable = lines.join('\n');
  }

  // Cross-page SimHash deduplication of prose paragraphs
  const passages: Array<{ text: string; hash: string; sources: string[] }> = [];
  pages.forEach((p, idx) => {
    const sourceId = p.meta.canonical ?? `[${idx + 1}]`;
    for (const line of p.prose.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length < 20) continue;
      const hash = simhash64(trimmed);
      const nearDup = passages.find((existing) => hammingDistance(existing.hash, hash) <= 10);
      if (nearDup) {
        if (!nearDup.sources.includes(sourceId)) nearDup.sources.push(sourceId);
      } else {
        passages.push({ text: trimmed, hash, sources: [sourceId] });
      }
    }
  });

  const sections: string[] = [];
  if (mode === 'consensus' && consensus) {
    sections.push(`# Multi-Page Consensus (${pages.length} sources)\n\`\`\`json\n${JSON.stringify(consensus)}\n\`\`\``);
    if (conflicts.length > 0) {
      sections.push(
        `## Cross-Source Conflicts\n` +
          conflicts
            .map(
              (c) =>
                `- **${c.field}**: ` +
                c.values
                  .map(
                    (v) =>
                      `"${v.value}" (${v.sources.join(', ')}, ${v.verifiedInText ? 'verified in text' : 'markup only'}, score=${v.confidence})`
                  )
                  .join(' vs ')
            )
            .join('\n')
      );
    }
  } else if (comparisonTable) {
    sections.push(`# Multi-Page Comparison Matrix (${pages.length} entities)\n\n${comparisonTable}`);
  }

  if (passages.length > 0) {
    sections.push(
      `## Deduplicated Cross-Page Passages\n` +
        passages
          .slice(0, 20)
          .map((p) => `${p.text} *(sources: ${p.sources.join(', ')})*`)
          .join('\n')
    );
  }

  const context = sections.join('\n\n');
  return {
    context,
    mode,
    ...(consensus ? { consensus } : {}),
    ...(comparisonTable ? { comparisonTable } : {}),
    conflicts,
    passages: passages.map(({ text, sources }) => ({ text, sources })),
    pages,
    estimatedTokens: Math.ceil(context.length / 4),
  };
}

// ---------------------------------------------------------------------------
// 5. Foveated Multi-Page Wavefront Exploration (`foragePages`)
// ---------------------------------------------------------------------------

/**
 * Foveated Multi-Page Wavefront Exploration:
 * Mimics biological foveated vision and wave-mechanics sensing across $N$ pages:
 * 1. Computes each page's **Epistemic Resonance** with the query (combining
 *    structured schema match, epistemic atom surprisal, DOM provenance
 *    verification, and temporal freshness).
 * 2. Focuses the **Fovea** (`L1` Epistemic Core) on the top $K$ highest-resonance
 *    pages (default $K = \min(2, N)$).
 * 3. Keeps all remaining SERP pages in **Peripheral Vision** as 1-line `L0`
 *    Holographic Pulses (~35 tokens each), so the LLM maintains 100% awareness
 *    of all $N$ sources at $1/20\text{th}$ the token cost.
 * 4. Surfaces a global index of **Shadow Machine Twins** and **Epistemic Frontier**
 *    next-hop links across all pages.
 */
export function foragePages(
  inputs: readonly (ContextResult | Document | string)[],
  options: ContextOptions & { foveaCount?: number } = {}
): ForagedWavefrontResult {
  const profile = options.query ? buildQueryProfile(options.query) : undefined;
  const pages: ContextResult[] = inputs.map((inp) =>
    typeof inp === 'object' && 'context' in inp && 'pulse' in inp
      ? inp
      : toContext(inp as Document | string, { ...options, resolution: 'L1' })
  );

  // Score each page by Epistemic Resonance
  const scored = pages.map((page, idx) => {
    const url = (page as { url?: string }).url ?? page.meta.canonical ?? `[${idx + 1}]`;
    let resonance = 1.0;

    // 1. Surprisal density from epistemic atoms
    for (const atom of page.atoms.slice(0, 5)) {
      resonance += atom.surprisal * 1.2;
    }

    // 2. Query feature match against structured data, specs, and atoms
    if (profile && profile.terms.length > 0) {
      const hay = `${JSON.stringify(page.primary ?? {})} ${JSON.stringify(page.specs)} ${page.atoms.map((a) => a.claim).join(' ')}`;
      const feats = extractFeatures(hay, profile);
      resonance += feats.size * 3.5;
    }

    // 3. Provenance trust bonus (verified in visible text) & discrepancy penalty
    const verifiedCount = page.provenance.filter((p) => p.verifiedInText).length;
    resonance += verifiedCount * 1.5;
    resonance -= page.discrepancies.length * 3.0;

    // 4. Temporal light-cone penalty for expired offers
    if (page.temporal.isExpiredOffer) resonance -= 4.0;

    return {
      url,
      resonance: Number(Math.max(0.1, resonance).toFixed(2)),
      page,
    };
  });

  scored.sort((a, b) => b.resonance - a.resonance);

  const foveaCount = options.foveaCount ?? (scored.length <= 2 ? 1 : 2);
  const fovea = scored.slice(0, foveaCount);
  const periphery = scored.slice(foveaCount).map((s) => ({
    url: s.url,
    resonance: s.resonance,
    pulse: s.page.pulse,
  }));

  // Aggregate deduplicated Machine Twins and Global Epistemic Frontier
  const twinMap = new Map<string, MachineTwin>();
  const frontierMap = new Map<string, FrontierLink>();
  for (const s of scored) {
    for (const t of s.page.machineTwins) {
      if (!twinMap.has(t.url)) twinMap.set(t.url, t);
    }
    for (const f of s.page.frontier) {
      const existing = frontierMap.get(f.url);
      if (!existing || f.scent > existing.scent) frontierMap.set(f.url, f);
    }
  }

  const machineTwins = [...twinMap.values()].slice(0, 6);
  const frontier = [...frontierMap.values()].sort((a, b) => b.scent - a.scent).slice(0, 6);

  const sections: string[] = [
    `# Foveated Wavefront (${fovea.length} foveal, ${periphery.length} peripheral L0 pulses)`,
  ];

  for (const f of fovea) {
    const p = f.page;
    const title =
      scalarOf(p.primary?.['name'] ?? p.primary?.['headline'] ?? p.meta.title) ?? f.url;
    const block: string[] = [`## [FOVEA r=${f.resonance}] ${title} (${f.url})`];
    if (p.temporal.anchorWarning) block.push(`⏱️ ${p.temporal.anchorWarning}`);
    if (p.discrepancies.length > 0) {
      block.push(`⚠️ Discrepancies: ${p.discrepancies.join(' | ')}`);
    }
    if (p.primary) {
      block.push(`Structured: \`${JSON.stringify(p.primary)}\``);
    }
    if (Object.keys(p.specs).length > 0) {
      block.push(`Specs: \`${JSON.stringify(p.specs)}\``);
    }
    if (p.atoms.length > 0) {
      block.push(
        `Epistemic Atoms:\n${p.atoms
          .slice(0, 5)
          .map((a) => `- [${a.kind}, s=${a.surprisal}] ${a.claim}`)
          .join('\n')}`
      );
    }
    sections.push(block.join('\n'));
  }

  if (periphery.length > 0) {
    sections.push(
      `## Peripheral Vision (L0 Holographic Pulses)\n` +
        periphery.map((p) => `- (${p.url}, r=${p.resonance}) ${p.pulse}`).join('\n')
    );
  }

  if (machineTwins.length > 0) {
    sections.push(
      `## Discovered Shadow APIs & Machine Twins\n` +
        machineTwins.map((t) => `- [${t.kind}] ${t.url} (${t.description})`).join('\n')
    );
  }

  if (frontier.length > 0) {
    sections.push(
      `## Global Epistemic Frontier (Highest-Scent Next Hops)\n` +
        frontier.map((f) => `- [scent=${f.scent}, ${f.reason}] [${f.anchor}](${f.url})`).join('\n')
    );
  }

  const context = sections.join('\n\n');
  return {
    context,
    fovea,
    periphery,
    machineTwins,
    frontier,
    estimatedTokens: Math.ceil(context.length / 4),
  };
}
