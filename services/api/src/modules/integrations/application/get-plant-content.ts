/**
 * Reads the latest stored plant content for one stable application taxonomy
 * reference — the surface a future guide/content stage (or the rule
 * engine's future content-aware rules) will consume, shaped like
 * `GetGardenWeather`: read-only, no provider call ever (refreshing is
 * exclusively `RefreshPlantContent`'s job), absence is a typed outcome.
 *
 * Provenance labeling is the result's structure, not a convention: an
 * `available` outcome carries the full mapping (the provider's taxon
 * identity, its match confidence, and its verification state — an
 * `unverified` identity claim SAYS so) and the full record (provider key,
 * license, attribution, jurisdiction, allowed presentation behavior, fetch
 * time). Any future read that places this next to user-declared plant facts
 * must carry these fields through — external content is never presentable
 * as something the user said ("User garden facts" vs "Licensed
 * descriptions", section 8's separation).
 *
 * With zero providers configured (today's reality) every read is the typed
 * `noProviderConfigured` outcome. No authorization here, deliberately: no
 * user-facing transport exposes plant content this phase — the stage that
 * first exposes it to an actor adds authorization with its surface.
 *
 * Source: architecture/external-integrations.md, sections "8. Plant
 * Content" and "16. Completion Criteria" ("Provider content retains source
 * and license metadata").
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantContentRecord } from '../domain/plant-content-record.js';
import type { PlantTaxonomyMapping } from '../domain/plant-taxonomy-mapping.js';
import type { PlantContentRecordRepository } from './plant-content-record-repository.js';
import type { PlantTaxonomyMappingRepository } from './plant-taxonomy-mapping-repository.js';

export interface GetPlantContentInput {
  readonly taxonomyReferenceId: Uuid;
}

/** Why no content is readable. Distinct values because the consumer's honest message differs for each. */
export type PlantContentAbsenceReason =
  'noProviderConfigured' | 'taxonomyNotMapped' | 'noContentStored';

export type GetPlantContentResult =
  | {
      readonly outcome: 'available';
      readonly mapping: PlantTaxonomyMapping;
      readonly record: PlantContentRecord;
    }
  | { readonly outcome: 'noContent'; readonly reason: PlantContentAbsenceReason };

export class GetPlantContent {
  constructor(
    private readonly activeProviderKey: string | null,
    private readonly mappings: PlantTaxonomyMappingRepository,
    private readonly contentRecords: PlantContentRecordRepository,
  ) {}

  async execute(input: GetPlantContentInput): Promise<GetPlantContentResult> {
    if (this.activeProviderKey === null) {
      return { outcome: 'noContent', reason: 'noProviderConfigured' };
    }

    const mapping = await this.mappings.findLive(this.activeProviderKey, input.taxonomyReferenceId);
    if (mapping === null) {
      // Also the after-rejection state: content rows may still exist under
      // the provider's taxon id, but with no live identity mapping they no
      // longer speak about this reference — rejected identity claims stop
      // resolving, they are never silently re-pointed.
      return { outcome: 'noContent', reason: 'taxonomyNotMapped' };
    }

    const record = await this.contentRecords.findLatest(
      this.activeProviderKey,
      mapping.providerTaxonId,
    );
    if (record === null) {
      return { outcome: 'noContent', reason: 'noContentStored' };
    }
    return { outcome: 'available', mapping, record };
  }
}
