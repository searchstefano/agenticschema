export {
  toTools,
  scrape,
  defineTool,
  type PipelineOptions,
  type PipelineResult,
  type ScrapeResult,
  type ScrapeActionSummary,
  type CustomTool,
} from './pipeline.js';

export { extract, extractMeta, needsDocument, type ExtractOptions, type PageMeta } from './extract/index.js';
export { normalize, type NormalizeOptions } from './normalize/index.js';
export { selectPrimary, BOILERPLATE_TYPES } from './select/primary.js';
export {
  mapToTools,
  genericProfile,
  materialize,
  toSlug,
  type MapOptions,
  type MapResult,
  type Profile,
  type ReadSpec,
} from './map/index.js';
export { mapActions, type ActionOptions, type ActionResult } from './map/actions.js';
export { guardTools, sanitizeText, type GuardOptions } from './guard/index.js';
export {
  toContext,
  fusePages,
  foragePages,
  simhash64,
  hammingDistance,
  estimateBpeTokens,
  extractSpecs,
  extractHydrationData,
  extractZeroDomNodes,
  extractEpistemicAtoms,
  computeTemporalCone,
  discoverMachineTwins,
  extractEpistemicFrontier,
  type ContextOptions,
  type ContextResult,
  type FusedContextResult,
  type ForagedWavefrontResult,
  type FieldConflict,
  type FieldProvenance,
  type EpistemicAtom,
  type EvidenceNode,
  type EvidenceTier,
  type EvidenceSigil,
  type FacetStatus,
  type FacetDiagnostic,
  type EpistemicSufficiency,
  type EpistemicControllerPlan,
  type TemporalCone,
  type MachineTwin,
  type FrontierLink,
} from './context/index.js';
export * from './types.js';
