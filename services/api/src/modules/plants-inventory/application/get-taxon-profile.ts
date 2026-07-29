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

const TAXON_PROFILE_NOT_FOUND_CODE = 'plants_inventory.plant_profile_version.not_found';

export function taxonProfileNotFoundError(): NotFoundError {
  return new NotFoundError(
    TAXON_PROFILE_NOT_FOUND_CODE,
    'No knowledge profile has been assembled for this taxon yet.',
  );
}

export class GetTaxonProfile {
  constructor(private readonly profileVersions: PlantProfileVersionRepository) {}

  async execute(taxonomyReferenceId: Uuid): Promise<PlantProfileVersion> {
    const profile = await this.profileVersions.findLatest(taxonomyReferenceId);
    if (profile === null) {
      throw taxonProfileNotFoundError();
    }
    return profile;
  }
}
