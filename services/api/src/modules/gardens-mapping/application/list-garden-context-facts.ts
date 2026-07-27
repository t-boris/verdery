/**
 * Reads every garden context fact currently recorded for a garden
 * (P9D-CONTEXT-01) — `GET /gardens/{gardenId}/context`.
 *
 * `viewGarden` is the capability every garden member holds, matching
 * `GetCalibration`'s/`GetGardenMap`'s own read-path posture: any member
 * with garden read access may see the declared context facts, regardless
 * of whether they can edit them.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenContextFact } from '../domain/garden-context-fact.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardenContextFactRepository } from './garden-context-fact-repository.js';

export class ListGardenContextFacts {
  constructor(
    private readonly authorization: GardenAuthorization,
    private readonly facts: GardenContextFactRepository,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<readonly GardenContextFact[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    return this.facts.listForGarden(gardenId);
  }
}
