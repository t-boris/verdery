/**
 * P8-EXPORT-01 privacy acceptance evidence on real PostgreSQL: an export
 * contains ONLY the requesting user's own entitled data. Cross-account and
 * cross-garden fixtures prove another user's/garden's rows never enter any
 * section, other users' media never enters the transfer list, collaborator
 * personal account data stays out of shared-garden exports, raw captures
 * stay out entirely, and the package's access path is requester-bound —
 * including the structural guarantee that no garden media route can serve
 * it to a fellow member.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ExportMediaTransferManifest, ExportSnapshotResponse } from '@verdery/api-contracts';
import { EXPORT_MEDIA_TRANSFER_ENTRY_PATH } from '@verdery/api-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { GetMediaAccess } from '../../src/modules/media/application/get-media-access.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyAuditLogger } from '../../src/platform/audit/kysely-audit-logger.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  actorFor,
  addMember,
  buildExportHarness,
  buildMediaUploadHarness,
  createGardenOwnedBy,
  createProfile,
  fixedClock,
  insertMapObject,
  insertObservation,
  insertPlant,
  insertRecommendation,
  insertTask,
  runFullExport,
  uploadAvailableMedia,
} from '../support/export-test-harness.js';

const SUITE_NAME = 'exports privacy integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-25T09:00:00Z');

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Every byte of every PACKAGED section, concatenated — the haystack the leak assertions search. */
function packagedContent(snapshot: ExportSnapshotResponse): string {
  return snapshot.sections
    .filter((section) => section.disposition === 'package')
    .map((section) => section.content)
    .join('\n');
}

