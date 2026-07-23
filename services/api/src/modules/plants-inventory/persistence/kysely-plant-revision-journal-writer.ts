import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  PlantRevisionJournalEntry,
  PlantRevisionJournalWriter,
} from '../application/plant-revision-journal-writer.js';

export class KyselyPlantRevisionJournalWriter implements PlantRevisionJournalWriter {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async record(entry: PlantRevisionJournalEntry): Promise<void> {
    await this.db
      .insertInto('plants_inventory.plant_revision')
      .values({
        plant_id: entry.plantId,
        revision: entry.revision,
        command_type: entry.commandType,
        lifecycle_stage: entry.lifecycleStage,
        status: entry.status,
        actor_profile_id: entry.actorProfileId,
      })
      .execute();
  }
}
