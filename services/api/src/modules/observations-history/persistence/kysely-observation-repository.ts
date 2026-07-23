import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ObservationHistoryEntry,
  ObservationRepository,
} from '../application/observation-repository.js';
import type {
  Observation,
  ObservationActorType,
  ObservationCorrectionKind,
} from '../domain/observation.js';
import { attachHistoryDetails } from './observation-history-details.js';

interface ObservationRowLike {
  id: string;
  garden_id: string;
  plant_id: string | null;
  garden_object_id: string | null;
  actor_type: string;
  created_by_profile_id: string | null;
  note_text: string | null;
  condition_summary: string | null;
  correction_kind: string | null;
  corrects_observation_id: string | null;
  observed_at: Date;
  recorded_at: Date;
}

function toObservation(row: ObservationRowLike): Observation {
  return {
    id: row.id,
    gardenId: row.garden_id,
    plantId: row.plant_id,
    gardenObjectId: row.garden_object_id,
    actorType: row.actor_type as ObservationActorType,
    createdByProfileId: row.created_by_profile_id,
    noteText: row.note_text,
    conditionSummary: row.condition_summary,
    correctionKind: row.correction_kind as ObservationCorrectionKind | null,
    correctsObservationId: row.corrects_observation_id,
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
  };
}

export class KyselyObservationRepository implements ObservationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(observation: Observation): Promise<void> {
    await this.db
      .insertInto('observations_history.observation')
      .values({
        id: observation.id,
        garden_id: observation.gardenId,
        plant_id: observation.plantId,
        garden_object_id: observation.gardenObjectId,
        actor_type: observation.actorType,
        created_by_profile_id: observation.createdByProfileId,
        note_text: observation.noteText,
        condition_summary: observation.conditionSummary,
        correction_kind: observation.correctionKind,
        corrects_observation_id: observation.correctsObservationId,
        observed_at: observation.observedAt,
        recorded_at: observation.recordedAt,
      })
      .execute();
  }

  async get(id: Uuid): Promise<Observation | null> {
    const row = await this.db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toObservation(row);
  }

  async getWithHistory(id: Uuid): Promise<ObservationHistoryEntry | null> {
    const observation = await this.get(id);
    if (observation === null) {
      return null;
    }

    const [entry] = await attachHistoryDetails(this.db, [observation]);
    return entry ?? null;
  }

  async listForGarden(gardenId: Uuid): Promise<ObservationHistoryEntry[]> {
    const rows = await this.db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .orderBy('observed_at', 'desc')
      .execute();

    return attachHistoryDetails(this.db, rows.map(toObservation));
  }

  async listForPlant(gardenId: Uuid, plantId: Uuid): Promise<ObservationHistoryEntry[]> {
    const rows = await this.db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('plant_id', '=', plantId)
      .orderBy('observed_at', 'desc')
      .execute();

    return attachHistoryDetails(this.db, rows.map(toObservation));
  }
}
