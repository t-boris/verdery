import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { QuotaReservationRepository } from '../application/quota-reservation-repository.js';
import type {
  QuotaReservation,
  QuotaReservationScopeKind,
  QuotaReservationState,
} from '../domain/quota-reservation.js';

interface QuotaReservationRowLike {
  id: string;
  scope_kind: string;
  scope_garden_id: string | null;
  scope_profile_id: string | null;
  media_id: string;
  reserved_bytes: number;
  state: string;
  created_at: Date;
  updated_at: Date;
}

function toQuotaReservation(row: QuotaReservationRowLike): QuotaReservation {
  return {
    id: row.id,
    scopeKind: row.scope_kind as QuotaReservationScopeKind,
    scopeGardenId: row.scope_garden_id,
    scopeProfileId: row.scope_profile_id,
    mediaId: row.media_id,
    reservedBytes: row.reserved_bytes,
    state: row.state as QuotaReservationState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyQuotaReservationRepository implements QuotaReservationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(reservation: QuotaReservation): Promise<void> {
    await this.db
      .insertInto('media.quota_reservation')
      .values({
        id: reservation.id,
        scope_kind: reservation.scopeKind,
        scope_garden_id: reservation.scopeGardenId,
        scope_profile_id: reservation.scopeProfileId,
        media_id: reservation.mediaId,
        reserved_bytes: reservation.reservedBytes,
        state: reservation.state,
        created_at: reservation.createdAt,
        updated_at: reservation.updatedAt,
      })
      .execute();
  }

  async findByMediaId(mediaId: Uuid): Promise<QuotaReservation | null> {
    const row = await this.db
      .selectFrom('media.quota_reservation')
      .selectAll()
      .where('media_id', '=', mediaId)
      .executeTakeFirst();

    return row === undefined ? null : toQuotaReservation(row);
  }

  async updateState(reservation: QuotaReservation): Promise<void> {
    await this.db
      .updateTable('media.quota_reservation')
      .set({ state: reservation.state, updated_at: reservation.updatedAt })
      .where('id', '=', reservation.id)
      .execute();
  }
}
