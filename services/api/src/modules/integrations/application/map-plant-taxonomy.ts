/**
 * Resolves (or honestly declines to resolve) the active plant-content
 * provider's own taxonomy identity for one stable application taxonomy
 * reference — the single write path into
 * `integrations.plant_taxonomy_mapping`, built to be called by whichever
 * future stage first consumes plant content (a guide/content surface or a
 * scheduled warm-up sweep) and safe to call repeatedly before then: a repeat
 * against an already-mapped reference is an `alreadyMapped` no-op that never
 * touches the provider.
 *
 * The direction of the mapping is the work package's core claim: the
 * application reference is the anchor, the provider taxon maps INTO it, and
 * the created row is always `unverified` with the provider's own confidence
 * recorded — a machine proposal, explicitly labeled as one, never a silent
 * re-identification of anything.
 *
 * Candidate choice is deterministic: the highest provider-reported
 * confidence wins, a tie (or an all-null field) falls back to the
 * provider's own result order. The losing candidates are not stored — a
 * mapping is one identity claim, not a ranking; re-running against a
 * corrected provider is cheap and explicit.
 *
 * Every failure is a typed, named outcome (the `RefreshGardenWeather`
 * honesty posture): no provider configured (today's reality — P0-PROV-01 is
 * undecided and NO plant-content vendor exists in this repository), an
 * unknown reference, an exhausted quota, a timeout, a failure, no match, or
 * malformed candidates. Quota is consumed strictly BEFORE the call; a
 * consumed-then-failed call stays consumed — the call was made.
 *
 * No authorization here: this use case has no user-facing transport — the
 * stage that first exposes it to an actor adds the authorization its
 * surface needs.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "4. Provider Registry", "8. Plant Content", "11. Reliability",
 * "14. Cost and Quota".
 */

import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { PlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import { createPlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import type { ProviderTaxonCandidate } from './plant-content-provider.js';
import type { PlantContentProviderRegistry } from './plant-content-provider-registry.js';
import { requireRegisteredPlantContentProvider } from './plant-content-provider-registry.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';
import type { ProviderQuotaRepository } from './provider-quota-repository.js';
import type { TaxonomyIdentitySource } from './taxonomy-identity-source.js';
import { withDeadline } from './with-deadline.js';

/** Why a mapping could not be produced. Each value is a distinct, documented degradation the consumer may branch on. */
export type MapPlantTaxonomyUnavailableReason =
  | 'noProviderConfigured'
  | 'taxonomyReferenceNotFound'
  | 'quotaExhausted'
  | 'providerTimeout'
  | 'providerFailed'
  | 'providerReturnedNoMatch'
  | 'providerReturnedInvalidData';

export type MapPlantTaxonomyResult =
  /** A live mapping already exists — served without any provider call (what makes repeats and races no-ops). */
  | { readonly outcome: 'alreadyMapped'; readonly mapping: PlantTaxonomyMapping }
  /** The provider was searched and an unverified mapping was persisted. */
  | { readonly outcome: 'mapped'; readonly mapping: PlantTaxonomyMapping }
  /** No mapping could be produced; the reason names why. */
  | { readonly outcome: 'unavailable'; readonly reason: MapPlantTaxonomyUnavailableReason };

export interface MapPlantTaxonomyInput {
  readonly taxonomyReferenceId: Uuid;
}

/**
 * Environment configuration, per external-integrations.md section 4.
 * `activeProviderKey: null` is the current, honest reality of every
 * environment — no plant-content provider has been selected (P0-PROV-01).
 */
export interface MapPlantTaxonomyConfiguration {
  readonly activeProviderKey: string | null;
}

export class MapPlantTaxonomy {
  constructor(
    private readonly registry: PlantContentProviderRegistry,
    private readonly configuration: MapPlantTaxonomyConfiguration,
    private readonly mappings: PlantTaxonomyMappingRepository,
    private readonly taxonomyIdentities: TaxonomyIdentitySource,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly clock: Clock,
  ) {
    if (configuration.activeProviderKey !== null) {
      // A configured-but-unregistered key is a composition defect, not a
      // runtime degradation — fail at construction, before any reference is
      // silently served "unavailable" for the wrong reason (the
      // `RefreshGardenWeather` posture).
      requireRegisteredPlantContentProvider(registry, configuration.activeProviderKey);
    }
  }

  async execute(input: MapPlantTaxonomyInput): Promise<MapPlantTaxonomyResult> {
    const providerKey = this.configuration.activeProviderKey;
    if (providerKey === null) {
      return { outcome: 'unavailable', reason: 'noProviderConfigured' };
    }

    const existing = await this.mappings.findLive(providerKey, input.taxonomyReferenceId);
    if (existing !== null) {
      return { outcome: 'alreadyMapped', mapping: existing };
    }

    const reference = await this.taxonomyIdentities.findById(input.taxonomyReferenceId);
    if (reference === null) {
      return { outcome: 'unavailable', reason: 'taxonomyReferenceNotFound' };
    }

    const registration = requireRegisteredPlantContentProvider(this.registry, providerKey);
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
        id: generateUuidV7(),
        taxonomyReferenceId: input.taxonomyReferenceId,
        rawProviderKey: registration.metadata.providerKey,
        rawProviderTaxonId: candidate.providerTaxonId,
        providerScientificName: candidate.scientificName,
        confidence: candidate.confidence,
        now: this.clock.now(),
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        // Section 15's "malformed response" case: the provider spoke, but
        // not within the normalized contract. Never persisted, never
        // repaired into a plausible-looking identity claim.
        return { outcome: 'unavailable', reason: 'providerReturnedInvalidData' };
      }
      throw error;
    }

    if (await this.mappings.insert(mapping)) {
      return { outcome: 'mapped', mapping };
    }
    // A concurrent mapper won the partial unique index; their row is the
    // live mapping now — a no-op for this caller, exactly like a repeat.
    const winner = await this.mappings.findLive(providerKey, input.taxonomyReferenceId);
    if (winner === null) {
      throw new InternalError(
        'integrations.plant_taxonomy_mapping.insert_conflict_unresolved',
        `Mapping insert for taxonomy reference '${input.taxonomyReferenceId}' conflicted but no live mapping exists.`,
      );
    }
    return { outcome: 'alreadyMapped', mapping: winner };
  }
}

/** Highest provider-reported confidence wins; ties and null confidences fall back to the provider's own result order. */
function bestCandidate(candidates: readonly ProviderTaxonCandidate[]): ProviderTaxonCandidate {
  let best = candidates[0] as ProviderTaxonCandidate;
  for (const candidate of candidates.slice(1)) {
    if ((candidate.confidence ?? -1) > (best.confidence ?? -1)) {
      best = candidate;
    }
  }
  return best;
}
