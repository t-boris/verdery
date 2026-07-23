import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantOwnershipRepository } from '../application/plant-ownership-repository.js';

export class KyselyPlantOwnershipRepository implements PlantOwnershipRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findGardenId(plantId: Uuid): Promise<Uuid | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant')
      .select('garden_id')
      .where('id', '=', plantId)
      .executeTakeFirst();

    return row === undefined ? null : row.garden_id;
  }
}
