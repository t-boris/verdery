import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  CreatePublicationVersionInput,
  PublicationItemDetail,
  PublicationRepository,
  PublicationVersionDetail,
} from '../application/publication-repository.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';

/**
 * Writes the eight immutable, REVOKE-protected tables P9C-DATA-01's own
 * migration built (`publication_version`, `publication_item`, its four
 * detail children, `publication_staff_attribution`, `media_entitlement`) —
 * steps 3 and 4 of the six-step publish transaction, in the SAME
 * transaction `PublishClientUpdate` also uses to guard-update
 * `client_update.state`. Every row is INSERT-only: this class never issues
 * an UPDATE or DELETE against any of the eight tables, matching the REVOKE
 * those tables carry (`verdery_application` genuinely cannot issue one even
 * if a bug attempted it).
 *
 * Every id (the version itself, every item, every staff attribution) is
 * SUPPLIED by the caller through `input` — this class never generates one
 * for those, matching every other repository in this module. The one
 * exception is `media_entitlement.id`: nothing downstream ever needs to
 * reference an entitlement row by its own id (`media_entitlement`'s own
 * natural key is `(publication_version_id, media_record_id)`), so it is
 * generated here, the same "an id nothing reads back may be generated at
 * the write site" posture `AddOrganizationMember`'s own
 * `organization_membership_period.id` already takes.
 *
 * BULK INSERTS PER TABLE, NOT ONE ROUND TRIP PER ROW. Every detail table is
 * written with at most one `insertInto(...).values([...])` call across all
 * of that kind's rows — cheaper than one statement per item, and each
 * `.values([])` call is skipped entirely when its kind has zero items
 * (`insertInto` on an empty array is invalid SQL).
 */
export class KyselyPublicationRepository implements PublicationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async create(input: CreatePublicationVersionInput): Promise<PublicationVersionDetail> {
    await this.db
      .insertInto('collaboration.publication_version')
      .values({
        id: input.id,
        client_update_id: input.clientUpdateId,
        engagement_id: input.engagementId,
        garden_id: input.gardenId,
        version_number: 1,
        title: input.title,
        summary: input.summary,
        client_update_revision_at_publish: input.clientUpdateRevisionAtPublish,
        published_at: input.publishedAt,
        published_by_profile_id: input.publishedByProfileId,
        created_at: input.publishedAt,
      })
      .execute();

    const itemRows = [
      ...input.workLogItems.map((item) => ({
        id: item.id,
        publication_version_id: input.id,
        garden_id: input.gardenId,
        kind: 'work_log',
        occurred_at: item.occurredAt,
        created_at: input.publishedAt,
      })),
      ...input.mediaItems.map((item) => ({
        id: item.id,
        publication_version_id: input.id,
        garden_id: input.gardenId,
        kind: 'media',
        occurred_at: item.occurredAt,
        created_at: input.publishedAt,
      })),
      ...(input.gardenSnapshotItem === null
        ? []
        : [
            {
              id: input.gardenSnapshotItem.id,
              publication_version_id: input.id,
              garden_id: input.gardenId,
              kind: 'garden_snapshot',
              occurred_at: input.gardenSnapshotItem.occurredAt,
              created_at: input.publishedAt,
            },
          ]),
      ...input.timelineEntryItems.map((item) => ({
        id: item.id,
        publication_version_id: input.id,
        garden_id: input.gardenId,
        kind: 'timeline_entry',
        occurred_at: item.occurredAt,
        created_at: input.publishedAt,
      })),
    ];
    if (itemRows.length > 0) {
      await this.db.insertInto('collaboration.publication_item').values(itemRows).execute();
    }

    if (input.workLogItems.length > 0) {
      await this.db
        .insertInto('collaboration.publication_work_log_detail')
        .values(
          input.workLogItems.map((item) => ({
            item_id: item.id,
            description: item.description,
            source_work_log_id: item.sourceWorkLogId,
          })),
        )
        .execute();
    }

