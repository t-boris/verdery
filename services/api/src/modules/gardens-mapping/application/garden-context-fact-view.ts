/**
 * Maps the domain `GardenContextFact` to the contract's `GardenContextFact`
 * resource — the same "domain to wire" split `garden-view.ts`'s
 * `toGardenResource` already establishes for `Garden`.
 */

import type { GardenContextFact as GardenContextFactResource } from '@verdery/api-contracts';
import type { GardenContextFact } from '../domain/garden-context-fact.js';

export function toGardenContextFactResource(fact: GardenContextFact): GardenContextFactResource {
  return {
    id: fact.id,
    gardenId: fact.gardenId,
    contextKind: fact.contextKind,
    value: fact.value,
    source: fact.source,
    ...(fact.source === 'horticulturally_reviewed_default'
      ? { reviewedBy: fact.reviewedBy, reviewedOn: fact.reviewedOn }
      : {}),
    recordedByProfileId: fact.recordedByProfileId,
    recordedAt: fact.recordedAt.toISOString(),
    revision: fact.revision,
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString(),
  };
}
