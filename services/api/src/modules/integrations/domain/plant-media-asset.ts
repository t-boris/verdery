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

/** Why an asset is not presentable — see `presentationIneligibility`. */
export type PlantMediaIneligibility =
  | 'non_commercial'
  | 'share_alike_pending_compliance_design'
  | 'license_unknown'
  | 'withdrawn'
  | 'rights_holder_absent';

/** ADR-0016's frozen allowlist. `cc_by_sa` is deliberately absent — it needs an approved compliance design before eligibility, not a blanket yes or no. */
const PRESENTATION_ELIGIBLE_LICENSES: ReadonlySet<PlantMediaLicense> = new Set([
  'public_domain',
  'cc0',
  'cc_by',
]);

export function isLicenseEligibleForPresentation(license: PlantMediaLicense): boolean {
  return PRESENTATION_ELIGIBLE_LICENSES.has(license);
}

/**
 * Why an asset may not be presented, or `null` when it may be.
 *
 * Refines `isLicenseEligibleForPresentation` with the condition that
 * function cannot see: CC-BY grants use ON CONDITION of attribution, so an
 * asset licensed CC-BY with no readable rights holder may not be shown
 * either — displaying an image this application cannot credit would breach
 * the licence that permitted it.
 *
 * The reason is typed rather than collapsed into one "no" because the
 * responses differ: `share_alike_pending_compliance_design` is expected to
 * reverse once that design exists, `non_commercial` never will, and
 * `license_unknown` says to go back to the source.
 */
export function presentationIneligibility(
  license: PlantMediaLicense,
  rightsHolder: string | null,
): PlantMediaIneligibility | null {
  if (license === 'cc_by_nc') {
    return 'non_commercial';
  }
  if (license === 'cc_by_sa') {
    return 'share_alike_pending_compliance_design';
  }
  if (license === 'withdrawn') {
    return 'withdrawn';
  }
  if (!isLicenseEligibleForPresentation(license)) {
    return 'license_unknown';
  }
  if (license === 'cc_by' && (rightsHolder === null || rightsHolder.trim() === '')) {
    return 'rights_holder_absent';
  }
  return null;
}

/**
 * A provider's own licence string mapped onto this vocabulary.
 *
 * `createPlantMediaAsset` requires a value already in the vocabulary; this
 * is what turns GBIF's `http://creativecommons.org/licenses/by-nc/4.0/`
 * into one. Anything unrecognised becomes `unknown`, which is stored
 * honestly and then found ineligible above — never silently dropped, so
 * "how many assets did we refuse, and why" stays answerable.
 */
export function parseProviderLicense(rawLicense: string | null | undefined): PlantMediaLicense {
  if (typeof rawLicense !== 'string' || rawLicense.trim() === '') {
    return 'unknown';
  }

  const normalized = rawLicense
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

  // Order matters: `by-nc-sa` carries both conditions, and the stricter one
  // decides — reading it as ShareAlike would file the refusal under a reason
  // that is expected to reverse.
  if (normalized.includes('/by-nc') || normalized.startsWith('cc-by-nc')) {
    return 'cc_by_nc';
  }
  if (normalized.includes('/by-sa') || normalized.startsWith('cc-by-sa')) {
    return 'cc_by_sa';
  }
  if (normalized.includes('publicdomain/zero') || normalized.startsWith('cc0')) {
    return 'cc0';
  }
  if (normalized.includes('publicdomain/mark') || normalized === 'public-domain') {
    return 'public_domain';
  }
  if (normalized.includes('/licenses/by/') || normalized.startsWith('cc-by')) {
    return 'cc_by';
  }

  return 'unknown';
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
