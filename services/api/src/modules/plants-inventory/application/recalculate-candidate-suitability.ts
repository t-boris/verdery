/**
 * Recalculates and persists a candidate's suitability assessment — the
 * storage-to-domain-to-storage round trip for the pure
 * `evaluateCandidateSuitability` engine, the same role
 * `RebuildPlantProfileVersion` plays for taxon profiles.
 *
 * Assembles `GardenSuitabilityFacts` from `gardens-mapping`'s
 * `GardenContextFactRepository` (read across a module boundary through its
 * exported port, never a direct repository import) and
 * `CandidateSuitabilityFacts` from the candidate's own row, its latest
 * `PlantProfileVersion` (already resolved/reviewed — no re-filtering
 * needed here), and reviewed distribution assertions gathered the same way
 * `RebuildPlantProfileVersion` gathers fact assertions: every provider
 * named in `sourcePriority` with a live taxonomy mapping, plus the
 * `'human'` sentinel unconditionally.
 *
 * A candidate with no identified taxon (`taxonomyReferenceId === null`)
 * still gets a real assessment — every profile/distribution-dependent
 * finding degrades to `unknown`, never an error, matching "unknown and
 * partially identified actual plants remain valid" applied to candidates.
 *
 * Always persists a new row: unlike `RebuildPlantProfileVersion` (which
 * skips persisting an empty result), an assessment with only `unknown`
 * findings is itself a meaningful, real result — "no axis could be
 * evaluated yet" is worth recording, not silently dropped.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenAuthorization,
  GardenContextFactRepository,
} from '../../gardens-mapping/public.js';
import type {
  PlantDistributionAssertionRepository,
  PlantTaxonomyMappingRepository,
} from '../../integrations/public.js';
import type { CandidateSuitabilityAssessmentRepository } from './candidate-suitability-assessment-repository.js';
import { candidateNotFoundError } from './candidate-errors.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { PlantProfileVersionRepository } from './plant-profile-version-repository.js';
import { evaluateCandidateSuitability } from '../domain/evaluate-candidate-suitability.js';
import type { SuitabilityRuleCatalog } from '../domain/suitability-rule-catalog.js';
import type {
  CandidateDistributionFact,
  CandidateSuitabilityFacts,
} from '../domain/suitability-facts.js';
import type { SuitabilityAssessmentResult } from '../domain/suitability-finding.js';

const HUMAN_PROVIDER_KEY = 'human';

export class RecalculateCandidateSuitability {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly gardenContextFacts: GardenContextFactRepository,
    private readonly profileVersions: PlantProfileVersionRepository,
    private readonly mappings: PlantTaxonomyMappingRepository,
    private readonly distributionAssertions: PlantDistributionAssertionRepository,
    private readonly assessments: CandidateSuitabilityAssessmentRepository,
    private readonly catalog: SuitabilityRuleCatalog,
    private readonly authorization: GardenAuthorization,
    private readonly generateId: () => Uuid,
    private readonly sourcePriority: readonly string[],
  ) {}

  async execute(candidateId: Uuid, profileId: Uuid): Promise<SuitabilityAssessmentResult> {
    const candidate = await this.candidates.findById(candidateId);
    if (candidate === null) {
      throw candidateNotFoundError();
    }
    await this.authorization.requireCapability(candidate.gardenId, profileId, 'viewGarden');

    const gardenFacts = await this.gardenContextFacts.listForGarden(candidate.gardenId);
    const sunExposureFact = gardenFacts.find((fact) => fact.contextKind === 'sun_exposure');
    const drainageFact = gardenFacts.find((fact) => fact.contextKind === 'drainage');
    const growingContextFact = gardenFacts.find((fact) => fact.contextKind === 'growing_context');

    const garden = {
      gardenId: candidate.gardenId,
      sunExposure: sunExposureFact?.contextKind === 'sun_exposure' ? sunExposureFact.value : null,
      drainage: drainageFact?.contextKind === 'drainage' ? drainageFact.value : null,
      growingContext:
        growingContextFact?.contextKind === 'growing_context' ? growingContextFact.value : null,
      region: null,
    };

    const profileFacts =
      candidate.taxonomyReferenceId === null
        ? null
        : ((await this.profileVersions.findLatest(candidate.taxonomyReferenceId))?.resolvedFacts
            .filter((fact) => fact.evidenceStatus === 'horticulturally_reviewed')
            .map((fact) => ({
              factKey: fact.factKey,
              value: fact.value,
              sourceCitation: fact.sourceCitation,
            })) ?? null);

    const distributionFacts: CandidateDistributionFact[] = [];
    if (candidate.taxonomyReferenceId !== null) {
      for (const providerKey of [...this.sourcePriority, HUMAN_PROVIDER_KEY]) {
        const providerTaxonId =
          providerKey === HUMAN_PROVIDER_KEY
            ? candidate.taxonomyReferenceId
            : (await this.mappings.findLive(providerKey, candidate.taxonomyReferenceId))
                ?.providerTaxonId;
        if (providerTaxonId === undefined) {
          continue;
        }
        const assertions = await this.distributionAssertions.findAllForProviderTaxon(
          providerKey,
          providerTaxonId,
        );
        for (const assertion of assertions) {
          if (assertion.provenance.reviewStatus !== 'horticulturally_reviewed') {
            continue;
          }
          distributionFacts.push({
            region: assertion.region,
            status: assertion.status,
            sourceCitation:
              assertion.provenance.authoringMethod === 'ai_extracted_from_source'
                ? assertion.provenance.sourceCitation
                : null,
          });
        }
      }
    }

    const candidateFacts: CandidateSuitabilityFacts = {
      candidateId: candidate.id,
      groupingKind: candidate.groupingKind,
      quantity: candidate.quantity,
      profileFacts,
      distributionFacts,
    };

    const result = evaluateCandidateSuitability(
      candidate.id,
      this.catalog.activeRules(),
      garden,
      candidateFacts,
    );

    await this.assessments.insert(this.generateId(), result);
    return result;
  }
}
