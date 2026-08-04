/**
 * Provider-neutral port for structured plant fact and distribution
 * assertions — the "new equivalent port for structured fact/distribution
 * assertions" ADR-0016 section 5 names, alongside the existing
 * `PlantContentProviderAdapter` (licensed prose). Same boundary
 * (external-integrations.md section 2): domain/application → provider-
 * neutral port → provider adapter → external API, with vendor payload
 * shapes staying inside the adapter.
 *
 * Reuses `TaxonomyIdentityQuery`/`ProviderTaxonCandidate` from
 * `plant-content-provider.ts` rather than a second copy: identity search is
 * the identical shape for both capabilities (an application taxon's own
 * scientific/common name in, a provider's own candidate taxa out), and nothing
 * about this port's OWN operations narrows or widens that shape.
 *
 * Three operations because taxon knowledge has three independently fetchable
 * halves for this capability: resolving the provider's own taxonomy identity
 * (`searchTaxa`, mirroring `PlantContentProviderAdapter`), structured facts
 * (`fetchFacts` — hardiness, growth habit, and anything else a `factKey`/
 * `factValue` pair can express), and geographic distribution/regulatory
 * status (`fetchDistribution`). A provider that has nothing for one half
 * (e.g. a facts-only source) returns an empty array from the other, never a
 * fabricated placeholder.
 *
 * Deliberately NOT merged with `PlantContentProviderAdapter` into one bigger
 * port: prose content and structured assertions are genuinely different
 * shapes with different review/authoring rules downstream
 * (`plant-content-record.ts` carries no provenance-review gate;
 * `plant-fact-assertion.ts`/`plant-distribution-assertion.ts` do), and a
 * provider commonly implements only one (Open-Meteo-style single-purpose
 * adapters, not omnibus ones) — matching the weather/plant-content split's
 * own "two capabilities carry two registries" precedent, applied a third
 * time to structured assertions.
 *
 * Source: architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md,
 * section 5; architecture/external-integrations.md, sections "2. Integration
 * Boundary", "3. Adapter Contract".
 */

import type { ProviderTaxonCandidate, TaxonomyIdentityQuery } from './plant-content-provider.js';

export type { ProviderTaxonCandidate, TaxonomyIdentityQuery };

/**
 * One structured fact as the adapter reports it, pre-provenance: the
 * provider key, fetch time, and review status are the CALLER's facts
 * (`refresh-taxon-assertions.ts` stamps them), the same separation
 * `NormalizedPlantContent`'s own header documents for prose content.
 */
export interface NormalizedFactCandidate {
  readonly factKey: string;
  readonly value: unknown;
  readonly unit: string | null;
  readonly confidence: number | null;
  /** Null means globally applicable; non-null narrows to a region. */
  readonly geographicScope: string | null;
}

/**
 * One distribution/regulatory-status claim as the adapter reports it,
 * pre-provenance — same separation as `NormalizedFactCandidate`.
 * `rawStatus` is validated against `DistributionStatus` by the caller
 * (`createPlantDistributionAssertion` already does this), not here: the
 * adapter's job is normalizing the provider's own vocabulary into this
 * shape, not re-implementing the domain's own validation.
 */
export interface NormalizedDistributionCandidate {
  readonly region: string;
  readonly rawStatus: string;
  readonly confidence: number | null;
}

/**
 * One image a provider offers for a taxon, as the adapter reports it.
 *
 * `rawLicence` is the provider's own string, NOT a decision: a GBIF response
 * mixes CC0, CC-BY and CC-BY-NC within one result set, and every value is
 * recorded — including the ones this product may not show — so that a
 * refusal stays a fact the system knows. `plant-media-licence.ts` maps and
 * judges it; this shape only transports what the source claimed.
 */
export interface NormalizedMediaCandidate {
  readonly providerAssetId: string;
  readonly sourceUrl: string;
  readonly rawLicence: string | null;
  readonly rightsHolder: string | null;
  readonly creator: string | null;
  readonly observedAt: Date | null;
}

export interface PlantAssertionProviderAdapter {
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
   * Fetches every structured fact the provider currently has for one of its
   * own taxon identifiers. An empty array means the provider has nothing —
   * a typed degradation, never an error. Same deadline/failure semantics as
   * `searchTaxa`.
   */
  fetchFacts(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedFactCandidate[]>;

  /**
   * Fetches every distribution/regulatory-status claim the provider
   * currently has for one of its own taxon identifiers. Same empty-array-is-
   * honest-degradation and deadline/failure semantics as `fetchFacts`.
   */
  fetchDistribution(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedDistributionCandidate[]>;

  /**
   * Fetches the reference images the provider offers for one of its own
   * taxon identifiers — what the species LOOKS like, as distinct from a
   * gardener's photographs of their own plant.
   *
   * Same empty-array-is-honest-degradation and deadline/failure semantics as
   * `fetchFacts`. A provider with no imagery returns an empty array; that is
   * the answer, not a gap to fill from somewhere else.
   */
  fetchMedia(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedMediaCandidate[]>;
}
