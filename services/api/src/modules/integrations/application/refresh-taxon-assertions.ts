/**
 * Resolves (creating if absent) a provider's own taxonomy mapping for one
 * application taxon, then fetches and persists that provider's current
 * structured facts and distribution/regulatory claims — the storage-to-
 * provider-to-storage round trip `plant-assertion-provider.ts`'s own header
 * describes as this use case's job, the direct structural sibling of
 * `refresh-plant-content.ts` (prose) and `map-plant-taxonomy.ts` (identity
 * alone) for this module's third capability.
 *
 * MAPPING RESOLUTION IS INLINED HERE, NOT SHARED WITH `map-plant-taxonomy.ts`:
 * that use case is typed against `PlantContentProviderRegistry`
 * specifically, and generalizing it to accept either registry would touch
 * already-shipped, already-tested P7 code for a second caller — the same
 * "tolerate-at-two, generalize-at-the-third" judgment
 * `plant-assertion-provider-registry.ts`'s own header already applies to
 * the registry classes themselves, applied here to the ~30 lines of
 * resolve-or-create logic instead.
 *
 * EVERY PERSISTED ASSERTION IS STAMPED `authoringMethod: 'ai_extracted_from_source'`,
 * `reviewStatus: 'awaiting_horticultural_review'` — NEVER `human_authored`
 * (impossible by the migration's own `_human_authored_identity_check`,
 * which requires `provider_key = 'human'`) and never pre-reviewed. This is
 * the "ordinary extraction-with-review path"
 * `plant-distribution-assertion.ts`'s own header names for exactly this
 * knowledge class: `sourceCitation` names the specific provider record
 * fetched. A cited row is immediately eligible for a source-backed catalog
 * profile, while `RecalculateCandidateSuitability` continues to read only
 * `horticulturally_reviewed` rows. A later reviewer-facing stage may promote
 * the assertion without blocking gardeners from seeing attributed knowledge,
 * the same deliberate deferral
 * `plant-taxonomy-mapping-repository.ts`'s own header already documents for
 * `updateVerificationState` ("no application use case drives it yet... the
 * port carries the operation so the machinery is proven"). This pipeline
 * lands real, correctly-provenanced data without presenting it as reviewed.
 *
 * Every failure is a typed, named outcome (the `RefreshGardenWeather`/
 * `MapPlantTaxonomy` honesty posture): no such provider registered, an
 * unknown taxonomy reference, an exhausted quota, a timeout, a provider
 * failure, no identity match, or malformed provider data. Quota is consumed
 * strictly BEFORE each provider call (search, facts, distribution are up to
 * three separate calls, hence up to three quota consumptions per run — the
 * same "one successful call, one consumption" rule every provider in this
 * module already follows, applied per call rather than per use-case
 * invocation).
 *
 * Source: architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md,
 * section 5.
 */

