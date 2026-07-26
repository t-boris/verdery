/**
 * Full-stack integration tests for the two ownership-transfer READ endpoints
 * (P9A-OWNER-02): `GetGardenOwnershipTransfer` (garden-scoped) and
 * `ListIncomingOwnershipTransfers` (profile-scoped). Split out from
 * `collaboration-ownership-transfer.test.ts` (the REQUEST/CANCEL side) and
 * `collaboration-ownership-transfer-acceptance.test.ts` (the
 * ACCEPT/DECLINE side) purely to keep every file under the repository's
 * 600-line source-file limit, the same reason those two were already split
 * from each other.
 *
 * Closes the gap two independent client-implementation efforts both hit:
 * before this, the initiating owner had no way to confirm a requested
 * transfer was still pending after a page reload except attempting
 * `CancelOwnershipTransfer` and reading its `404` as "nothing was pending",
 * and the named recipient had no way at all to discover an offer without an
 * out-of-band link from the initiator.
 *
 * Source: implementation-plan.md work package P9A-OWNER-02;
 * architecture/identity-and-authorization.md, section
 * "11. Ownership Transfer".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { GetGardenOwnershipTransfer } from '../../src/modules/gardens-mapping/application/get-garden-ownership-transfer.js';
import { ListIncomingOwnershipTransfers } from '../../src/modules/gardens-mapping/application/list-incoming-ownership-transfers.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { KyselyOwnershipTransferRepository } from '../../src/modules/gardens-mapping/persistence/kysely-ownership-transfer-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  insertGarden,
  insertMembership,
  insertPendingOwnershipTransfer,
  insertProfile,
} from '../support/collaboration-integration-harness.js';

const SUITE_NAME = 'collaboration ownership transfer reads integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function getGardenOwnershipTransferQuery(): GetGardenOwnershipTransfer {
    return new GetGardenOwnershipTransfer(
      new KyselyOwnershipTransferRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
    );
  }

  function listIncomingQuery(): ListIncomingOwnershipTransfers {
    return new ListIncomingOwnershipTransfers(new KyselyOwnershipTransferRepository(db));
  }

  // --- GetGardenOwnershipTransfer ------------------------------------------

  it('the initiating owner reads their own pending transfer', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    const transferId = await insertPendingOwnershipTransfer(db, gardenId, ownerId, targetId);

    const transfer = await getGardenOwnershipTransferQuery().execute(gardenId, ownerId);

    expect(transfer.id).toBe(transferId);
    expect(transfer.state).toBe('pending');
    expect(transfer.fromProfileId).toBe(ownerId);
    expect(transfer.toProfileId).toBe(targetId);
  });

  it('the named recipient reads it too, without holding administerOwnership', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'viewer', JANUARY);
    const transferId = await insertPendingOwnershipTransfer(db, gardenId, ownerId, targetId);

    const transfer = await getGardenOwnershipTransferQuery().execute(gardenId, targetId);

    expect(transfer.id).toBe(transferId);
    expect(transfer.toProfileId).toBe(targetId);
  });

  it('a third party who is neither the owner nor the named recipient gets a concealed 404', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    await insertPendingOwnershipTransfer(db, gardenId, ownerId, targetId);
    const bystanderId = await insertProfile(db);
    await insertMembership(db, gardenId, bystanderId, 'viewer', JANUARY);

    await expect(
      getGardenOwnershipTransferQuery().execute(gardenId, bystanderId),
    ).rejects.toMatchObject({
      code: 'collaboration.ownership_transfer.not_found',
    });
    await expect(
      getGardenOwnershipTransferQuery().execute(gardenId, bystanderId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reports the identical 404 when nothing is pending at all', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    await expect(
      getGardenOwnershipTransferQuery().execute(gardenId, ownerId),
    ).rejects.toMatchObject({ code: 'collaboration.ownership_transfer.not_found' });
  });

  it('conceals garden existence as 404 for a caller with no membership at all', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const targetId = await insertProfile(db);
    await insertMembership(db, gardenId, targetId, 'editor', JANUARY);
    await insertPendingOwnershipTransfer(db, gardenId, ownerId, targetId);
    const strangerId = await insertProfile(db);

    await expect(
      getGardenOwnershipTransferQuery().execute(gardenId, strangerId),
    ).rejects.toMatchObject({ code: 'garden.not_found' });
  });

  // --- ListIncomingOwnershipTransfers ---------------------------------------

  it('lists only pending transfers addressed to the caller, across multiple gardens, with the destination garden name', async () => {
    const recipientId = await insertProfile(db);

    const ownerAId = await insertProfile(db);
    const gardenA = await insertGarden(db, ownerAId);
    await insertMembership(db, gardenA, ownerAId, 'owner', JANUARY);
    await insertMembership(db, gardenA, recipientId, 'editor', JANUARY);
    const transferAId = await insertPendingOwnershipTransfer(
      db,
      gardenA,
      ownerAId,
      recipientId,
      'editor',
      new Date('2026-02-01T00:00:00Z'),
    );

    const ownerBId = await insertProfile(db);
    const gardenB = await insertGarden(db, ownerBId);
    await insertMembership(db, gardenB, ownerBId, 'owner', JANUARY);
    await insertMembership(db, gardenB, recipientId, 'viewer', JANUARY);
    const transferBId = await insertPendingOwnershipTransfer(
      db,
      gardenB,
      ownerBId,
      recipientId,
      'viewer',
      new Date('2026-02-05T00:00:00Z'),
    );

    // A pending transfer on a THIRD garden, addressed to somebody else
    // entirely — must not leak into the recipient's own list.
    const ownerCId = await insertProfile(db);
    const gardenC = await insertGarden(db, ownerCId);
    await insertMembership(db, gardenC, ownerCId, 'owner', JANUARY);
    const otherRecipientId = await insertProfile(db);
    await insertMembership(db, gardenC, otherRecipientId, 'editor', JANUARY);
    await insertPendingOwnershipTransfer(db, gardenC, ownerCId, otherRecipientId);

    const result = await listIncomingQuery().execute(recipientId);

    expect(result.items).toHaveLength(2);
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(transferAId);
    expect(ids).toContain(transferBId);
    expect(result.items.every((item) => item.toProfileId === recipientId)).toBe(true);
    expect(result.items.every((item) => item.state === 'pending')).toBe(true);

    const gardenNames = result.items.map((item) => item.gardenName);
    expect(gardenNames).toEqual(['Collaboration Garden', 'Collaboration Garden']);
    // Most recently requested first.
    expect(result.items[0]?.id).toBe(transferBId);
    expect(result.items[1]?.id).toBe(transferAId);
  });

  it('excludes completed, cancelled, and declined transfers addressed to the caller', async () => {
    const recipientId = await insertProfile(db);

    const completedOwnerId = await insertProfile(db);
    const completedGarden = await insertGarden(db, completedOwnerId);
    await insertMembership(db, completedGarden, completedOwnerId, 'owner', JANUARY);
    await insertMembership(db, completedGarden, recipientId, 'editor', JANUARY);
    const completedId = await insertPendingOwnershipTransfer(
      db,
      completedGarden,
      completedOwnerId,
      recipientId,
    );
    await db
      .updateTable('collaboration.ownership_transfer')
      .set({ state: 'completed', completed_at: new Date('2026-02-10T00:00:00Z') })
      .where('id', '=', completedId)
      .execute();

    const cancelledOwnerId = await insertProfile(db);
    const cancelledGarden = await insertGarden(db, cancelledOwnerId);
    await insertMembership(db, cancelledGarden, cancelledOwnerId, 'owner', JANUARY);
    await insertMembership(db, cancelledGarden, recipientId, 'viewer', JANUARY);
    const cancelledId = await insertPendingOwnershipTransfer(
      db,
      cancelledGarden,
      cancelledOwnerId,
      recipientId,
    );
    await db
      .updateTable('collaboration.ownership_transfer')
      .set({ state: 'cancelled', cancelled_at: new Date('2026-02-11T00:00:00Z') })
      .where('id', '=', cancelledId)
      .execute();

    const declinedOwnerId = await insertProfile(db);
    const declinedGarden = await insertGarden(db, declinedOwnerId);
    await insertMembership(db, declinedGarden, declinedOwnerId, 'owner', JANUARY);
    await insertMembership(db, declinedGarden, recipientId, 'editor', JANUARY);
    const declinedId = await insertPendingOwnershipTransfer(
      db,
      declinedGarden,
      declinedOwnerId,
      recipientId,
    );
    await db
      .updateTable('collaboration.ownership_transfer')
      .set({
        state: 'cancelled',
        cancelled_at: new Date('2026-02-12T00:00:00Z'),
        cancellation_reason: 'declined_by_recipient',
      })
      .where('id', '=', declinedId)
      .execute();

    // One genuinely pending transfer, so the list is not merely empty by
    // construction.
    const pendingOwnerId = await insertProfile(db);
    const pendingGarden = await insertGarden(db, pendingOwnerId);
    await insertMembership(db, pendingGarden, pendingOwnerId, 'owner', JANUARY);
    await insertMembership(db, pendingGarden, recipientId, 'viewer', JANUARY);
    const pendingId = await insertPendingOwnershipTransfer(
      db,
      pendingGarden,
      pendingOwnerId,
      recipientId,
    );

    const result = await listIncomingQuery().execute(recipientId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(pendingId);
  });

  it('returns an empty list for a profile with no incoming transfers', async () => {
    const profileId = await insertProfile(db);

    const result = await listIncomingQuery().execute(profileId);

    expect(result.items).toEqual([]);
  });
});
