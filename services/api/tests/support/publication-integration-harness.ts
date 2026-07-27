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

/** Inserts a real, `available` media record directly against the garden — the shape `AddClientUpdateItem`/`PublishClientUpdate`'s own `MediaRepository.get` validation reads. */
export async function insertMediaRecord(
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
