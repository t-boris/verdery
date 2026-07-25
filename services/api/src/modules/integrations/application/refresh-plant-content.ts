/**
 * Fetches (or honestly declines to fetch) normalized licensed plant content
 * for one stable application taxonomy reference — the single write path into
 * `integrations.plant_content_record`, built to be called by whichever
 * future stage first consumes plant content (a guide/content surface, the
 * rule engine's future content-aware rules, or a scheduled warm-up sweep)
 * and safe to call repeatedly before then: a repeat within the refetch
 * window serves the stored record and never touches the provider.
 *
 * Identity resolution goes through the live taxonomy mapping — this use
 * case never guesses which provider taxon an application reference means. A
 * reference without a live mapping is a typed `taxonomyNotMapped` outcome
 * (its caller runs `MapPlantTaxonomy` first, explicitly), and a rejected
 * mapping stops content resolving WITHOUT touching stored rows: content is
 * keyed by the provider's own taxon identity, so re-identification is
 * always an explicit mapping event, never a content rewrite.
 *
 * The refetch window is a cache rule, deliberately not a domain "freshness"
 * classification: no document defines when plant-care content goes stale
 * (unlike weather's section 5), so the window's only job is bounding
 * provider calls — its number is constructor-injected, validated
 * configuration with no invented default (the quota-reservation
 * numbers-are-not-mechanism posture). Every degradation with stored content
 * serves it explicitly labeled with the reason and its own fetch time —
 * "Cached stale data is labeled", section 11 — and every failure is a
 * typed outcome, never null-as-success, never fabricated content.
 *
 * Quota is consumed atomically, strictly BEFORE the call (shared
 * `provider_quota_usage` machinery); a consumed-then-failed call stays
 * consumed — the call was made. The provider call happens outside any
 * database transaction.
 *
 * No authorization here: no user-facing transport exists — the stage that
 * first exposes plant content to an actor adds the authorization its
 * surface needs.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "8. Plant Content", "11. Reliability", "14. Cost and Quota";
 * architecture/data-and-geospatial-design.md, section "20. External
 * Reference Data".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { PlantContentRecord } from '../domain/plant-content-record.js';
import { createPlantContentRecord } from '../domain/plant-content-record.js';
import type { PlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import type { NormalizedPlantContent } from './plant-content-provider.js';
import type {
  PlantContentProviderRegistration,
  PlantContentProviderRegistry,
} from './plant-content-provider-registry.js';
import { requireRegisteredPlantContentProvider } from './plant-content-provider-registry.js';
import type { PlantContentRecordRepository } from './plant-content-record-repository.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';
import type { ProviderQuotaRepository } from './provider-quota-repository.js';
import { withDeadline } from './with-deadline.js';

/** Why fresh content could not be produced. Each value is a distinct, documented degradation the consumer may branch on. */
export type PlantContentUnavailableReason =
  | 'noProviderConfigured'
  | 'taxonomyNotMapped'
  | 'quotaExhausted'
  | 'providerTimeout'
  | 'providerFailed'
  | 'providerReturnedNoData'
  | 'providerReturnedInvalidData';

export type RefreshPlantContentResult =
  /** The stored latest record is still within the refetch window — served without any provider call. */
  | {
      readonly outcome: 'contentCurrent';
      readonly record: PlantContentRecord;
      readonly mapping: PlantTaxonomyMapping;
    }
  /** The provider was called and its content was appended. `contentChanged` is false when the fetch reproduced the previous sections/version. */
  | {
      readonly outcome: 'refreshed';
      readonly record: PlantContentRecord;
      readonly mapping: PlantTaxonomyMapping;
      readonly contentChanged: boolean;
    }
  /** Fresh content could not be produced; the latest stored record is served, explicitly labeled with the reason. */
  | {
      readonly outcome: 'storedServed';
      readonly record: PlantContentRecord;
      readonly mapping: PlantTaxonomyMapping;
      readonly reason: PlantContentUnavailableReason;
    }
  /** Fresh content could not be produced and nothing is stored to serve. */
  | { readonly outcome: 'unavailable'; readonly reason: PlantContentUnavailableReason };

export interface RefreshPlantContentInput {
  readonly taxonomyReferenceId: Uuid;
}

/** How long a fetched content record suppresses refetching, in milliseconds. A cache rule, not a domain freshness claim — see the header. */
export interface PlantContentRefetchPolicy {
  readonly contentFreshForMs: number;
}

/** Rejects a non-positive or non-integer window — a policy that caches nothing (or for fractional milliseconds) is a configuration mistake, not a tuning choice. */
export function validatePlantContentRefetchPolicy(
  policy: PlantContentRefetchPolicy,
): PlantContentRefetchPolicy {
  if (!Number.isInteger(policy.contentFreshForMs) || policy.contentFreshForMs <= 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'contentFreshForMs must be a positive integer of milliseconds.',
      {
        details: [
          {
            code: 'integrations.plant_content_refetch_policy.window.invalid',
            pointer: '/contentFreshForMs',
          },
        ],
      },
    );
  }
  return policy;
}

