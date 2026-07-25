/**
 * Provider-neutral plant-content port — the boundary external-integrations.md
 * section 2 draws, applied to section 8's capability: "domain/application →
 * provider-neutral port → provider adapter → external API. Provider SDK and
 * payload types remain inside the adapter." Everything an adapter returns is
 * already normalized to this module's own shapes; no vendor payload type
 * crosses this line.
 *
 * No real adapter implements this port: plant-content provider selection is
 * P0-PROV-01, an undecided implementation-time selection — the exact blocker
 * that shaped the weather port (`weather-provider.ts`). The port exists so
 * that when a vendor IS selected, its adapter is one new class plus one
 * registry entry (`plant-content-provider-registry.ts`) — proven by this
 * stage's own replacement tests, which run two different fakes through the
 * identical machinery. Until then the deterministic fakes in
 * `integrations-test-doubles.ts` are the only implementations, and the
 * honest runtime state is "no provider configured"
 * (`refresh-plant-content.ts`).
 *
 * Two operations, because the capability has two halves: resolving the
 * provider's own taxonomy identity for an application taxonomy
 * (`searchTaxa`, consumed by `map-plant-taxonomy.ts`), and fetching licensed
 * content for an already-resolved provider taxon (`fetchContent`, consumed
 * by `refresh-plant-content.ts`). Each call is one quota consumption and one
 * bounded deadline.
 *
 * Source: architecture/external-integrations.md, sections "2. Integration
 * Boundary", "3. Adapter Contract", "8. Plant Content", "15. Testing"
 * ("Provider replacement compatibility").
 */

import type { PlantContentSections, PlantContentSource } from '../domain/plant-content-record.js';

/** The application-side identity facts a taxon search may use — never a plant, garden, or anything user-scoped. */
export interface TaxonomyIdentityQuery {
  readonly scientificName: string;
  readonly commonName: string | null;
}

/**
 * One candidate provider taxon as the adapter reports it: the provider's own
 * identifier, what the provider calls it, and the provider's own match
 * confidence — each where supplied, never invented.
 */
export interface ProviderTaxonCandidate {
  readonly providerTaxonId: string;
  readonly scientificName: string | null;
  readonly confidence: number | null;
}

/**
 * One normalized content payload as the adapter reports it: the provider's
 * own record identity/version/language plus the normalized licensed
 * sections. The provider key, fetch time, and license metadata are
 * deliberately NOT here — those are the CALLER's facts (which registry entry
 * asked, when), stamped by `refresh-plant-content.ts` when it turns a
 * payload into a persisted `PlantContentRecord`.
 */
export interface NormalizedPlantContent {
  readonly source: PlantContentSource;
  readonly sections: PlantContentSections;
}

export interface PlantContentProviderAdapter {
  /**
   * Searches the provider's taxonomy for candidates matching an application
   * taxonomy identity. An empty list means the provider knows no match — a
   * typed degradation for the caller, never repaired into a guess. `signal`
   * aborts when the caller's bounded deadline expires; may reject with
   * anything — the caller converts every failure into a typed degradation.
   */
  searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]>;

  /**
   * Fetches the provider's current content for one of its own taxon
   * identifiers. `null` means the provider has no content for that taxon —
   * again a typed degradation for the caller. Same deadline and failure
   * semantics as `searchTaxa`.
   */
  fetchContent(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<NormalizedPlantContent | null>;
}
