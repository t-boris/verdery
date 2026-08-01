/**
 * Kysely implementation of `PlantFactAssertionRepository` over
 * `integrations.plant_fact_assertion`. Append-only: `insert` is the table's
 * only write.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantFactAssertionRepository } from '../application/plant-fact-assertion-repository.js';
import type {
  PlantAssertionAuthoring,
  PlantAssertionReview,
} from '../domain/plant-assertion-provenance.js';
import type { PlantFactAssertion } from '../domain/plant-fact-assertion.js';
import type { PlantFactAssertionRow } from './schema.js';

function toAuthoring(row: Selectable<PlantFactAssertionRow>): PlantAssertionAuthoring {
  if (row.authoring_method === 'ai_extracted_from_source') {
    if (row.source_citation === null) {
      throw new Error(
        `plant_fact_assertion ${row.id} claims ai_extracted_from_source with no source_citation — the migration's own CHECK should make this unreachable.`,
      );
    }
    return {
      authoringMethod: 'ai_extracted_from_source',
      sourceCitation: row.source_citation,
      providerKey: row.provider_key,
    };
  }
  return {
    authoringMethod: row.authoring_method as 'human_authored' | 'ai_proposed_reviewed',
    providerKey: row.provider_key,
  };
}

function toReview(row: Selectable<PlantFactAssertionRow>): PlantAssertionReview {
  if (row.review_status === 'horticulturally_reviewed') {
    if (row.reviewed_by === null || row.reviewed_on === null) {
      throw new Error(
        `plant_fact_assertion ${row.id} claims horticulturally_reviewed with no reviewer — the migration's own CHECK should make this unreachable.`,
      );
    }
    return {
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: row.reviewed_by,
      reviewedOn: row.reviewed_on,
    };
  }
  return { reviewStatus: 'awaiting_horticultural_review' };
}

function toPlantFactAssertion(row: Selectable<PlantFactAssertionRow>): PlantFactAssertion {
  return {
    id: row.id,
    providerTaxonId: row.provider_taxon_id,
    factKey: row.fact_key,
    factValue: row.fact_value,
    unit: row.unit,
    confidence: row.confidence,
    geographicScope: row.geographic_scope,
    provenance: { ...toAuthoring(row), ...toReview(row) },
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
  };
}

export class KyselyPlantFactAssertionRepository implements PlantFactAssertionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(assertion: PlantFactAssertion): Promise<void> {
    const authoring = assertion.provenance;
    const review = assertion.provenance;
    await this.db
      .insertInto('integrations.plant_fact_assertion')
      .values({
        id: assertion.id,
        provider_key: authoring.providerKey,
        provider_taxon_id: assertion.providerTaxonId,
        fact_key: assertion.factKey,
        fact_value: JSON.stringify(assertion.factValue),
        unit: assertion.unit,
        confidence: assertion.confidence,
        geographic_scope: assertion.geographicScope,
        authoring_method: authoring.authoringMethod,
        source_citation:
          authoring.authoringMethod === 'ai_extracted_from_source'
            ? authoring.sourceCitation
            : null,
        review_status: review.reviewStatus,
        reviewed_by: review.reviewStatus === 'horticulturally_reviewed' ? review.reviewedBy : null,
        reviewed_on: review.reviewStatus === 'horticulturally_reviewed' ? review.reviewedOn : null,
        fetched_at: assertion.fetchedAt,
        created_at: assertion.createdAt,
      })
      .execute();
  }

  async findAllForProviderTaxon(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantFactAssertion[]> {
    const rows = await this.db
      .selectFrom('integrations.plant_fact_assertion')
      .selectAll()
      .where('provider_key', '=', providerKey)
      .where('provider_taxon_id', '=', providerTaxonId)
      .execute();

    return rows.map(toPlantFactAssertion);
  }

  async findAllAwaitingReview(limit: number): Promise<readonly PlantFactAssertion[]> {
    const rows = await this.db
      .selectFrom('integrations.plant_fact_assertion')
      .selectAll()
      .where('review_status', '=', 'awaiting_horticultural_review')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map(toPlantFactAssertion);
  }

  async approveReview(assertionId: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean> {
    const result = await this.db
      .updateTable('integrations.plant_fact_assertion')
      .set({
        review_status: 'horticulturally_reviewed',
        reviewed_by: reviewedBy,
        reviewed_on: reviewedOn,
      })
      .where('id', '=', assertionId)
      .where('review_status', '=', 'awaiting_horticultural_review')
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }
}
