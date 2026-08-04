/**
 * Read-only lookup for a taxon's latest materialized knowledge profile
 * (`plant-profile-version.ts`) — a shared reference resource, not garden-
 * scoped, the same "no per-garden authorization" posture
 * `SearchTaxonomyReferences` already takes for the identical reason: this
 * is catalog content, not a user's own garden data.
 *
 * An honest 404 when no version has ever been assembled — never a
 * fabricated empty profile. `RebuildPlantProfileVersion` is what produces
 * one.
 */

import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantProfileVersionRepository } from './plant-profile-version-repository.js';
import type { PlantProfileVersion } from '../domain/plant-profile-version.js';
import type { TaxonImage, TaxonImageSource } from './taxon-image-source.js';

/** The read: the stored projection plus the imagery permitted to accompany it. */
export interface PlantTaxonProfileResult {
  readonly profile: PlantProfileVersion;
  readonly images: readonly TaxonImage[];
}

const TAXON_PROFILE_NOT_FOUND_CODE = 'plants_inventory.plant_profile_version.not_found';

export function taxonProfileNotFoundError(): NotFoundError {
  return new NotFoundError(
    TAXON_PROFILE_NOT_FOUND_CODE,
    'No knowledge profile has been assembled for this taxon yet.',
  );
}

/**
 * How many images accompany one profile.
 *
 * A profile page shows a handful; sending every asset a source ever offered
 * would be a large response nobody reads. Named rather than inlined because
 * it is a product judgement about a page, not a query detail.
 */
const PROFILE_IMAGE_LIMIT = 12;

export class GetTaxonProfile {
  constructor(
    private readonly profileVersions: PlantProfileVersionRepository,
    private readonly images: TaxonImageSource,
  ) {}

  async execute(taxonomyReferenceId: Uuid): Promise<PlantTaxonProfileResult> {
    const profile = await this.profileVersions.findLatest(taxonomyReferenceId);
    if (profile === null) {
      throw taxonProfileNotFoundError();
    }

    // Images are read separately rather than stored in the profile: the
    // profile is a materialized projection rebuilt on a schedule, while
    // presentation eligibility is decided per read — so a licence category's
    // standing can change without rebuilding anything.
    const images = await this.images.listPresentable(taxonomyReferenceId, PROFILE_IMAGE_LIMIT);

    return { profile, images };
  }
}
