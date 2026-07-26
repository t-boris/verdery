/**
 * Shared fixtures and service wiring for the P8-EXPORT-01 integration
 * suites (`exports.test.ts`, `exports-privacy.test.ts`,
 * `exports-consistency.test.ts`) — the `sync-test-harness.ts` precedent:
 * real application services against the migrated database, direct inserts
 * only for fixture rows whose owning commands would drag in half the
 * composition root, and a simulated worker (`stageSections`,
 * `packageFor`) standing in for the GCS-side staging/assembly exactly the
 * way the media suites' "real commands, simulated relay" posture stands
 * in for Cloud Tasks.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type {
  ExportCompletionRequest,
  ExportSectionCheckpoint,
  ExportSnapshotResponse,
} from '@verdery/api-contracts';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import {
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { CompleteMediaUpload } from '../../src/modules/media/application/complete-media-upload.js';
import { RegisterMediaUpload } from '../../src/modules/media/application/register-media-upload.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { ApplyNotificationPolicy } from '../../src/modules/notifications/application/apply-notification-policy.js';
import { KyselyNotificationsUnitOfWork } from '../../src/modules/notifications/persistence/kysely-notifications-unit-of-work.js';
import { CompleteExport } from '../../src/modules/exports/application/complete-export.js';
import { GetExportDownload } from '../../src/modules/exports/application/get-export-download.js';
import { GetExportRequest } from '../../src/modules/exports/application/get-export-request.js';
import { RecordExportCheckpoints } from '../../src/modules/exports/application/record-export-checkpoints.js';
import { RequestExport } from '../../src/modules/exports/application/request-export.js';
import { RunExportSnapshot } from '../../src/modules/exports/application/run-export-snapshot.js';
import { KyselyExportRequestRepository } from '../../src/modules/exports/persistence/kysely-export-request-repository.js';
import { KyselyExportSnapshotReader } from '../../src/modules/exports/persistence/kysely-export-snapshot-reader.js';
import { KyselyExportsUnitOfWork } from '../../src/modules/exports/persistence/kysely-exports-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { ActorContext } from '../../src/shared/actor/actor-context.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

export function actorFor(
  profileId: string,
  authenticatedAt: Date,
  email?: string,
  emailVerified = true,
): ActorContext {
  return {
    profileId,
    firebaseUid: `firebase-${profileId}`,
    authenticatedAt,
    signInProvider: 'password',
    credentialKind: 'sessionCookie',
    requestId: randomUUID(),
    email,
    emailVerified: email === undefined ? false : emailVerified,
  };
}

export async function createProfile(db: Kysely<DatabaseSchema>): Promise<string> {
  // UUIDv7 like the real provisioning path — the notification policy's
  // payload validation pins the production id shape.
  const id = generateUuidV7();
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
  return id;
}

export async function createGardenOwnedBy(
  db: Kysely<DatabaseSchema>,
  ownerId: string,
  name: string,
  clock: Clock,
): Promise<string> {
  const createGarden = new CreateGarden(
    new KyselyIdempotencyStore(db, clock),
    new KyselyGardensMappingUnitOfWork(db, clock),
    clock,
  );
  const garden = await createGarden.execute(ownerId, name, randomUUID());
  return garden.id;
}

export async function addMember(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  profileId: string,
  role: 'editor' | 'viewer' | 'owner',
): Promise<void> {
  await db
    .insertInto('collaboration.membership')
    .values({ id: randomUUID(), garden_id: gardenId, profile_id: profileId, role, state: 'active' })
    .execute();
}

export async function insertPlant(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  createdBy: string,
  displayName: string,
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('plants_inventory.plant')
    .values({
      id,
      garden_id: gardenId,
      display_name: displayName,
      created_by_profile_id: createdBy,
    })
    .execute();
  return id;
}

export async function insertObservation(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  plantId: string | null,
  createdBy: string,
  noteText: string,
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('observations_history.observation')
    .values({
      id,
      garden_id: gardenId,
      plant_id: plantId,
      garden_object_id: null,
      created_by_profile_id: createdBy,
      note_text: noteText,
    })
    .execute();
  return id;
}

export async function insertTask(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  plantId: string,
  createdBy: string,
  title: string,
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('tasks_recommendations.task')
    .values({
      id,
      garden_id: gardenId,
      target_kind: 'plant',
      target_plant_id: plantId,
      title,
      created_by_profile_id: createdBy,
    })
    .execute();
  return id;
}

export async function insertMapObject(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  createdBy: string,
  label: string,
): Promise<{ objectId: string; coordinateSpaceId: string }> {
  const existing = await db
    .selectFrom('gardens_mapping.coordinate_space')
    .select('id')
    .where('garden_id', '=', gardenId)
    .executeTakeFirst();
  const coordinateSpaceId = existing?.id ?? randomUUID();
  if (existing === undefined) {
    await db
      .insertInto('gardens_mapping.coordinate_space')
      .values({ id: coordinateSpaceId, garden_id: gardenId, origin_description: 'test origin' })
      .execute();
  }

  const objectId = randomUUID();
  await db
    .insertInto('gardens_mapping.garden_object')
    .values({
      id: objectId,
      garden_id: gardenId,
      coordinate_space_id: coordinateSpaceId,
      category: 'bed',
      geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      })}), 0)` as unknown as string,
      label,
      provenance: 'manualDrawing',
      created_by_profile_id: createdBy,
    })
    .execute();
  await db
    .insertInto('gardens_mapping.bed_details')
    .values({ garden_object_id: objectId, bed_kind: 'raised', soil_notes: `soil for ${label}` })
    .execute();
  return { objectId, coordinateSpaceId };
}

/** One rule version + one candidate + its mandatory evidence row, committed together under the deferred composite FK — the engine's own shape, inserted directly. */
export async function insertRecommendation(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  plantId: string,
  ruleKey: string,
): Promise<string> {
  const candidateId = randomUUID();
  await db.transaction().execute(async (trx) => {
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(trx);
    const ruleVersionId = randomUUID();
    await trx
      .insertInto('tasks_recommendations.rule_version')
      .values({ id: ruleVersionId, rule_key: ruleKey, version: 1, safety_tier: 'ordinary_care' })
      .execute();
    const evidenceId = randomUUID();
    await trx
      .insertInto('tasks_recommendations.recommendation_candidate')
      .values({
        id: candidateId,
        garden_id: gardenId,
        target_kind: 'plant',
        target_plant_id: plantId,
        care_category: 'watering',
        explanation: `Water the plant (${ruleKey}).`,
        rule_version_id: ruleVersionId,
        safety_tier: 'ordinary_care',
        primary_evidence_id: evidenceId,
      })
      .execute();
    await trx
      .insertInto('tasks_recommendations.recommendation_evidence')
      .values({
        id: evidenceId,
        candidate_id: candidateId,
        evidence_kind: 'plant_identity',
        source_plant_id: plantId,
        fact_key: 'plant.identity',
        fact_value: JSON.stringify({ plantId }),
      })
      .execute();
  });
  return candidateId;
}