/**
 * Environment configuration, per external-integrations.md section 4.
 * `activeProviderKey: null` is the current, honest reality of every
 * environment — no plant-content provider has been selected (P0-PROV-01).
 */
export interface RefreshPlantContentConfiguration {
  readonly activeProviderKey: string | null;
  readonly refetchPolicy: PlantContentRefetchPolicy;
}

export class RefreshPlantContent {
  private readonly configuration: RefreshPlantContentConfiguration;

  constructor(
    private readonly registry: PlantContentProviderRegistry,
    configuration: RefreshPlantContentConfiguration,
    private readonly contentRecords: PlantContentRecordRepository,
    private readonly mappings: PlantTaxonomyMappingRepository,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly clock: Clock,
  ) {
    validatePlantContentRefetchPolicy(configuration.refetchPolicy);
    if (configuration.activeProviderKey !== null) {
      requireRegisteredPlantContentProvider(registry, configuration.activeProviderKey);
    }
    this.configuration = configuration;
  }

  async execute(input: RefreshPlantContentInput): Promise<RefreshPlantContentResult> {
    const providerKey = this.configuration.activeProviderKey;
    if (providerKey === null) {
      // Without an active provider there is no mapping to resolve and no
      // provider identity to serve stored content under — the whole
      // capability is honestly off.
      return { outcome: 'unavailable', reason: 'noProviderConfigured' };
    }

    const mapping = await this.mappings.findLive(providerKey, input.taxonomyReferenceId);
    if (mapping === null) {
      return { outcome: 'unavailable', reason: 'taxonomyNotMapped' };
    }

    const latest = await this.contentRecords.findLatest(providerKey, mapping.providerTaxonId);
    const now = this.clock.now();
    if (
      latest !== null &&
      now.getTime() - latest.fetchedAt.getTime() <=
        this.configuration.refetchPolicy.contentFreshForMs
    ) {
      return { outcome: 'contentCurrent', record: latest, mapping };
    }

    const registration = requireRegisteredPlantContentProvider(this.registry, providerKey);
    const quota = await this.providerQuotas.consumeCall(
      registration.metadata.providerKey,
      registration.metadata.quotaLimits,
      now,
    );
    if (!quota.consumed) {
      return degrade(latest, mapping, 'quotaExhausted');
    }

    let call;
    try {
      call = await withDeadline(registration.metadata.fetchTimeoutMs, (signal) =>
        registration.adapter.fetchContent(mapping.providerTaxonId, signal),
      );
    } catch {
      return degrade(latest, mapping, 'providerFailed');
    }
    if (call.kind === 'timedOut') {
      return degrade(latest, mapping, 'providerTimeout');
    }
    if (call.value === null) {
      return degrade(latest, mapping, 'providerReturnedNoData');
    }

    const fetchedAt = this.clock.now();
    let record: PlantContentRecord;
    try {
      record = toPlantContentRecord(call.value, mapping, registration, fetchedAt);
    } catch (error) {
      if (error instanceof ValidationError) {
        // Section 15's "malformed response" case: the provider spoke, but
        // not within the normalized contract. Never persisted, never
        // repaired into plausible-looking content.
        return degrade(latest, mapping, 'providerReturnedInvalidData');
      }
      throw error;
    }

    await this.contentRecords.insert(record);
    return {
      outcome: 'refreshed',
      record,
      mapping,
      contentChanged: latest === null || contentDiffers(latest, record),
    };
  }
}

function degrade(
  storedRecord: PlantContentRecord | null,
  mapping: PlantTaxonomyMapping,
  reason: PlantContentUnavailableReason,
): RefreshPlantContentResult {
  if (storedRecord !== null) {
    return { outcome: 'storedServed', record: storedRecord, mapping, reason };
  }
  return { outcome: 'unavailable', reason };
}

/** What "changed" means for a refetch: the licensed sections, the provider's version marker, or the content language moved. */
function contentDiffers(previous: PlantContentRecord, next: PlantContentRecord): boolean {
  return (
    previous.sections.description !== next.sections.description ||
    previous.sections.careGuidance !== next.sections.careGuidance ||
    previous.source.providerContentVersion !== next.source.providerContentVersion ||
    previous.source.contentLanguage !== next.source.contentLanguage
  );
}

function toPlantContentRecord(
  content: NormalizedPlantContent,
  mapping: PlantTaxonomyMapping,
  registration: PlantContentProviderRegistration,
  fetchedAt: Date,
): PlantContentRecord {
  return createPlantContentRecord({
    id: generateUuidV7(),
    rawProviderKey: registration.metadata.providerKey,
    rawProviderTaxonId: mapping.providerTaxonId,
    source: content.source,
    sections: content.sections,
    fetchedAt,
    rawLicenseNote: registration.metadata.licenseNote,
    attributionText: registration.metadata.attributionText,
    jurisdiction: registration.metadata.jurisdiction,
    rawPresentationNote: registration.metadata.presentationNote,
    now: fetchedAt,
  });
}
