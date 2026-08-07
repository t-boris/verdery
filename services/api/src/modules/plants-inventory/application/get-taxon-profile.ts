/**
 * Read-only lookup for a taxon's latest materialized knowledge profile
 * (`plant-profile-version.ts`) — a shared reference resource, not garden-
 * scoped, the same "no per-garden authorization" posture
 * `SearchTaxonomyReferences` already takes for the identical reason: this
 * is catalog content, not a user's own garden data.
 *
 * Reviewed/source-backed facts and licensed imagery have independent
 * lifecycles. A first read warms both through `TaxonProfileEnricher`, then
 * re-reads the stored projection and imagery so a user does not have to wait
 * for an unrelated scheduled sweep.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantProfileVersionRepository } from './plant-profile-version-repository.js';
import type { PlantProfileVersion } from '../domain/plant-profile-version.js';
import type { TaxonImage, TaxonImageSource } from './taxon-image-source.js';
import type { TaxonProfileEnricher } from './taxon-profile-enricher.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';
import {
  toTaxonomyReferenceResource,
  type TaxonomyReferenceResource,
} from './taxonomy-reference-view.js';
import { taxonomyReferenceNotFoundError } from './plant-errors.js';

/** The read: the stored projection plus the imagery permitted to accompany it. */
export interface PlantTaxonProfileResult {
  readonly taxonomyReference: TaxonomyReferenceResource;
  readonly profile: PlantProfileVersion | null;
  readonly images: readonly TaxonImage[];
}

/**
 * How many images accompany one profile.
 *
 * A profile page shows a handful; sending every asset a source ever offered
 * would be a large response nobody reads. Named rather than inlined because
 * it is a product judgement about a page, not a query detail.
 */
const PROFILE_IMAGE_LIMIT = 8;

export class GetTaxonProfile {
  constructor(
    private readonly taxonomyReferences: TaxonomyReferenceRepository,
    private readonly profileVersions: PlantProfileVersionRepository,
    private readonly images: TaxonImageSource,
    private readonly profileEnricher: TaxonProfileEnricher,
  ) {}

  async execute(taxonomyReferenceId: Uuid): Promise<PlantTaxonProfileResult> {
    const taxonomyReference = await this.taxonomyReferences.findById(taxonomyReferenceId);
    if (taxonomyReference === null) {
      throw taxonomyReferenceNotFoundError();
    }
    let profile = await this.profileVersions.findLatest(taxonomyReferenceId);
    let images = await this.images.listPresentable(taxonomyReferenceId, PROFILE_IMAGE_LIMIT);
    if (profile === null || images.length === 0) {
      await this.profileEnricher.enrich(taxonomyReferenceId);
      profile = await this.profileVersions.findLatest(taxonomyReferenceId);
      images = await this.images.listPresentable(taxonomyReferenceId, PROFILE_IMAGE_LIMIT);
    }

    return {
      taxonomyReference: toTaxonomyReferenceResource(taxonomyReference),
      profile,
      images,
    };
  }
}
