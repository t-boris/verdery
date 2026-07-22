import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRepository } from './garden-repository.js';
import { toGardenResource } from './garden-view.js';

export interface GardenListResult {
  readonly items: readonly GardenResource[];
  readonly nextCursor: string | null;
}

export class ListGardens {
  constructor(private readonly gardens: GardenRepository) {}

  async execute(profileId: Uuid, cursor: string | null, limit: number): Promise<GardenListResult> {
    const page = await this.gardens.listForProfile(profileId, cursor, limit);

    return {
      items: page.items.map((garden) => toGardenResource(garden, garden.callerRole)),
      nextCursor: page.nextCursor,
    };
  }
}
