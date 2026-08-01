import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PublicationMediaRole } from '../application/client-update-item-repository.js';
import type { ClientPublicationReadRepository } from '../application/client-publication-read-repository.js';
import type {
  PublicationItemDetail,
  PublicationStaffAttributionDetail,
  PublicationVersionDetail,
} from '../application/publication-repository.js';

/**
 * The read-only inverse of `KyselyPublicationRepository.create` — reads
 * back exactly the eight tables that method writes, for every
 * `publication_version` whose owning `client_update` is currently
 * `'published'` (see the port's own header for why this ONE query serves
 * all three P9C-API-01 client-portal read commands).
 *
 * MULTIPLE ROUND TRIPS PER KIND, NOT ONE MEGA-JOIN, mirroring
 * `KyselyPublicationRepository.create`'s own "bulk inserts per table, not
 * one round trip per row" posture in the opposite direction: a single SQL
 * join across eight tables would either duplicate every version/staff-
 * attribution row once per item (a real correctness risk for anyone
 * counting rows) or require Postgres-specific JSON aggregation this
 * codebase does not otherwise use. Each step below is bounded to at most
 * six queries regardless of how many items a version has, and the whole
 * shape is only ever invoked for one engagement's own (small) publication
 * history at a time.
 */
export class KyselyClientPublicationReadRepository implements ClientPublicationReadRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listVisibleForEngagement(engagementId: Uuid): Promise<readonly PublicationVersionDetail[]> {
    const versionRows = await this.db
      .selectFrom('collaboration.publication_version')
      .innerJoin(
        'collaboration.client_update',
        'collaboration.client_update.id',
        'collaboration.publication_version.client_update_id',
      )
      .select([
        'collaboration.publication_version.id',
        'collaboration.publication_version.client_update_id',
        'collaboration.publication_version.engagement_id',
        'collaboration.publication_version.garden_id',
        'collaboration.publication_version.version_number',
        'collaboration.publication_version.title',
        'collaboration.publication_version.summary',
        'collaboration.publication_version.client_update_revision_at_publish',
        'collaboration.publication_version.published_at',
        'collaboration.publication_version.published_by_profile_id',
        'collaboration.publication_version.created_at',
      ])
      .where('collaboration.publication_version.engagement_id', '=', engagementId)
      .where('collaboration.client_update.state', '=', 'published')
      .orderBy('collaboration.publication_version.published_at', 'desc')
      .orderBy('collaboration.publication_version.id', 'desc')
      .execute();

    if (versionRows.length === 0) {
      return [];
    }

    const versionIds = versionRows.map((row) => row.id);

    const itemRows = await this.db
      .selectFrom('collaboration.publication_item')
      .select(['id', 'publication_version_id', 'kind', 'occurred_at'])
      .where('publication_version_id', 'in', versionIds)
      .orderBy('occurred_at', 'asc')
      .execute();

    const itemIdsByKind = new Map<string, string[]>();
    for (const item of itemRows) {
      const bucket = itemIdsByKind.get(item.kind) ?? [];
      bucket.push(item.id);
      itemIdsByKind.set(item.kind, bucket);
    }

    const [
      workLogDetails,
      mediaDetails,
      gardenSnapshotDetails,
      timelineEntryDetails,
      observationDetails,
      staffRows,
    ] = await Promise.all([
      this.selectWorkLogDetails(itemIdsByKind.get('work_log') ?? []),
      this.selectMediaDetails(itemIdsByKind.get('media') ?? []),
      this.selectGardenSnapshotDetails(itemIdsByKind.get('garden_snapshot') ?? []),
      this.selectTimelineEntryDetails(itemIdsByKind.get('timeline_entry') ?? []),
      this.selectObservationDetails(itemIdsByKind.get('observation') ?? []),
      this.db
        .selectFrom('collaboration.publication_staff_attribution')
        .select([
          'id',
          'publication_version_id',
          'staff_profile_id',
          'display_name',
          'role_label',
          'created_at',
        ])
        .where('publication_version_id', 'in', versionIds)
        .orderBy('created_at', 'asc')
        .execute(),
    ]);

