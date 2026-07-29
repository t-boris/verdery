/**
 * Kysely implementation of `PlantDistributionAssertionRepository` over
 * `integrations.plant_distribution_assertion`. Append-only: `insert` is the
 * table's only write — mirrors `KyselyPlantFactAssertionRepository` exactly,
 * retargeted to the distribution table's own columns.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { PlantDistributionAssertionRepository } from '../application/plant-distribution-assertion-repository.js';
import type {
  PlantAssertionAuthoring,
  PlantAssertionReview,
} from '../domain/plant-assertion-provenance.js';
import type {
  DistributionStatus,
  PlantDistributionAssertion,
} from '../domain/plant-distribution-assertion.js';
import type { PlantDistributionAssertionRow } from './schema.js';

function toAuthoring(row: Selectable<PlantDistributionAssertionRow>): PlantAssertionAuthoring {
  if (row.authoring_method === 'ai_extracted_from_source') {
    if (row.source_citation === null) {
      throw new Error(
        `plant_distribution_assertion ${row.id} claims ai_extracted_from_source with no source_citation — the migration's own CHECK should make this unreachable.`,
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

function toReview(row: Selectable<PlantDistributionAssertionRow>): PlantAssertionReview {
  if (row.review_status === 'horticulturally_reviewed') {
    if (row.reviewed_by === null || row.reviewed_on === null) {
      throw new Error(
        `plant_distribution_assertion ${row.id} claims horticulturally_reviewed with no reviewer — the migration's own CHECK should make this unreachable.`,
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

function toPlantDistributionAssertion(
  row: Selectable<PlantDistributionAssertionRow>,
): PlantDistributionAssertion {
  return {
    id: row.id,
    providerTaxonId: row.provider_taxon_id,
    region: row.region,
    status: row.status as DistributionStatus,
    confidence: row.confidence,
    provenance: { ...toAuthoring(row), ...toReview(row) },
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
  };
}

export class KyselyPlantDistributionAssertionRepository implements PlantDistributionAssertionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(assertion: PlantDistributionAssertion): Promise<void> {
    const authoring = assertion.provenance;
    const review = assertion.provenance;
    await this.db
      .insertInto('integrations.plant_distribution_assertion')
      .values({
        id: assertion.id,
        provider_key: authoring.providerKey,
        provider_taxon_id: assertion.providerTaxonId,
        region: assertion.region,
        status: assertion.status,
        confidence: assertion.confidence,
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
  ): Promise<readonly PlantDistributionAssertion[]> {
    const rows = await this.db
      .selectFrom('integrations.plant_distribution_assertion')
      .selectAll()
      .where('provider_key', '=', providerKey)
      .where('provider_taxon_id', '=', providerTaxonId)
      .execute();

    return rows.map(toPlantDistributionAssertion);
  }
}
