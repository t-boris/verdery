import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  RevisionJournalEntry,
  RevisionJournalWriter,
} from '../application/revision-journal-writer.js';
import { geometryToGeoJsonInsertExpression } from './postgis-geometry.js';

export class KyselyRevisionJournalWriter implements RevisionJournalWriter {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async record(entry: RevisionJournalEntry): Promise<void> {
    await this.db
      .insertInto('gardens_mapping.garden_object_revision')
      .values({
        garden_object_id: entry.gardenObjectId,
        revision: entry.revision,
        command_type: entry.commandType,
        geometry:
          entry.geometry === null ? null : geometryToGeoJsonInsertExpression(entry.geometry),
        label: entry.label,
        lifecycle_state: entry.lifecycleState,
        actor_profile_id: entry.actorProfileId,
      })
      .execute();
  }
}