import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { createPlantDistributionAssertion } from '../domain/plant-distribution-assertion.js';
import { createPlantFactAssertion } from '../domain/plant-fact-assertion.js';
import { createPlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import type { PlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import type { PlantDistributionAssertionRepository } from './plant-distribution-assertion-repository.js';
import type { PlantMediaAssetRepository } from './plant-media-asset-repository.js';
import {
  createPlantMediaAsset,
  parseProviderLicense,
  presentationIneligibility,
} from '../domain/plant-media-asset.js';
import type { PlantFactAssertionRepository } from './plant-fact-assertion-repository.js';
import type {
  NormalizedMediaCandidate,
  ProviderTaxonCandidate,
} from './plant-assertion-provider.js';
import type { PlantAssertionProviderRegistration } from './plant-assertion-provider-registry.js';
import type { PlantAssertionProviderRegistry } from './plant-assertion-provider-registry.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';
import type { ProviderQuotaRepository } from './provider-quota-repository.js';
import type { TaxonomyIdentitySource } from './taxonomy-identity-source.js';
import { withDeadline } from './with-deadline.js';

export type TaxonAssertionsUnavailableReason =
  | 'providerNotRegistered'
  | 'taxonomyReferenceNotFound'
  | 'quotaExhausted'
  | 'providerTimeout'
  | 'providerFailed'
  | 'providerReturnedNoMatch'
  | 'providerReturnedInvalidData';

export type RefreshTaxonAssertionsResult =
  | {
      readonly outcome: 'refreshed';
      readonly mapping: PlantTaxonomyMapping;
      readonly factsWritten: number;
      readonly distributionWritten: number;
      /** Images stored, refused ones included; `0` when the provider offered none or could not be reached. */
      readonly mediaWritten: number;
    }
  | { readonly outcome: 'unavailable'; readonly reason: TaxonAssertionsUnavailableReason };

export interface RefreshTaxonAssertionsInput {
  readonly taxonomyReferenceId: Uuid;
  readonly providerKey: string;
}

/** Highest provider-reported confidence wins; ties and null confidences fall back to the provider's own result order — mirrors `map-plant-taxonomy.ts`'s own `bestCandidate`. */
function bestCandidate(candidates: readonly ProviderTaxonCandidate[]): ProviderTaxonCandidate {
  let best = candidates[0] as ProviderTaxonCandidate;
  for (const candidate of candidates.slice(1)) {
    if ((candidate.confidence ?? -1) > (best.confidence ?? -1)) {
      best = candidate;
    }
  }
  return best;
}

export class RefreshTaxonAssertions {
  constructor(
    private readonly registry: PlantAssertionProviderRegistry,
    private readonly mappings: PlantTaxonomyMappingRepository,
    private readonly taxonomyIdentities: TaxonomyIdentitySource,
    private readonly facts: PlantFactAssertionRepository,
    private readonly distributionAssertions: PlantDistributionAssertionRepository,
    private readonly mediaAssets: PlantMediaAssetRepository,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly generateId: () => Uuid,
    private readonly clock: Clock,
  ) {}

  async execute(input: RefreshTaxonAssertionsInput): Promise<RefreshTaxonAssertionsResult> {
    const registration = this.registry.get(input.providerKey);
    if (registration === null) {
      return { outcome: 'unavailable', reason: 'providerNotRegistered' };
    }

    const mappingResult = await this.resolveMapping(input, registration);
    if (mappingResult.outcome === 'unavailable') {
      return mappingResult;
    }
    const { mapping } = mappingResult;

    const quotaForFacts = await this.providerQuotas.consumeCall(
      registration.metadata.providerKey,
      registration.metadata.quotaLimits,
      this.clock.now(),
    );
    if (!quotaForFacts.consumed) {
      return { outcome: 'unavailable', reason: 'quotaExhausted' };
    }
    let factsCall;
    try {
      factsCall = await withDeadline(registration.metadata.fetchTimeoutMs, (signal) =>
        registration.adapter.fetchFacts(mapping.providerTaxonId, signal),
      );
    } catch {
      return { outcome: 'unavailable', reason: 'providerFailed' };
    }
    if (factsCall.kind === 'timedOut') {
      return { outcome: 'unavailable', reason: 'providerTimeout' };
    }

    const quotaForDistribution = await this.providerQuotas.consumeCall(
      registration.metadata.providerKey,
      registration.metadata.quotaLimits,
      this.clock.now(),
    );
    if (!quotaForDistribution.consumed) {
      return { outcome: 'unavailable', reason: 'quotaExhausted' };
    }
    let distributionCall;
    try {
      distributionCall = await withDeadline(registration.metadata.fetchTimeoutMs, (signal) =>
        registration.adapter.fetchDistribution(mapping.providerTaxonId, signal),
      );
    } catch {
      return { outcome: 'unavailable', reason: 'providerFailed' };
    }
    if (distributionCall.kind === 'timedOut') {
      return { outcome: 'unavailable', reason: 'providerTimeout' };
    }

    const now = this.clock.now();
    const authoring = {
      authoringMethod: 'ai_extracted_from_source' as const,
      providerKey: registration.metadata.providerKey,
      sourceCitation: registration.metadata.licenseNote,
    };
    const review = { reviewStatus: 'awaiting_horticultural_review' as const };

    for (const fact of factsCall.value) {
      await this.facts.insert(
        createPlantFactAssertion({
          id: this.generateId(),
          rawProviderTaxonId: mapping.providerTaxonId,
          rawFactKey: fact.factKey,
          factValue: fact.value,
          unit: fact.unit,
          confidence: fact.confidence,
          geographicScope: fact.geographicScope,
          authoring,
          review,
          fetchedAt: now,
          now,
        }),
      );
    }

    for (const distribution of distributionCall.value) {
      await this.distributionAssertions.insert(
        createPlantDistributionAssertion({
          id: this.generateId(),
          rawProviderTaxonId: mapping.providerTaxonId,
          rawRegion: distribution.region,
          rawStatus: distribution.rawStatus,
          confidence: distribution.confidence,
          authoring,
          review,
          fetchedAt: now,
          now,
        }),
      );
    }

    // Imagery is fetched LAST and its failure does not fail the refresh: the
    // facts and distribution claims above are already written, and losing
    // them because a media call timed out would trade real data for
    // pictures. A provider with no imagery answers empty, which is the same
    // path as a provider that could not be reached — both mean "no images
    // this time", and the next sweep asks again.
    const mediaWritten = await this.refreshMedia(registration, mapping.providerTaxonId);

    return {
      outcome: 'refreshed',
      mapping,
      factsWritten: factsCall.value.length,
      distributionWritten: distributionCall.value.length,
      mediaWritten,
    };
  }

  /**
   * Stores every image the provider offers, refused ones included.
   *
   * Returns how many rows were written, or `0` for any degradation — quota
   * exhausted, timeout, provider failure. Never throws: see the call site on
   * why imagery must not fail a refresh that already wrote real facts.
   */
  private async refreshMedia(
    registration: PlantAssertionProviderRegistration,
    providerTaxonId: string,
  ): Promise<number> {
    const quota = await this.providerQuotas.consumeCall(
      registration.metadata.providerKey,
      registration.metadata.quotaLimits,
      this.clock.now(),
    );
    if (!quota.consumed) {
      return 0;
    }

    let mediaCall: Awaited<ReturnType<typeof withDeadline<readonly NormalizedMediaCandidate[]>>>;
    try {
      mediaCall = await withDeadline<readonly NormalizedMediaCandidate[]>(
        registration.metadata.fetchTimeoutMs,
        (signal) => registration.adapter.fetchMedia(providerTaxonId, signal),
      );
    } catch {
      return 0;
    }
    if (mediaCall.kind === 'timedOut') {
      return 0;
    }

    const now = this.clock.now();
    let written = 0;
    for (const candidate of mediaCall.value) {
      const license = parseProviderLicense(candidate.rawLicence);
      const ineligibility = presentationIneligibility(license, candidate.rightsHolder);
      await this.mediaAssets.upsert(
        registration.metadata.providerKey,
        createPlantMediaAsset({
          id: this.generateId(),
          rawProviderTaxonId: providerTaxonId,
          mediaId: null,
          sourceUrl: candidate.sourceUrl,
          // The provider does not say which part of the plant is pictured,
          // and guessing would be a claim this application cannot support.
          organ: null,
          inferredOrgan: false,
          rawLicense: license,
          attributionText: null,
          creator: candidate.creator,
          rightsHolder: candidate.rightsHolder,
          observedAt: candidate.observedAt,
          generalizedLocation: candidate.generalizedLocation ?? null,
          // A refused image is stored as refused, not dropped.
          ingestionState: ineligibility === null ? 'discovered' : 'rejected',
          now,
        }),
      );
      written += 1;
    }

    return written;
  }

  /** Finds the live mapping, or resolves and persists one via `searchTaxa` — mirrors `MapPlantTaxonomy.execute`'s own resolution steps against this module's OTHER registry type. */
  private async resolveMapping(
    input: RefreshTaxonAssertionsInput,
    registration: NonNullable<ReturnType<PlantAssertionProviderRegistry['get']>>,
  ): Promise<
    | { readonly outcome: 'resolved'; readonly mapping: PlantTaxonomyMapping }
    | { readonly outcome: 'unavailable'; readonly reason: TaxonAssertionsUnavailableReason }
  > {
    const existing = await this.mappings.findLive(
      registration.metadata.providerKey,
      input.taxonomyReferenceId,
    );
    if (existing !== null) {
      return { outcome: 'resolved', mapping: existing };
    }

    const reference = await this.taxonomyIdentities.findById(input.taxonomyReferenceId);
    if (reference === null) {
      return { outcome: 'unavailable', reason: 'taxonomyReferenceNotFound' };
    }

    const quota = await this.providerQuotas.consumeCall(
      registration.metadata.providerKey,
      registration.metadata.quotaLimits,
      this.clock.now(),
    );
    if (!quota.consumed) {
      return { outcome: 'unavailable', reason: 'quotaExhausted' };
    }

    let call;
    try {
      call = await withDeadline(registration.metadata.fetchTimeoutMs, (signal) =>
        registration.adapter.searchTaxa(
          { scientificName: reference.scientificName, commonName: reference.commonName },
          signal,
        ),
      );
    } catch {
      return { outcome: 'unavailable', reason: 'providerFailed' };
    }
    if (call.kind === 'timedOut') {
      return { outcome: 'unavailable', reason: 'providerTimeout' };
    }
    if (call.value.length === 0) {
      return { outcome: 'unavailable', reason: 'providerReturnedNoMatch' };
    }

    const candidate = bestCandidate(call.value);
    let mapping: PlantTaxonomyMapping;
    try {
      mapping = createPlantTaxonomyMapping({
        id: this.generateId(),
        taxonomyReferenceId: input.taxonomyReferenceId,
        rawProviderKey: registration.metadata.providerKey,
        rawProviderTaxonId: candidate.providerTaxonId,
        providerScientificName: candidate.scientificName,
        confidence: candidate.confidence,
        now: this.clock.now(),
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return { outcome: 'unavailable', reason: 'providerReturnedInvalidData' };
      }
      throw error;
    }

    if (await this.mappings.insert(mapping)) {
      return { outcome: 'resolved', mapping };
    }
    // A concurrent resolver won the partial unique index; their row is the
    // live mapping now — a no-op for this caller, the same race handling
    // `MapPlantTaxonomy` documents.
    const winner = await this.mappings.findLive(
      registration.metadata.providerKey,
      input.taxonomyReferenceId,
    );
    if (winner === null) {
      throw new InternalError(
        'integrations.plant_taxonomy_mapping.insert_conflict_unresolved',
        `Mapping insert for taxonomy reference '${input.taxonomyReferenceId}' conflicted but no live mapping exists.`,
      );
    }
    return { outcome: 'resolved', mapping: winner };
  }
}