export interface MediaUploadHarness {
  readonly register: RegisterMediaUpload;
  readonly complete: CompleteMediaUpload;
  readonly storage: FakeMediaStorageGateway;
}

export function buildMediaUploadHarness(
  db: Kysely<DatabaseSchema>,
  clock: Clock,
): MediaUploadHarness {
  const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
  const idempotency = new KyselyIdempotencyStore(db, clock);
  const unitOfWork = new KyselyMediaUnitOfWork(db, clock);
  const storage = new FakeMediaStorageGateway({
    objectMetadata: { contentType: 'image/jpeg', sizeBytes: 1234 },
  });
  return {
    storage,
    register: new RegisterMediaUpload(
      idempotency,
      unitOfWork,
      authorization,
      storage,
      TEST_BUCKETS,
      clock,
    ),
    complete: new CompleteMediaUpload(idempotency, unitOfWork, authorization, storage, clock),
  };
}

/** Registers and completes one upload so the record reaches `available` (its processing pipeline is not this suite's concern — the export reads records, not derivatives). */
export async function uploadAvailableMedia(
  harness: MediaUploadHarness,
  gardenId: string,
  profileId: string,
  displayFilename: string,
  mediaClass: 'garden_photo' | 'imported_plan' | 'raw_capture' = 'garden_photo',
): Promise<string> {
  const session = await harness.register.execute(
    gardenId,
    profileId,
    {
      mediaClass,
      displayFilename,
      declaredContentType: 'image/jpeg',
      declaredByteSize: 1234,
      checksumSha256: null,
    },
    randomUUID(),
  );
  const completed = await harness.complete.execute(
    gardenId,
    session.media.id,
    profileId,
    session.media.revision,
    randomUUID(),
  );
  return completed.id;
}

