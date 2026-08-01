/**
 * Shared fixture builders for the P9C-PUBLISH-01 integration suites
 * (`collaboration-publisher-grant.test.ts`, `collaboration-publications
 * .test.ts`, `collaboration-publications-concurrency.test.ts`) — real
 * PostgreSQL, real Kysely repositories, no fakes, the same posture
 * `organization-integration-harness.ts` already established for the P9B
 * suites. Re-exports that file's fixtures rather than duplicating them, and
 * adds the work-log/publisher-grant/media-record builders this package's
 * own commands need to seed a realistic pre-condition.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';

export {
  activeAdminCount,
  activeAssignmentCount,
  auditEventFor,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertGardenAssignment,
  insertMembership,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from './organization-integration-harness.js';

/** Writes `state = 'active'`/`activated_at` directly, bypassing `ActivateClientEngagement` — the identical "seed the precondition a command needs without exercising the command itself" posture every other fixture builder in this suite takes. */
export async function activateEngagement(
  db: Kysely<DatabaseSchema>,
  engagementId: string,
  activatedAt: Date = new Date('2026-03-01T00:00:00Z'),
): Promise<void> {
  await db
    .updateTable('collaboration.client_engagement')
    .set({ state: 'active', activated_at: activatedAt, updated_at: activatedAt })
    .where('id', '=', engagementId)
    .execute();
}

export async function insertWorkLog(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  actorProfileId: string,
  description = 'Weeded the north bed and topped up mulch',
  occurredAt: Date = new Date('2026-06-01T09:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.work_log')
    .values({
      id,
      garden_id: gardenId,
      assignment_id: null,
      task_id: null,
      actor_profile_id: actorProfileId,
      description,
      occurred_at: occurredAt,
      created_at: occurredAt,
    })
    .execute();
  return id;
}

/** Inserts a real, `available` ORIGINAL media record (`media_class = 'garden_photo'`, `derived_from_media_id = NULL`) directly against the garden — the shape `isMediaClientSafe` now REJECTS (P11-SHARE-01's own EXIF/GPS fix), since an original's bytes may carry embedded location. Exists as its own export so the rejection itself has something real to stage/publish against and assert `selected_item_invalid` on. */
export async function insertOriginalMediaRecord(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  uploadedByProfileId: string,
  uploadState: 'available' | 'registered' = 'available',
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('media.media_record')
    .values({
      id,
      garden_id: gardenId,
      uploaded_by_profile_id: uploadedByProfileId,
      media_class: 'garden_photo',
      display_filename: 'north-bed.jpg',
      declared_content_type: 'image/jpeg',
      declared_byte_size: 2048,
      upload_state: uploadState,
      sensitivity_classification: 'standard',
    })
    .execute();
  return id;
}

/**
 * Inserts a real, `available` DERIVATIVE media record — an original (via
 * `insertOriginalMediaRecord`) plus a `derived_preview` row pointing back at
 * it — and returns the DERIVATIVE's id, the shape `isMediaClientSafe`
 * accepts. Every existing caller of this fixture wants "a media record safe
 * to stage/publish to a client," which is now, correctly, a derivative
 * rather than the original this helper used to return directly.
 */
export async function insertMediaRecord(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  uploadedByProfileId: string,
  uploadState: 'available' | 'registered' = 'available',
): Promise<string> {
  const originalId = await insertOriginalMediaRecord(
    db,
    gardenId,
    uploadedByProfileId,
    'available',
  );
  const id = randomUUID();
  await db
    .insertInto('media.media_record')
    .values({
      id,
      garden_id: gardenId,
      uploaded_by_profile_id: uploadedByProfileId,
      media_class: 'derived_preview',
      display_filename: 'north-bed-preview.jpg',
      declared_content_type: 'image/jpeg',
      declared_byte_size: 512,
      upload_state: uploadState,
      sensitivity_classification: 'standard',
      derived_from_media_id: originalId,
      derivative_kind: 'screen_preview',
      transformation_version: 1,
    })
    .execute();
  return id;
}

/** Inserts a real `observations_history.observation` row directly against the garden — the shape `AddClientUpdateItem`/`PublishClientUpdate`'s own `ObservationRepository.get` validation reads (P11-SHARE-01). */
export async function insertObservation(
  db: Kysely<DatabaseSchema>,
  gardenId: string,
  actorProfileId: string,
  noteText = 'New growth on the fig tree since last visit',
  observedAt: Date = new Date('2026-06-01T09:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('observations_history.observation')
    .values({
      id,
      garden_id: gardenId,
      plant_id: null,
      garden_object_id: null,
      actor_type: 'user',
      created_by_profile_id: actorProfileId,
      note_text: noteText,
      condition_summary: null,
      correction_kind: null,
      corrects_observation_id: null,
      observed_phenological_stage: null,
      observed_sun_exposure: null,
      observed_drainage: null,
      observed_growing_context: null,
      observed_at: observedAt,
      recorded_at: observedAt,
    })
    .execute();
  return id;
}

/** Inserts an ACTIVE `collaboration.client_access_grant` row directly against an already-bound profile, bypassing the invite/accept flow — the same "seed the precondition, don't re-exercise the command that already has its own proof" posture `insertPublisherGrant` below takes. `ClientPortalAuthorization`'s own `client_access_grant_active_requires_profile_check`/`..._granted_at_check` invariants are satisfied directly. */
export async function insertActiveClientAccessGrant(
  db: Kysely<DatabaseSchema>,
  engagementId: string,
  clientProfileId: string,
  grantedAt: Date = new Date('2026-03-01T00:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.client_access_grant')
    .values({
      id,
      engagement_id: engagementId,
      client_profile_id: clientProfileId,
      invited_email: null,
      token_hash: null,
      expires_at: null,
      state: 'active',
      granted_at: grantedAt,
      revoked_at: null,
      created_at: grantedAt,
    })
    .execute();
  return id;
}

/** Inserts an ACTIVE `collaboration.publisher_grant` row directly, bypassing `GrantPublisherAccess` — useful for seeding a pre-existing grant a test then revokes, publishes under, or asserts against. */
export async function insertPublisherGrant(
  db: Kysely<DatabaseSchema>,
  engagementId: string,
  profileId: string,
  grantedByProfileId: string,
  grantedAt: Date = new Date('2026-04-01T00:00:00Z'),
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('collaboration.publisher_grant')
    .values({
      id,
      engagement_id: engagementId,
      profile_id: profileId,
      state: 'active',
      granted_by_profile_id: grantedByProfileId,
      granted_at: grantedAt,
      revoked_at: null,
      revoked_by_profile_id: null,
      created_at: grantedAt,
    })
    .execute();
  return id;
}
