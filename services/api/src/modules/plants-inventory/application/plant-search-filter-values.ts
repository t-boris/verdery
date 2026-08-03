/**
 * The closed vocabularies P11-SEARCH-01's joined filters range over.
 *
 * Declared here rather than imported from the modules that own the underlying
 * tables: `image_analysis_result` belongs to observations-history and
 * `plant_distribution_assertion` to integrations, and a search filter reaching
 * into either module's domain to name a value would couple plants-inventory to
 * both for nothing more than four string literals. The values are fixed by
 * database CHECK constraints and by the OpenAPI enums, which is where they are
 * actually enforced; these are the same lists, stated locally.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `ImageAnalysisKind`,
 * `TaxonSeasonalActivity`, `PlantDistributionStatus`, and
 * `PlantProfileCompleteness`; implementation-plan.md work package
 * P11-SEARCH-01.
 */

export type ImageAnalysisKind = 'stress' | 'disease' | 'pest' | 'other';

export type TaxonSeasonalActivity = 'sow_indoors' | 'sow_outdoors' | 'transplant' | 'harvest';

export type PlantDistributionStatus = 'native' | 'introduced' | 'invasive' | 'regulated';

/** `none` is not a degenerate `partial` — it means enrichment never produced a profile for this taxon at all. */
export type PlantProfileCompleteness = 'complete' | 'partial' | 'none';