    const itemsByVersionId = new Map<string, PublicationItemDetail[]>();
    for (const item of itemRows) {
      const detail = this.toItemDetail(
        item,
        workLogDetails,
        mediaDetails,
        gardenSnapshotDetails,
        timelineEntryDetails,
        observationDetails,
      );
      const bucket = itemsByVersionId.get(item.publication_version_id) ?? [];
      bucket.push(detail);
      itemsByVersionId.set(item.publication_version_id, bucket);
    }

    const staffAttributionsByVersionId = new Map<string, PublicationStaffAttributionDetail[]>();
    for (const row of staffRows) {
      const bucket = staffAttributionsByVersionId.get(row.publication_version_id) ?? [];
      bucket.push({
        id: row.id,
        staffProfileId: row.staff_profile_id,
        displayName: row.display_name,
        roleLabel: row.role_label,
        createdAt: row.created_at,
      });
      staffAttributionsByVersionId.set(row.publication_version_id, bucket);
    }

    return versionRows.map((row) => ({
      id: row.id,
      clientUpdateId: row.client_update_id,
      engagementId: row.engagement_id,
      gardenId: row.garden_id,
      versionNumber: row.version_number,
      title: row.title,
      summary: row.summary,
      clientUpdateRevisionAtPublish: row.client_update_revision_at_publish,
      publishedAt: row.published_at,
      publishedByProfileId: row.published_by_profile_id,
      createdAt: row.created_at,
      items: itemsByVersionId.get(row.id) ?? [],
      staffAttributions: staffAttributionsByVersionId.get(row.id) ?? [],
    }));
  }

  private async selectWorkLogDetails(itemIds: readonly string[]) {
    if (itemIds.length === 0) {
      return new Map<string, { description: string; sourceWorkLogId: string | null }>();
    }
    const rows = await this.db
      .selectFrom('collaboration.publication_work_log_detail')
      .select(['item_id', 'description', 'source_work_log_id'])
      .where('item_id', 'in', itemIds)
      .execute();
    return new Map(
      rows.map((row) => [
        row.item_id,
        { description: row.description, sourceWorkLogId: row.source_work_log_id },
      ]),
    );
  }

  private async selectMediaDetails(itemIds: readonly string[]) {
    if (itemIds.length === 0) {
      return new Map<
        string,
        { mediaRecordId: string; mediaRole: string; caption: string | null }
      >();
    }
    const rows = await this.db
      .selectFrom('collaboration.publication_media_detail')
      .select(['item_id', 'media_record_id', 'media_role', 'caption'])
      .where('item_id', 'in', itemIds)
      .execute();
    return new Map(
      rows.map((row) => [
        row.item_id,
        { mediaRecordId: row.media_record_id, mediaRole: row.media_role, caption: row.caption },
      ]),
    );
  }

  private async selectGardenSnapshotDetails(itemIds: readonly string[]) {
    if (itemIds.length === 0) {
      return new Map<string, { overviewText: string; snapshotData: unknown }>();
    }
    const rows = await this.db
      .selectFrom('collaboration.publication_garden_snapshot_detail')
      .select(['item_id', 'overview_text', 'snapshot_data'])
      .where('item_id', 'in', itemIds)
      .execute();
    return new Map(
      rows.map((row) => [
        row.item_id,
        { overviewText: row.overview_text, snapshotData: parseSnapshotData(row.snapshot_data) },
      ]),
    );
  }

  private async selectTimelineEntryDetails(itemIds: readonly string[]) {
    if (itemIds.length === 0) {
      return new Map<string, { entryText: string }>();
    }
    const rows = await this.db
      .selectFrom('collaboration.publication_timeline_entry_detail')
      .select(['item_id', 'entry_text'])
      .where('item_id', 'in', itemIds)
      .execute();
    return new Map(rows.map((row) => [row.item_id, { entryText: row.entry_text }]));
  }

  private async selectObservationDetails(itemIds: readonly string[]) {
    if (itemIds.length === 0) {
      return new Map<string, { narrativeText: string; sourceObservationId: string | null }>();
    }
    const rows = await this.db
      .selectFrom('collaboration.publication_observation_detail')
      .select(['item_id', 'narrative_text', 'source_observation_id'])
      .where('item_id', 'in', itemIds)
      .execute();
    return new Map(
      rows.map((row) => [
        row.item_id,
        { narrativeText: row.narrative_text, sourceObservationId: row.source_observation_id },
      ]),
    );
  }

  private toItemDetail(
    item: { id: string; publication_version_id: string; kind: string; occurred_at: Date },
    workLogDetails: Map<string, { description: string; sourceWorkLogId: string | null }>,
    mediaDetails: Map<string, { mediaRecordId: string; mediaRole: string; caption: string | null }>,
    gardenSnapshotDetails: Map<string, { overviewText: string; snapshotData: unknown }>,
    timelineEntryDetails: Map<string, { entryText: string }>,
    observationDetails: Map<string, { narrativeText: string; sourceObservationId: string | null }>,
  ): PublicationItemDetail {
    switch (item.kind) {
      case 'work_log': {
        // Every `publication_item` row has a matching detail row in its own
        // kind's table (the same foreign-key-backed invariant
        // `KyselyPublicationRepository.create` writes both halves under);
        // a missing entry here would mean data corruption, not a case to
        // silently paper over with a fallback value.
        const detail = workLogDetails.get(item.id);
        if (detail === undefined) {
          throw new Error(`Missing publication_work_log_detail for item ${item.id}`);
        }
        return {
          id: item.id,
          kind: 'work_log',
          occurredAt: item.occurred_at,
          description: detail.description,
          sourceWorkLogId: detail.sourceWorkLogId,
        };
      }
      case 'media': {
        const detail = mediaDetails.get(item.id);
        if (detail === undefined) {
          throw new Error(`Missing publication_media_detail for item ${item.id}`);
        }
        return {
          id: item.id,
          kind: 'media',
          occurredAt: item.occurred_at,
          mediaRecordId: detail.mediaRecordId,
          mediaRole: detail.mediaRole as PublicationMediaRole,
          caption: detail.caption,
        };
      }
      case 'garden_snapshot': {
        const detail = gardenSnapshotDetails.get(item.id);
        if (detail === undefined) {
          throw new Error(`Missing publication_garden_snapshot_detail for item ${item.id}`);
        }
        return {
          id: item.id,
          kind: 'garden_snapshot',
          occurredAt: item.occurred_at,
          overviewText: detail.overviewText,
          snapshotData: detail.snapshotData,
        };
      }
      case 'timeline_entry': {
        const detail = timelineEntryDetails.get(item.id);
        if (detail === undefined) {
          throw new Error(`Missing publication_timeline_entry_detail for item ${item.id}`);
        }
        return {
          id: item.id,
          kind: 'timeline_entry',
          occurredAt: item.occurred_at,
          entryText: detail.entryText,
        };
      }
      case 'observation': {
        const detail = observationDetails.get(item.id);
        if (detail === undefined) {
          throw new Error(`Missing publication_observation_detail for item ${item.id}`);
        }
        return {
          id: item.id,
          kind: 'observation',
          occurredAt: item.occurred_at,
          narrativeText: detail.narrativeText,
          sourceObservationId: detail.sourceObservationId,
        };
      }
      default:
        throw new Error(`Unknown publication_item.kind "${item.kind}" for item ${item.id}`);
    }
  }
}

/**
 * `publication_garden_snapshot_detail.snapshot_data` is a `jsonb` column
 * (this module's own `PublicationGardenSnapshotDetailRow.snapshot_data` types
 * it merely as `string | null`, mirroring the write side's own
 * `JSON.stringify`-before-insert convention — see
 * `KyselyPublicationRepository.create`'s identical comment). `node-postgres`
 * parses `jsonb` into a real JS value by default, so this defends both
 * possibilities — an already-parsed value, or a genuine JSON string —
 * without assuming either.
 */
function parseSnapshotData(raw: string | null): unknown {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'string') {
    // Declared as `string` (see this function's own header for why), but
    // defended anyway: if the driver ever hands back an already-parsed
    // value despite the declared row type, pass it through unchanged
    // rather than attempting to `JSON.parse` a non-string.
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