    if (input.mediaItems.length > 0) {
      await this.db
        .insertInto('collaboration.publication_media_detail')
        .values(
          input.mediaItems.map((item) => ({
            item_id: item.id,
            media_record_id: item.mediaRecordId,
            media_role: item.mediaRole,
            caption: item.caption,
          })),
        )
        .execute();

      await this.db
        .insertInto('collaboration.media_entitlement')
        .values(
          input.mediaItems.map((item) => ({
            id: generateUuidV7(),
            engagement_id: input.engagementId,
            publication_version_id: input.id,
            media_record_id: item.mediaRecordId,
            created_at: input.publishedAt,
          })),
        )
        .execute();
    }

    if (input.gardenSnapshotItem !== null) {
      await this.db
        .insertInto('collaboration.publication_garden_snapshot_detail')
        .values({
          item_id: input.gardenSnapshotItem.id,
          overview_text: input.gardenSnapshotItem.overviewText,
          // Every jsonb write in this service is explicitly JSON.stringify'd
          // rather than relying on the driver to serialize a plain object —
          // see `kysely-calibration-repository.ts`'s own identical comment.
          snapshot_data:
            input.gardenSnapshotItem.snapshotData === null
              ? null
              : JSON.stringify(input.gardenSnapshotItem.snapshotData),
        })
        .execute();
    }

    if (input.timelineEntryItems.length > 0) {
      await this.db
        .insertInto('collaboration.publication_timeline_entry_detail')
        .values(
          input.timelineEntryItems.map((item) => ({
            item_id: item.id,
            entry_text: item.entryText,
          })),
        )
        .execute();
    }

    if (input.staffAttributions.length > 0) {
      await this.db
        .insertInto('collaboration.publication_staff_attribution')
        .values(
          input.staffAttributions.map((attribution) => ({
            id: attribution.id,
            publication_version_id: input.id,
            staff_profile_id: attribution.staffProfileId,
            display_name: attribution.displayName,
            role_label: attribution.roleLabel,
            created_at: input.publishedAt,
          })),
        )
        .execute();
    }

    const items: PublicationItemDetail[] = [
      ...input.workLogItems.map((item): PublicationItemDetail => ({
        id: item.id,
        kind: 'work_log',
        occurredAt: item.occurredAt,
        description: item.description,
        sourceWorkLogId: item.sourceWorkLogId,
      })),
      ...input.mediaItems.map((item): PublicationItemDetail => ({
        id: item.id,
        kind: 'media',
        occurredAt: item.occurredAt,
        mediaRecordId: item.mediaRecordId,
        mediaRole: item.mediaRole,
        caption: item.caption,
      })),
      ...(input.gardenSnapshotItem === null
        ? []
        : [
            {
              id: input.gardenSnapshotItem.id,
              kind: 'garden_snapshot' as const,
              occurredAt: input.gardenSnapshotItem.occurredAt,
              overviewText: input.gardenSnapshotItem.overviewText,
              snapshotData: input.gardenSnapshotItem.snapshotData,
            },
          ]),
      ...input.timelineEntryItems.map((item): PublicationItemDetail => ({
        id: item.id,
        kind: 'timeline_entry',
        occurredAt: item.occurredAt,
        entryText: item.entryText,
      })),
    ];

    return {
      id: input.id,
      clientUpdateId: input.clientUpdateId,
      engagementId: input.engagementId,
      gardenId: input.gardenId,
      versionNumber: 1,
      title: input.title,
      summary: input.summary,
      clientUpdateRevisionAtPublish: input.clientUpdateRevisionAtPublish,
      publishedAt: input.publishedAt,
      publishedByProfileId: input.publishedByProfileId,
      createdAt: input.publishedAt,
      items,
      staffAttributions: input.staffAttributions.map((attribution) => ({
        id: attribution.id,
        staffProfileId: attribution.staffProfileId,
        displayName: attribution.displayName,
        roleLabel: attribution.roleLabel,
        createdAt: input.publishedAt,
      })),
    };
  }
}
