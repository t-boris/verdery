import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  IncomingOwnershipTransfer,
  OwnershipTransferRepository,
} from '../application/ownership-transfer-repository.js';
import type {
  OwnershipTransfer,
  OwnershipTransferResultingRole,
  OwnershipTransferState,
} from '../domain/ownership-transfer.js';

interface OwnershipTransferRowShape {
  id: string;
  garden_id: string;
  from_profile_id: string;
  to_profile_id: string;
  from_resulting_role: string;
  state: string;
  authenticated_at: Date;
  requested_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

function toOwnershipTransfer(row: OwnershipTransferRowShape): OwnershipTransfer {
  return {
    id: row.id,
    gardenId: row.garden_id,
    fromProfileId: row.from_profile_id,
    toProfileId: row.to_profile_id,
    fromResultingRole: row.from_resulting_role as OwnershipTransferResultingRole,
    state: row.state as OwnershipTransferState,
    authenticatedAt: row.authenticated_at,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
  };
}

interface IncomingOwnershipTransferRowShape extends OwnershipTransferRowShape {
  garden_name: string;
}

function toIncomingOwnershipTransfer(
  row: IncomingOwnershipTransferRowShape,
): IncomingOwnershipTransfer {
  return { ...toOwnershipTransfer(row), gardenName: row.garden_name };
}

export class KyselyOwnershipTransferRepository implements OwnershipTransferRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insertPending(transfer: OwnershipTransfer): Promise<void> {
    await this.db
      .insertInto('collaboration.ownership_transfer')
      .values({
        id: transfer.id,
        garden_id: transfer.gardenId,
        from_profile_id: transfer.fromProfileId,
        to_profile_id: transfer.toProfileId,
        from_resulting_role: transfer.fromResultingRole,
        state: transfer.state,
        authenticated_at: transfer.authenticatedAt,
        requested_at: transfer.requestedAt,
        completed_at: transfer.completedAt,
        cancelled_at: transfer.cancelledAt,
        cancellation_reason: transfer.cancellationReason,
      })
      .execute();
  }

  async findPendingForGarden(gardenId: Uuid): Promise<OwnershipTransfer | null> {
    const row = await this.db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('state', '=', 'pending')
      .executeTakeFirst();

    return row === undefined ? null : toOwnershipTransfer(row);
  }

  async lockPendingForGarden(gardenId: Uuid): Promise<OwnershipTransfer | null> {
    const row = await this.db
      .selectFrom('collaboration.ownership_transfer')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .where('state', '=', 'pending')
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? null : toOwnershipTransfer(row);
  }

  async update(transfer: OwnershipTransfer): Promise<void> {
    await this.db
      .updateTable('collaboration.ownership_transfer')
      .set({
        state: transfer.state,
        completed_at: transfer.completedAt,
        cancelled_at: transfer.cancelledAt,
        cancellation_reason: transfer.cancellationReason,
      })
      .where('id', '=', transfer.id)
      .execute();
  }

  async listIncomingForProfile(profileId: Uuid): Promise<readonly IncomingOwnershipTransfer[]> {
    const rows = await this.db
      .selectFrom('collaboration.ownership_transfer as ot')
      .innerJoin('gardens_mapping.garden as g', 'g.id', 'ot.garden_id')
      .select([
        'ot.id',
        'ot.garden_id',
        'ot.from_profile_id',
        'ot.to_profile_id',
        'ot.from_resulting_role',
        'ot.state',
        'ot.authenticated_at',
        'ot.requested_at',
        'ot.completed_at',
        'ot.cancelled_at',
        'ot.cancellation_reason',
        'g.name as garden_name',
      ])
      .where('ot.to_profile_id', '=', profileId)
      .where('ot.state', '=', 'pending')
      .orderBy('ot.requested_at', 'desc')
      .orderBy('ot.id', 'desc')
      .execute();

    return rows.map(toIncomingOwnershipTransfer);
  }
}
