/**
 * A licensed image known for a taxon, tracked through discovery -> ingestion
 * (or license rejection) before it becomes a real `media.media_record` the
 * rest of the application can reference — the media gap
 * `plant-content-record.ts`'s own header names as "a documented deferral,
 * not modeled empty".
 *
 * License eligibility for PRESENTATION is deliberately an application-layer
 * decision (`isLicenseEligibleForPresentation`), not a database CHECK: ADR-
 * 0016 froze today's allowlist (Public Domain/CC0/CC BY eligible now, CC
 * BY-SA needs a compliance design, CC BY-NC/unknown/withdrawn never
 * eligible), but that policy can be revisited without a schema migration —
 * the column records what the source actually claims, unconditionally.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql,
 * `integrations.plant_media_asset`;
 * architecture/plant-intelligence-and-visual-journal.md, section
 * "7. Life Cycle and Representative Media";
 * architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type PlantMediaOrgan =
  | 'seed'
  | 'seedling'
  | 'juvenile'
  | 'mature_habit'
  | 'leaf'
  | 'stem_or_bark'
  | 'bud'
  | 'flowering'
  | 'fruiting'
  | 'seed_production'
  | 'senescent'
  | 'dormant'
  | 'natural_habitat';

const PLANT_MEDIA_ORGANS: readonly PlantMediaOrgan[] = [
  'seed',
  'seedling',
  'juvenile',
  'mature_habit',
  'leaf',
  'stem_or_bark',
  'bud',
  'flowering',
  'fruiting',
  'seed_production',
  'senescent',
  'dormant',
  'natural_habitat',
];

export type PlantMediaLicense =
  'public_domain' | 'cc0' | 'cc_by' | 'cc_by_sa' | 'cc_by_nc' | 'unknown' | 'withdrawn';

const PLANT_MEDIA_LICENSES: readonly PlantMediaLicense[] = [
  'public_domain',
  'cc0',
  'cc_by',
  'cc_by_sa',
  'cc_by_nc',
  'unknown',
  'withdrawn',
];

export type PlantMediaIngestionState = 'discovered' | 'rejected' | 'ingested';

/** ADR-0016's frozen allowlist. `cc_by_sa` is deliberately absent — it needs an approved compliance design before eligibility, not a blanket yes or no. */
const PRESENTATION_ELIGIBLE_LICENSES: ReadonlySet<PlantMediaLicense> = new Set([
  'public_domain',
  'cc0',
  'cc_by',
]);

export function isLicenseEligibleForPresentation(license: PlantMediaLicense): boolean {
  return PRESENTATION_ELIGIBLE_LICENSES.has(license);
}

export interface PlantMediaAsset {
  readonly id: Uuid;
  readonly providerTaxonId: string;
  readonly mediaId: Uuid | null;
  readonly sourceUrl: string | null;
  readonly organ: PlantMediaOrgan | null;
  readonly inferredOrgan: boolean;
  readonly license: PlantMediaLicense;
  readonly attributionText: string | null;
  readonly creator: string | null;
  readonly rightsHolder: string | null;
  readonly observedAt: Date | null;
  readonly generalizedLocation: string | null;
  readonly ingestionState: PlantMediaIngestionState;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export interface CreatePlantMediaAssetInput {
  readonly id: Uuid;
  readonly rawProviderTaxonId: string;
  readonly mediaId: Uuid | null;
  readonly sourceUrl: string | null;
  readonly organ: PlantMediaOrgan | null;
  readonly inferredOrgan: boolean;
  readonly rawLicense: string;
  readonly attributionText: string | null;
  readonly creator: string | null;
  readonly rightsHolder: string | null;
  readonly observedAt: Date | null;
  readonly generalizedLocation: string | null;
  readonly ingestionState: PlantMediaIngestionState;
  readonly now: Date;
}

export function createPlantMediaAsset(input: CreatePlantMediaAssetInput): PlantMediaAsset {
  const providerTaxonId = input.rawProviderTaxonId.trim();
  if (providerTaxonId.length === 0) {
    throw invalid(
      'providerTaxonId must not be blank.',
      'integrations.plant_media_asset.provider_taxon_id.blank',
      '/providerTaxonId',
    );
  }

  if (input.mediaId === null && (input.sourceUrl === null || input.sourceUrl.trim().length === 0)) {
    throw invalid(
      'Either mediaId or sourceUrl must be present.',
      'integrations.plant_media_asset.source.missing',
      '/sourceUrl',
    );
  }

  if (input.organ !== null && !PLANT_MEDIA_ORGANS.includes(input.organ)) {
    throw invalid(
      `organ must be one of: ${PLANT_MEDIA_ORGANS.join(', ')}.`,
      'integrations.plant_media_asset.organ.invalid',
      '/organ',
    );
  }

  if (!PLANT_MEDIA_LICENSES.includes(input.rawLicense as PlantMediaLicense)) {
    throw invalid(
      `license must be one of: ${PLANT_MEDIA_LICENSES.join(', ')}.`,
      'integrations.plant_media_asset.license.invalid',
      '/license',
    );
  }

  if (input.ingestionState === 'ingested' && input.mediaId === null) {
    throw invalid(
      "ingestionState 'ingested' requires mediaId.",
      'integrations.plant_media_asset.ingestion_linkage.invalid',
      '/mediaId',
    );
  }

  return {
    id: input.id,
    providerTaxonId,
    mediaId: input.mediaId,
    sourceUrl: input.sourceUrl,
    organ: input.organ,
    inferredOrgan: input.inferredOrgan,
    license: input.rawLicense as PlantMediaLicense,
    attributionText: input.attributionText,
    creator: input.creator,
    rightsHolder: input.rightsHolder,
    observedAt: input.observedAt,
    generalizedLocation: input.generalizedLocation,
    ingestionState: input.ingestionState,
    createdAt: input.now,
  };
}
