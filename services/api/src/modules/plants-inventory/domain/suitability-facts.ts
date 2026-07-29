/**
 * Assembled input to the suitability engine — never computed by the engine
 * itself, the same "assembly is the application layer's job, the engine is
 * pure" discipline `GardenFacts` (tasks-recommendations) already
 * established. Every field absent from what this repository can back today
 * is `null`, never a default — "missing facts remain missing" applied here,
 * not re-derived.
 *
 * `GardenSuitabilityFacts.hardinessZone` is always `null` today: no
 * hardiness-fact source is wired yet (`P11-PROV-01`'s runbook records the
 * real USDA hardiness-raster source; `P11-ASYNC-01`/a later work package
 * builds the adapter). The field exists so the hardiness rule can be
 * written NOW against its real shape, honestly returning `unknown` until
 * that source ships — the same "no field for what nothing can populate"
 * rule applied to a field that DOES exist, because its rule is real even
 * though its data source is not yet.
 *
 * `region` is always `null` today: no garden-to-US-region resolution exists
 * (no geocoding, no state field on `gardens_mapping.garden`) — the
 * regulatory-status rule degrades to a garden-independent check rather than
 * a region-matched one until that exists; see that rule's own header.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  DrainageValue,
  GrowingContextValue,
  SunExposureValue,
} from '../../gardens-mapping/public.js';
import type { GroupingKind } from './plant.js';
import type { DistributionStatus } from '../../integrations/public.js';

export interface GardenSuitabilityFacts {
  readonly gardenId: Uuid;
  readonly sunExposure: SunExposureValue | null;
  readonly drainage: DrainageValue | null;
  readonly growingContext: GrowingContextValue | null;
  /** A US region/state code, for regulatory-status matching — always `null` until a garden-to-region resolution exists. See this file's own header. */
  readonly region: string | null;
}

/** One resolved plant-profile fact the candidate's taxon carries — the shape `PlantProfileVersion.resolvedFacts` already assembles (`plant-profile-version.ts`), passed through unchanged rather than re-resolved. */
export interface CandidateProfileFact {
  readonly factKey: string;
  readonly value: unknown;
  readonly sourceCitation: string | null;
}

/** One resolved distribution/regulatory claim for the candidate's taxon, across whichever regions have reviewed assertions on record. */
export interface CandidateDistributionFact {
  readonly region: string;
  readonly status: DistributionStatus;
  readonly sourceCitation: string | null;
}

export interface CandidateSuitabilityFacts {
  readonly candidateId: Uuid;
  readonly groupingKind: GroupingKind;
  readonly quantity: number | null;
  /** `null` when the candidate's taxon is unknown/unidentified, or no profile has ever been assembled for it — both are legitimate, honest states, not errors. */
  readonly profileFacts: readonly CandidateProfileFact[] | null;
  readonly distributionFacts: readonly CandidateDistributionFact[];
}