export interface ExportHarness {
  readonly requestExport: RequestExport;
  readonly getExportRequest: GetExportRequest;
  readonly getExportDownload: GetExportDownload;
  readonly runExportSnapshot: RunExportSnapshot;
  readonly recordExportCheckpoints: RecordExportCheckpoints;
  readonly completeExport: CompleteExport;
  readonly applyNotificationPolicy: ApplyNotificationPolicy;
  readonly storage: FakeMediaStorageGateway;
}

export function buildExportHarness(db: Kysely<DatabaseSchema>, clock: Clock): ExportHarness {
  const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
  const unitOfWork = new KyselyExportsUnitOfWork(db, clock);
  const repository = new KyselyExportRequestRepository(db);
  const storage = new FakeMediaStorageGateway();

  return {
    requestExport: new RequestExport(
      new KyselyIdempotencyStore(db, clock),
      unitOfWork,
      authorization,
      TEST_BUCKETS,
      clock,
    ),
    getExportRequest: new GetExportRequest(repository),
    getExportDownload: new GetExportDownload(
      repository,
      new KyselyMediaRepository(db),
      storage,
      clock,
    ),
    runExportSnapshot: new RunExportSnapshot(
      unitOfWork,
      new KyselyExportSnapshotReader(db, clock),
      '1.0.0-test',
      clock,
    ),
    recordExportCheckpoints: new RecordExportCheckpoints(unitOfWork, clock),
    completeExport: new CompleteExport(unitOfWork, clock),
    applyNotificationPolicy: new ApplyNotificationPolicy(
      new KyselyNotificationsUnitOfWork(db, clock),
      clock,
    ),
    storage,
  };
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** The worker's staging step, simulated: every served section becomes a checkpoint descriptor as if its bytes were durably staged. */
export function stageSections(snapshot: ExportSnapshotResponse): ExportSectionCheckpoint[] {
  return snapshot.sections.map((section) => ({
    entryPath: section.entryPath,
    disposition: section.disposition,
    bucketName: snapshot.packageTarget.bucketName,
    objectKey: `${snapshot.stagingObjectKeyPrefix}${section.entryPath}`,
    contentType: section.contentType,
    checksumSha256: sha256(section.content),
    byteSize: Buffer.byteLength(section.content, 'utf8'),
  }));
}

/** The worker's completion payload, simulated: a plausible ZIP at exactly the pre-computed package target. */
export function packageFor(snapshot: ExportSnapshotResponse): ExportCompletionRequest {
  return {
    outcome: 'succeeded',
    package: {
      bucketName: snapshot.packageTarget.bucketName,
      objectKey: snapshot.packageTarget.objectKey,
      contentType: 'application/zip',
      byteSize: 4321,
      checksumSha256: 'c'.repeat(64),
      mediaFileCount: 0,
      missingMediaCount: 0,
    },
  };
}

/** Drives one export from request through completion, returning the snapshot whose sections became the package. */
export async function runFullExport(
  harness: ExportHarness,
  exportRequestId: string,
): Promise<ExportSnapshotResponse> {
  const snapshot = await harness.runExportSnapshot.execute(exportRequestId);
  await harness.recordExportCheckpoints.execute(exportRequestId, {
    boundaryAt: snapshot.boundaryAt as string,
    sections: stageSections(snapshot),
  });
  await harness.completeExport.execute(exportRequestId, packageFor(snapshot));
  return snapshot;
}

/** Every unpublished outbox row of one event type — the simulated relay's read. */
export async function outboxEventsOfType(
  db: Kysely<DatabaseSchema>,
  eventType: string,
): Promise<{ id: string; payload: unknown; occurredAt: Date }[]> {
  const rows = await db
    .selectFrom('platform.outbox_event')
    .select(['id', 'payload', 'occurred_at'])
    .where('event_type', '=', eventType)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ id: row.id, payload: row.payload, occurredAt: row.occurred_at }));
}