function transferManifest(snapshot: ExportSnapshotResponse): ExportMediaTransferManifest {
  const section = snapshot.sections.find(
    (candidate) => candidate.entryPath === EXPORT_MEDIA_TRANSFER_ENTRY_PATH,
  );
  return JSON.parse(section?.content ?? '{"files":[]}') as ExportMediaTransferManifest;
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  // The two-account world: Alice owns garden A (with Bob as editor);
  // Bob owns garden B, where Alice has NO membership at all.
  let alice: string;
  let bob: string;
  let gardenA: string;
  let gardenB: string;
  let alicePlant: string;
  let bobPlant: string;
  let bobObservationNote: string;
  let bobTaskTitle: string;
  let bobMapLabel: string;
  let aliceMediaId: string;
  let bobMediaId: string;
  let aliceRawCaptureId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

    const clock = fixedClock(NOW);
    alice = await createProfile(db);
    bob = await createProfile(db);
    gardenA = await createGardenOwnedBy(db, alice, 'Alice garden', clock);
    gardenB = await createGardenOwnedBy(db, bob, 'Bob garden', clock);
    await addMember(db, gardenA, bob, 'editor');

    alicePlant = await insertPlant(db, gardenA, alice, 'Alice rose');
    bobPlant = await insertPlant(db, gardenB, bob, 'Bob secret orchid');
    bobObservationNote = `Bob private note ${randomUUID()}`;
    await insertObservation(db, gardenB, bobPlant, bob, bobObservationNote);
    bobTaskTitle = `Bob secret task ${randomUUID()}`;
    await insertTask(db, gardenB, bobPlant, bob, bobTaskTitle);
    bobMapLabel = `Bob secret bed ${randomUUID()}`;
    await insertMapObject(db, gardenB, bob, bobMapLabel);
    await insertRecommendation(db, gardenB, bobPlant, 'bob_secret_rule');
    await insertObservation(db, gardenA, alicePlant, alice, 'Alice note');
    await insertTask(db, gardenA, alicePlant, alice, 'Alice task');
    await insertMapObject(db, gardenA, alice, 'Alice bed');
    await insertRecommendation(db, gardenA, alicePlant, 'alice_rule');

    const media = buildMediaUploadHarness(db, clock);
    aliceMediaId = await uploadAvailableMedia(media, gardenA, alice, 'alice-photo.jpg');
    bobMediaId = await uploadAvailableMedia(media, gardenB, bob, 'bob-photo.jpg');
    aliceRawCaptureId = await uploadAvailableMedia(
      media,
      gardenA,
      alice,
      'alice-scan.bin',
      'raw_capture',
    );
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  it("Alice's account export contains her gardens' content and NOT ONE row of Bob's garden", async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const requested = await harness.requestExport.execute(
      actorFor(alice, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await harness.runExportSnapshot.execute(requested.id);
    const haystack = packagedContent(snapshot);

    // Her own data is present…
    expect(haystack).toContain('Alice rose');
    expect(haystack).toContain('Alice note');
    expect(snapshot.sections.some((section) => section.entryPath.includes(gardenA))).toBe(true);

    // …and nothing of Bob's garden exists anywhere in any packaged byte:
    // no garden id, no row id, no content, across every module's tables.
    expect(haystack).not.toContain(gardenB);
    expect(haystack).not.toContain(bobPlant);
    expect(haystack).not.toContain('Bob secret orchid');
    expect(haystack).not.toContain(bobObservationNote);
    expect(haystack).not.toContain(bobTaskTitle);
    expect(haystack).not.toContain(bobMapLabel);
    expect(haystack).not.toContain('bob_secret_rule');
    expect(haystack).not.toContain(bobMediaId);
    expect(haystack).not.toContain('bob-photo.jpg');

    // The transfer list is entitled media only — never another user's.
    const files = transferManifest(snapshot).files;
    expect(files.some((file) => file.mediaId === aliceMediaId)).toBe(true);
    expect(files.some((file) => file.mediaId === bobMediaId)).toBe(false);

    await harness.completeExport.execute(requested.id, {
      outcome: 'failed_terminal',
      failureCode: 'test_cleanup',
    });
  });

  it("a shared-garden export includes Bob's MEMBERSHIP facts but none of his personal account data", async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const requested = await harness.requestExport.execute(
      actorFor(alice, NOW),
      { scope: 'garden', gardenId: gardenA, includeMedia: false },
      randomUUID(),
    );
    const snapshot = await harness.runExportSnapshot.execute(requested.id);

    const gardenJson = snapshot.sections.find(
      (section) => section.entryPath === `gardens/${gardenA}/garden.json`,
    );
    const parsed = JSON.parse(gardenJson?.content ?? '{}') as {
      memberships: Record<string, unknown>[];
    };
    const bobMembership = parsed.memberships.find((membership) => membership['profileId'] === bob);
    expect(bobMembership).toMatchObject({ role: 'editor', state: 'active' });
    expect(Object.keys(bobMembership ?? {}).sort()).toEqual([
      'createdAt',
      'profileId',
      'role',
      'state',
    ]);

    // No profile row, no email, no firebase uid, no preferences — a
    // garden-scoped export carries no account files at all, and Bob's
    // identity facts never appear outside the membership row.
    expect(snapshot.sections.some((section) => section.entryPath.startsWith('account/'))).toBe(
      false,
    );
    expect(packagedContent(snapshot)).not.toContain(`firebase-${bob}`);

    await harness.completeExport.execute(requested.id, {
      outcome: 'failed_terminal',
      failureCode: 'test_cleanup',
    });
  });

  it("an editor's account export EXCLUDES the shared garden he does not own, disclosing the exclusion", async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const requested = await harness.requestExport.execute(
      actorFor(bob, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await harness.runExportSnapshot.execute(requested.id);

    // Garden A (where Bob is editor) contributes no content sections…
    expect(snapshot.sections.some((section) => section.entryPath.includes(gardenA))).toBe(false);
    // …but the manifest names it honestly as excluded.
    const manifest = JSON.parse(
      snapshot.sections.find((section) => section.entryPath === 'export.json')?.content ?? '{}',
    ) as { gardens: { gardenId: string; included: boolean; exclusionReason: string | null }[] };
    expect(manifest.gardens.find((listing) => listing.gardenId === gardenA)).toMatchObject({
      included: false,
      exclusionReason: 'not_owner',
    });
    // Alice's media never enters Bob's transfer list.
    const files = transferManifest(snapshot).files;
    expect(files.some((file) => file.mediaId === aliceMediaId)).toBe(false);

    await harness.completeExport.execute(requested.id, {
      outcome: 'failed_terminal',
      failureCode: 'test_cleanup',
    });
  });

  it('an editor cannot request a garden-scoped export, and a non-member cannot even learn the garden exists', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));

    await expect(
      harness.requestExport.execute(
        actorFor(bob, NOW),
        { scope: 'garden', gardenId: gardenA, includeMedia: false },
        randomUUID(),
      ),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      harness.requestExport.execute(
        actorFor(alice, NOW),
        { scope: 'garden', gardenId: gardenB, includeMedia: false },
        randomUUID(),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('raw captures stay out of the export entirely — no file entry, no metadata row', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const requested = await harness.requestExport.execute(
      actorFor(alice, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await harness.runExportSnapshot.execute(requested.id);

    expect(packagedContent(snapshot)).not.toContain(aliceRawCaptureId);
    expect(
      transferManifest(snapshot).files.some((file) => file.mediaId === aliceRawCaptureId),
    ).toBe(false);

    await harness.completeExport.execute(requested.id, {
      outcome: 'failed_terminal',
      failureCode: 'test_cleanup',
    });
  });

  it("the completed package is requester-bound: Bob cannot see Alice's export, and even a garden co-member cannot reach the package through any garden media route", async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const requested = await harness.requestExport.execute(
      actorFor(alice, NOW),
      { scope: 'garden', gardenId: gardenA, includeMedia: false },
      randomUUID(),
    );
    await runFullExport(harness, requested.id);

    // Status and download conceal the request from anyone but Alice.
    await expect(harness.getExportRequest.execute(requested.id, bob)).rejects.toThrow(
      NotFoundError,
    );
    await expect(harness.getExportDownload.execute(requested.id, bob)).rejects.toThrow(
      NotFoundError,
    );
    await harness.getExportDownload.execute(requested.id, alice);

    // The structural gate: the package's media record has NO garden id, so
    // the garden-scoped media access path treats it as nonexistent for
    // EVERY member — Bob the editor AND Alice herself.
    const packageRecord = await db
      .selectFrom('media.media_record')
      .select(['id', 'garden_id'])
      .where('media_class', '=', 'export_package')
      .where('uploaded_by_profile_id', '=', alice)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(packageRecord.garden_id).toBeNull();

    const getMediaAccess = new GetMediaAccess(
      new KyselyMediaRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      new FakeMediaStorageGateway(),
      new KyselyAuditLogger(db, fixedClock(NOW)),
      fixedClock(NOW),
    );
    await expect(getMediaAccess.execute(gardenA, packageRecord.id, bob)).rejects.toThrow(
      NotFoundError,
    );
    await expect(getMediaAccess.execute(gardenA, packageRecord.id, alice)).rejects.toThrow(
      NotFoundError,
    );
  });
});
