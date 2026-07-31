/**
 * Port for selecting which application taxa the scheduled taxon-enrichment
 * sweep (`P11-ASYNC-01`) considers this run — the identical role
 * `weather-refresh-candidate-source.ts` plays for gardens, applied to taxa.
 *
 * A candidate is a `plants_inventory.taxonomy_reference` id referenced by at
 * least one real plant OR candidate — `plant.taxonomy_reference_id` or
 * `plant_candidate.taxonomy_reference_id`, both nullable, both counted: a
 * taxon someone is actively growing OR actively considering both deserve
 * enrichment, the same "candidates matter too" posture the suitability
 * engine already takes toward unidentified/partially-identified plants.
 *
 * Ordering is least-recently-materialized first: the latest
 * `plant_profile_version.created_at` per taxon, NULL (never assembled)
 * first of all — the same most-in-need-first, NULL-first shape
 * `WeatherRefreshCandidateSource`'s own header documents, so a bounded
 * batch rotates fairly across every referenced taxon over successive runs
 * rather than starving any of them. `plant_profile_version` (an OUTCOME
 * table, assembled by `RebuildPlantProfileVersion` after enrichment) is
 * used as the freshness signal rather than a per-provider fetch-attempt
 * log, the same "the stored result's own timestamp IS the cache/rotation
 * signal" reasoning `weather_record.fetched_at` already carries for weather.
 *
 * Cross-schema read (this module reading `plants_inventory`'s three
 * tables), following the `WeatherRefreshCandidateSource`/`MediaReferenceFinder`
 * precedent: a module may READ a sibling's tables through its own narrow
 * port when the query is inherently about the join, rather than
 * re-exporting three repositories across `public.ts` for one ordering
 * clause.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface TaxonEnrichmentCandidateSource {
  /**
   * Up to `limit` distinct plant/candidate-referenced taxonomy reference
   * ids, least recently materialized first (never-materialized taxa first
   * of all; ties broken by taxonomy reference id for determinism).
   */
  listEnrichmentCandidates(limit: number): Promise<readonly Uuid[]>;
}
