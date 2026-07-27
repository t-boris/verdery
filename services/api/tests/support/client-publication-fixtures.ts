/**
 * Row builders for the P9C-DATA-01 migration suite
 * (`tests/migrations/client-publication-and-work-logs.test.ts` and its
 * siblings — publication state, immutability, snapshot correctness, media
 * entitlement, and withdrawal). Reuses `insertRow`/`insertProfile`/
 * `insertGarden` from `collaboration-fixtures.ts` and
 * `insertServiceOrganization`/`insertGardenAssignment`/
 * `insertClientEngagement` from `service-organization-fixtures.ts`, the same
 * "go straight against `pg.Client`, not Kysely" reasoning both files already
 * give: these suites test the SCHEMA, and a typed query builder exists
 * specifically to prevent the column overrides these tests need.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { insertRow } from './collaboration-fixtures.js';
import type { Row } from './collaboration-fixtures.js';

export async function insertWorkLog(
  client: pg.Client,
  gardenId: string,
  actorProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.work_log', {
    id: randomUUID(),
    garden_id: gardenId,
    actor_profile_id: actorProfileId,
    description: 'Weeded the north bed and topped up mulch',
    occurred_at: new Date('2026-06-01T09:00:00Z'),
    ...overrides,
  });
}

export async function insertClientUpdate(
  client: pg.Client,
  engagementId: string,
  gardenId: string,
  createdByProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.client_update', {
    id: randomUUID(),
    engagement_id: engagementId,
    garden_id: gardenId,
    created_by_profile_id: createdByProfileId,
    title: 'June visit summary',
    ...overrides,
  });
}

/** A `client_update` row already in the `'published'` state, for tests that need a real publication to hang content off. */
export async function insertPublishedClientUpdate(
  client: pg.Client,
  engagementId: string,
  gardenId: string,
  createdByProfileId: string,
  publishedByProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertClientUpdate(client, engagementId, gardenId, createdByProfileId, {
    state: 'published',
    summary: 'Cleared the north bed and refreshed mulch throughout.',
    submitted_at: new Date('2026-06-01T10:00:00Z'),
    published_at: new Date('2026-06-01T11:00:00Z'),
    published_by_profile_id: publishedByProfileId,
    ...overrides,
  });
}

export async function insertPublicationVersion(
  client: pg.Client,
  clientUpdateId: string,
  engagementId: string,
  gardenId: string,
  publishedByProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.publication_version', {
    id: randomUUID(),
    client_update_id: clientUpdateId,
    engagement_id: engagementId,
    garden_id: gardenId,
    title: 'June visit summary',
    summary: 'Cleared the north bed and refreshed mulch throughout.',
    client_update_revision_at_publish: 1,
    published_at: new Date('2026-06-01T11:00:00Z'),
    published_by_profile_id: publishedByProfileId,
    ...overrides,
  });
}

export async function insertPublicationItem(
  client: pg.Client,
  publicationVersionId: string,
  gardenId: string,
  kind: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.publication_item', {
    id: randomUUID(),
    publication_version_id: publicationVersionId,
    garden_id: gardenId,
    kind,
    occurred_at: new Date('2026-06-01T09:00:00Z'),
    ...overrides,
  });
}

export async function insertPublicationWorkLogDetail(
  client: pg.Client,
  itemId: string,
  overrides: Row = {},
): Promise<string> {
  await insertRow(client, 'collaboration.publication_work_log_detail', {
    item_id: itemId,
    description: 'Weeded the north bed and topped up mulch',
    ...overrides,
  });
  return itemId;
}

export async function insertMediaRecord(
  client: pg.Client,
  uploadedByProfileId: string,
  overrides: Row = {},
): Promise<string> {
  const id = randomUUID();
  await insertRow(client, 'media.media_record', {
    id,
    uploaded_by_profile_id: uploadedByProfileId,
    media_class: 'garden_photo',
    display_filename: 'north-bed.jpg',
    declared_content_type: 'image/jpeg',
    declared_byte_size: 2048,
    upload_state: 'available',
    sensitivity_classification: 'standard',
    ...overrides,
  });
  return id;
}

export async function insertPublicationMediaDetail(
  client: pg.Client,
  itemId: string,
  mediaRecordId: string,
  overrides: Row = {},
): Promise<string> {
  await insertRow(client, 'collaboration.publication_media_detail', {
    item_id: itemId,
    media_record_id: mediaRecordId,
    media_role: 'after',
    ...overrides,
  });
  return itemId;
}

export async function insertPublicationGardenSnapshotDetail(
  client: pg.Client,
  itemId: string,
  overrides: Row = {},
): Promise<string> {
  await insertRow(client, 'collaboration.publication_garden_snapshot_detail', {
    item_id: itemId,
    overview_text: 'Four beds, one greenhouse, all accepted content current as of this visit.',
    ...overrides,
  });
  return itemId;
}

export async function insertPublicationTimelineEntryDetail(
  client: pg.Client,
  itemId: string,
  overrides: Row = {},
): Promise<string> {
  await insertRow(client, 'collaboration.publication_timeline_entry_detail', {
    item_id: itemId,
    entry_text: 'Spring cleanup completed ahead of the summer planting window.',
    ...overrides,
  });
  return itemId;
}

export async function insertPublicationStaffAttribution(
  client: pg.Client,
  publicationVersionId: string,
  staffProfileId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.publication_staff_attribution', {
    id: randomUUID(),
    publication_version_id: publicationVersionId,
    staff_profile_id: staffProfileId,
    display_name: 'Jordan Rivera',
    ...overrides,
  });
}

export async function insertMediaEntitlement(
  client: pg.Client,
  engagementId: string,
  publicationVersionId: string,
  mediaRecordId: string,
  overrides: Row = {},
): Promise<string> {
  return insertRow(client, 'collaboration.media_entitlement', {
    id: randomUUID(),
    engagement_id: engagementId,
    publication_version_id: publicationVersionId,
    media_record_id: mediaRecordId,
    ...overrides,
  });
}
