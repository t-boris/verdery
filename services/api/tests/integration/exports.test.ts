/**
 * P8-EXPORT-01 end-to-end lifecycle against real PostgreSQL: request
 * authorization and rate limiting, the snapshot/checkpoint/complete hops
 * (worker simulated — the "real commands, simulated relay" posture),
 * atomic completion (media record + request + notification event), the
 * export_ready intent through the real notification policy, the
 * requester-bound signed download, and expiry.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  EXPORT_COMPLETED_EVENT_TYPE,
  EXPORT_REQUESTED_EVENT_TYPE,
  type ExportCompletedEventPayload,
} from '@verdery/api-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../src/platform/errors/application-error.js';
import { RECENT_AUTHENTICATION_MAX_AGE_MS } from '../../src/modules/exports/domain/export-request.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  actorFor,
  buildExportHarness,
  createGardenOwnedBy,
  createProfile,
  fixedClock,
  outboxEventsOfType,
  packageFor,
  runFullExport,
  stageSections,
} from '../support/export-test-harness.js';

const SUITE_NAME = 'exports lifecycle integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-25T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  it('runs the full pipeline: request -> snapshot -> checkpoints -> completion -> notification intent -> signed download', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);
    await createGardenOwnedBy(db, owner, 'Lifecycle garden', fixedClock(NOW));

    const requested = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    expect(requested.state).toBe('requested');
    expect(requested.boundaryAt).toBeNull();
    expect(requested.expiresAt).toBeNull();

    // The audit trail exists atomically with the request: an export is the
    // product's highest-value data egress and used to leave no trace at all
    // (threat-model.md, T-SUPPORT-05).
    const auditRows = await db
      .selectFrom('platform.audit_event')
      .select(['event_type', 'subject_id', 'actor_profile_id'])
      .where('subject_id', '=', requested.id)
      .execute();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.event_type).toBe('export.requested');
    expect(auditRows[0]?.actor_profile_id).toBe(owner);

    // The durable trigger exists atomically with the request.
    const requestedEvents = await outboxEventsOfType(db, EXPORT_REQUESTED_EVENT_TYPE);
    expect(
      requestedEvents.filter(
        (event) => (event.payload as { exportRequestId: string }).exportRequestId === requested.id,
      ),
    ).toHaveLength(1);

    const snapshot = await runFullExport(harness, requested.id);
    expect(snapshot.sections.length).toBeGreaterThan(0);

    const completed = await harness.getExportRequest.execute(requested.id, owner);
    expect(completed.state).toBe('completed');
    expect(completed.boundaryAt).toBe(snapshot.boundaryAt);
    expect(completed.outputChecksumSha256).toBe('c'.repeat(64));
    expect(completed.expiresAt).toBe(new Date(NOW.getTime() + 7 * DAY_MS).toISOString());

    // The export_package media record exists, garden-less, available, with
    // the 7-day retention deadline the live sweep and bucket rule enforce.
    const record = await db
      .selectFrom('media.media_record')
      .selectAll()
      .where('object_key', '=', snapshot.packageTarget.objectKey)
      .executeTakeFirstOrThrow();
    expect(record).toMatchObject({
      media_class: 'export_package',
      garden_id: null,
      uploaded_by_profile_id: owner,
      upload_state: 'available',
      sensitivity_classification: 'sensitive',
    });
    expect(record.retention_deadline_at).toEqual(new Date(NOW.getTime() + 7 * DAY_MS));

    // The completion event, forwarded (simulated relay) through the REAL
    // policy, creates the requester's in-app intent.
    const completedEvents = await outboxEventsOfType(db, EXPORT_COMPLETED_EVENT_TYPE);
    const completionEvent = completedEvents.find(
      (event) => (event.payload as ExportCompletedEventPayload).exportRequestId === requested.id,
    );
    expect(completionEvent).toBeDefined();
    const summary = await harness.applyNotificationPolicy.execute({
      id: completionEvent!.id,
      eventType: EXPORT_COMPLETED_EVENT_TYPE,
      payload: completionEvent!.payload,
      traceId: null,
      occurredAt: completionEvent!.occurredAt.toISOString(),
    });
    expect(summary.intentsCreated).toBe(1);

    const intent = await db
      .selectFrom('notifications.notification_intent')
      .selectAll()
      .where('recipient_profile_id', '=', owner)
      .where('intent_type', '=', 'export_ready')
      .executeTakeFirstOrThrow();
    expect(intent).toMatchObject({
      garden_id: null,
      channel_in_app: true,
      channel_push: false,
      dedup_key: `export_ready:request:${requested.id}`,
    });

    // The signed download — the established mechanism, requester-bound.
    const download = await harness.getExportDownload.execute(requested.id, owner);
    expect(download.url).toContain(snapshot.packageTarget.objectKey);
    expect(harness.storage.createSignedUrlCalls).toHaveLength(1);
  });

  it('enforces recent authentication for account scope, and the exportGarden capability for garden scope', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);
    const gardenId = await createGardenOwnedBy(db, owner, 'Authz garden', fixedClock(NOW));

    const staleAuth = new Date(NOW.getTime() - RECENT_AUTHENTICATION_MAX_AGE_MS - 1);
    await expect(
      harness.requestExport.execute(
        actorFor(owner, staleAuth),
        { scope: 'account', gardenId: null, includeMedia: true },
        randomUUID(),
      ),
    ).rejects.toThrow(ForbiddenError);

    // A stale sign-in may still export ONE garden it owns — the gate is
    // scope-specific.
    const gardenExport = await harness.requestExport.execute(
      actorFor(owner, staleAuth),
      { scope: 'garden', gardenId, includeMedia: false },
      randomUUID(),
    );
    expect(gardenExport.scope).toBe('garden');
    expect(gardenExport.gardenId).toBe(gardenId);
  });

  it('allows one active export per requester: a second request conflicts until the first turns terminal, and an idempotent retry replays', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);
    await createGardenOwnedBy(db, owner, 'Rate-limit garden', fixedClock(NOW));
    const idempotencyKey = randomUUID();

    const first = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      idempotencyKey,
    );

    // The same key replays the SAME request — a retry, not a conflict.
    const replay = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      idempotencyKey,
    );
    expect(replay.id).toBe(first.id);

    // A new key while the first is active conflicts.
    await expect(
      harness.requestExport.execute(
        actorFor(owner, NOW),
        { scope: 'account', gardenId: null, includeMedia: true },
        randomUUID(),
      ),
    ).rejects.toThrow(ConflictError);

    await runFullExport(harness, first.id);

    // Terminal exports never block a new one.
    const second = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    expect(second.id).not.toBe(first.id);
  });

  it('replays of the completion hop converge: one media record, one completed transition, one notification event', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);
    await createGardenOwnedBy(db, owner, 'Replay garden', fixedClock(NOW));

    const requested = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await runFullExport(harness, requested.id);

    const replay = await harness.completeExport.execute(requested.id, packageFor(snapshot));
    expect(replay).toMatchObject({ state: 'completed', transitioned: false });

    const records = await db
      .selectFrom('media.media_record')
      .select(['id'])
      .where('object_key', '=', snapshot.packageTarget.objectKey)
      .execute();
    expect(records).toHaveLength(1);

    const completionEvents = (await outboxEventsOfType(db, EXPORT_COMPLETED_EVENT_TYPE)).filter(
      (event) => (event.payload as ExportCompletedEventPayload).exportRequestId === requested.id,
    );
    expect(completionEvents).toHaveLength(1);
  });

  it('a redelivered snapshot after checkpointing serves the recorded checkpoints and no sections', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);
    await createGardenOwnedBy(db, owner, 'Redelivery garden', fixedClock(NOW));

    const requested = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    const first = await harness.runExportSnapshot.execute(requested.id);
    await harness.recordExportCheckpoints.execute(requested.id, {
      boundaryAt: first.boundaryAt as string,
      sections: stageSections(first),
    });

    const second = await harness.runExportSnapshot.execute(requested.id);
    expect(second.sections).toHaveLength(0);
    expect(second.checkpoints.map((checkpoint) => checkpoint.entryPath).sort()).toEqual(
      first.sections.map((section) => section.entryPath).sort(),
    );
    expect(second.boundaryAt).toBe(first.boundaryAt);
  });

  it('refuses the download before completion, after expiry, and after the package record leaves available', async () => {
    const preCompletion = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);
    await createGardenOwnedBy(db, owner, 'Expiry garden', fixedClock(NOW));

    const requested = await preCompletion.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );
    await expect(preCompletion.getExportDownload.execute(requested.id, owner)).rejects.toThrow(
      ConflictError,
    );

    const snapshot = await runFullExport(preCompletion, requested.id);
    await preCompletion.getExportDownload.execute(requested.id, owner);

    // Ten days on: past the 7-day deadline the download refuses even
    // before the sweep physically removes anything.
    const afterExpiry = buildExportHarness(db, fixedClock(new Date(NOW.getTime() + 10 * DAY_MS)));
    await expect(afterExpiry.getExportDownload.execute(requested.id, owner)).rejects.toThrow(
      ConflictError,
    );

    // And independently: a package record no longer `available` (the
    // retention pipeline claimed it early) refuses too, within the window.
    await db
      .updateTable('media.media_record')
      .set({ upload_state: 'deletion_scheduled' })
      .where('object_key', '=', snapshot.packageTarget.objectKey)
      .execute();
    await expect(preCompletion.getExportDownload.execute(requested.id, owner)).rejects.toThrow(
      ConflictError,
    );
  });

  it('conceals unknown export ids as not-found', async () => {
    const harness = buildExportHarness(db, fixedClock(NOW));
    const owner = await createProfile(db);

    await expect(harness.getExportRequest.execute(randomUUID(), owner)).rejects.toThrow(
      NotFoundError,
    );
    await expect(harness.getExportDownload.execute(randomUUID(), owner)).rejects.toThrow(
      NotFoundError,
    );
  });
});
