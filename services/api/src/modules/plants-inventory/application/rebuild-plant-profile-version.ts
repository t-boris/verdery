/**
 * Rebuilds a taxon's materialized profile version from every reviewed fact
 * assertion currently on record — the storage-to-domain-to-storage round
 * trip `plant-profile-version.ts`'s own header describes as a future
 * application command's job. No HTTP transport and no scheduling here: this
 * is the pure "given what is stored today, produce one version" operation
 * `P11-ASYNC-01`'s job scheduler will call repeatedly; triggering it
 * automatically after an enrichment fetch is that later work package's
 * concern, not this one's.
 *
 * Gathers candidates from two places: every provider named in
 * `sourcePriority` that has a LIVE `PlantTaxonomyMapping` for this taxon
 * (skipped silently when no mapping exists — the same "capability is
 * honestly off" posture `RefreshPlantContent` uses for an unmapped taxon),
 * plus the reserved `provider_key = 'human'` identity every human-authored
 * assertion uses directly (no mapping exists for content this project
 * authored itself — see the migration's own header).
 *
 * `sourcePriority` is a caller-supplied, ordered provider-key list — a
 * POLICY PARAMETER passed straight through to `assemblePlantProfileVersion`,
 * not a hardcoded table; see that function's own header for why.
 *
 * Persists a new version only when at least one fact actually resolved —
 * `plant_profile_version_resolved_not_empty_check` would reject an empty
 * one anyway, and "nothing to persist yet" is itself useful, honestly
 * reported information for the caller.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PlantFactAssertionRepository,
  PlantTaxonomyMappingRepository,
} from '../../integrations/public.js';
import type { FactCandidate } from '../domain/plant-profile-version.js';
import { assemblePlantProfileVersion } from '../domain/plant-profile-version.js';
import type { PlantProfileVersion } from '../domain/plant-profile-version.js';
import type { PlantProfileVersionRepository } from './plant-profile-version-repository.js';

const HUMAN_PROVIDER_KEY = 'human';

export type RebuildPlantProfileVersionResult =
  | { readonly outcome: 'rebuilt'; readonly version: PlantProfileVersion }
  | { readonly outcome: 'nothingToResolve' };

export class RebuildPlantProfileVersion {
  constructor(
    private readonly mappings: PlantTaxonomyMappingRepository,
    private readonly facts: PlantFactAssertionRepository,
    private readonly profileVersions: PlantProfileVersionRepository,
    private readonly generateId: () => Uuid,
    private readonly clock: { now(): Date },
  ) {}

  async execute(
    taxonomyReferenceId: Uuid,
    sourcePriority: readonly string[],
  ): Promise<RebuildPlantProfileVersionResult> {
    const candidates: FactCandidate[] = [];

    for (const providerKey of [...sourcePriority, HUMAN_PROVIDER_KEY]) {
      const providerTaxonId =
        providerKey === HUMAN_PROVIDER_KEY
          ? taxonomyReferenceId
          : (await this.mappings.findLive(providerKey, taxonomyReferenceId))?.providerTaxonId;
      if (providerTaxonId === undefined) {
        continue;
      }

      const assertions = await this.facts.findAllForProviderTaxon(providerKey, providerTaxonId);
      for (const assertion of assertions) {
        candidates.push({
          factKey: assertion.factKey,
          value: assertion.factValue,
          unit: assertion.unit,
          geographicScope: assertion.geographicScope,
          providerKey: assertion.provenance.providerKey,
          confidence: assertion.confidence,
          reviewStatus: assertion.provenance.reviewStatus,
          sourceCitation:
            assertion.provenance.authoringMethod === 'ai_extracted_from_source'
              ? assertion.provenance.sourceCitation
              : null,
          fetchedAt: assertion.fetchedAt,
        });
      }
    }

    const now = this.clock.now();
    const version = assemblePlantProfileVersion(
      this.generateId(),
      taxonomyReferenceId,
      { facts: candidates, sourcePriority },
      now,
    );

    if (version.resolvedFacts.length === 0) {
      return { outcome: 'nothingToResolve' };
    }

    await this.profileVersions.insert(version);
    return { outcome: 'rebuilt', version };
  }
}
