/**
 * Kysely implementation of `PlantContentRecordRepository` over
 * `integrations.plant_content_record`.
 *
 * Append-only: `insert` is the table's only write. Reads key by the
 * PROVIDER's taxon identity — application-taxonomy resolution goes through
 * the live mapping, never through these rows.
 *
 * Source: migrations/1785900000000_integrations-plant-content-baseline.sql.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { PlantContentRecord } from '../domain/plant-content-record.js';
import type { PlantContentRecordRepository } from '../application/plant-content-record-repository.js';
import type { PlantContentRecordRow } from './schema.js';

function toPlantContentRecord(row: Selectable<PlantContentRecordRow>): PlantContentRecord {
  return {
    id: row.id,
    providerKey: row.provider_key,
    providerTaxonId: row.provider_taxon_id,
    source: {
      providerRecordId: row.provider_record_id,
      providerContentVersion: row.provider_content_version,
      contentLanguage: row.content_language,
    },
    sections: {
      description: row.description,
      careGuidance: row.care_guidance,
    },
    fetchedAt: row.fetched_at,
    licenseNote: row.license_note,
    attributionText: row.attribution_text,
    jurisdiction: row.jurisdiction,
    presentationNote: row.presentation_note,
    createdAt: row.created_at,
  };
}

export class KyselyPlantContentRecordRepository implements PlantContentRecordRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(record: PlantContentRecord): Promise<void> {
    await this.db
      .insertInto('integrations.plant_content_record')
      .values({
        id: record.id,
        provider_key: record.providerKey,
        provider_taxon_id: record.providerTaxonId,
        provider_record_id: record.source.providerRecordId,
        provider_content_version: record.source.providerContentVersion,
        content_language: record.source.contentLanguage,
        description: record.sections.description,
        care_guidance: record.sections.careGuidance,
        fetched_at: record.fetchedAt,
        license_note: record.licenseNote,
        attribution_text: record.attributionText,
        jurisdiction: record.jurisdiction,
        presentation_note: record.presentationNote,
        created_at: record.createdAt,
      })
      .execute();
  }

  async findLatest(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<PlantContentRecord | null> {
    const row = await this.db
      .selectFrom('integrations.plant_content_record')
      .selectAll()
      .where('provider_key', '=', providerKey)
      .where('provider_taxon_id', '=', providerTaxonId)
      .orderBy('fetched_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? null : toPlantContentRecord(row);
  }
}
