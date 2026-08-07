import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  TaxonomySeasonalFactRepository,
  TaxonomySeasonalFactReviewItem,
} from '../application/taxonomy-seasonal-fact-repository.js';
import type {
  Hemisphere,
  TaxonomySeasonalAuthoringMethod,
  TaxonomySeasonalFact,
  TaxonomySeasonalReviewStatus,
} from '../domain/taxonomy-seasonal-fact.js';

interface TaxonomySeasonalFactRowLike {
  id: string;
  taxonomy_reference_id: string;
  hemisphere: string;
  sow_indoors_start_month: number | null;
  sow_indoors_end_month: number | null;
  sow_outdoors_start_month: number | null;
  sow_outdoors_end_month: number | null;
  transplant_start_month: number | null;
  transplant_end_month: number | null;
  harvest_start_month: number | null;
  harvest_end_month: number | null;
  days_to_maturity_min: number | null;
  days_to_maturity_max: number | null;
  succession_interval_days: number | null;
  rotation_rest_seasons: number | null;
  authoring_method: string;
  source_citation: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_on: string | null;
  created_at: Date;
}

/**
 * Trusts the row's own CHECK-constrained columns rather than re-running
 * `validateTaxonomySeasonalFactProvenance`: unlike `garden_context_fact`
 * (populated through an HTTP-facing command over untrusted request bodies),
 * every row here already passed the migration's own
 * `taxonomy_seasonal_fact_source_citation_linkage_check`/
 * `taxonomy_seasonal_fact_reviewed_linkage_check`/
 * `taxonomy_seasonal_fact_reviewed_on_linkage_check` at insert time — the
 * same "trust the DB CHECK on the read side" posture
 * `kysely-taxonomy-reference-repository.ts`'s own `source` cast already
 * takes for `TaxonomySource`.
 */
function toTaxonomySeasonalFact(row: TaxonomySeasonalFactRowLike): TaxonomySeasonalFact {
  const authoring =
    row.authoring_method === 'ai_extracted_from_source'
      ? {
          authoringMethod: 'ai_extracted_from_source' as const,
          sourceCitation: row.source_citation as string,
        }
      : {
          authoringMethod: row.authoring_method as Exclude<
            TaxonomySeasonalAuthoringMethod,
            'ai_extracted_from_source'
          >,
        };
  const review =
    row.review_status === 'horticulturally_reviewed'
      ? {
          reviewStatus: 'horticulturally_reviewed' as const,
          reviewedBy: row.reviewed_by as string,
          reviewedOn: row.reviewed_on as string,
        }
      : {
          reviewStatus: row.review_status as Exclude<
            TaxonomySeasonalReviewStatus,
            'horticulturally_reviewed'
          >,
        };

  return {
    id: row.id,
    taxonomyReferenceId: row.taxonomy_reference_id,
    hemisphere: row.hemisphere as Hemisphere,
    sowIndoorsStartMonth: row.sow_indoors_start_month,
    sowIndoorsEndMonth: row.sow_indoors_end_month,
    sowOutdoorsStartMonth: row.sow_outdoors_start_month,
    sowOutdoorsEndMonth: row.sow_outdoors_end_month,
    transplantStartMonth: row.transplant_start_month,
    transplantEndMonth: row.transplant_end_month,
    harvestStartMonth: row.harvest_start_month,
    harvestEndMonth: row.harvest_end_month,
    daysToMaturityMin: row.days_to_maturity_min,
    daysToMaturityMax: row.days_to_maturity_max,
    successionIntervalDays: row.succession_interval_days,
    rotationRestSeasons: row.rotation_rest_seasons,
    createdAt: row.created_at,
    ...authoring,
    ...review,
  };
}

export class KyselyTaxonomySeasonalFactRepository implements TaxonomySeasonalFactRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findReviewedForTaxonomyAndHemisphere(
    taxonomyReferenceId: Uuid,
    hemisphere: Hemisphere,
  ): Promise<TaxonomySeasonalFact | null> {
    const row = await this.db
      .selectFrom('plants_inventory.taxonomy_seasonal_fact')
      .selectAll()
      .where('taxonomy_reference_id', '=', taxonomyReferenceId)
      .where('hemisphere', '=', hemisphere)
      .where('review_status', '=', 'horticulturally_reviewed')
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return toTaxonomySeasonalFact(row);
  }

  async listAwaitingReview(limit: number): Promise<readonly TaxonomySeasonalFactReviewItem[]> {
    // Joined to the taxon so the queue carries names rather than UUIDs — a
    // reviewer cannot judge sowing months for an identifier.
    const rows = await this.db
      .selectFrom('plants_inventory.taxonomy_seasonal_fact as fact')
      .innerJoin(
        'plants_inventory.taxonomy_reference as reference',
        'reference.id',
        'fact.taxonomy_reference_id',
      )
      .selectAll('fact')
      .select(['reference.scientific_name', 'reference.common_name'])
      .where('fact.review_status', '=', 'awaiting_horticultural_review')
      .orderBy('fact.created_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      fact: toTaxonomySeasonalFact(row),
      scientificName: row.scientific_name,
      commonName: row.common_name,
    }));
  }

  async approve(id: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean> {
    // Guarded on the CURRENT status, so two reviewers racing the same row
    // produce one approval and one honest "nothing left to approve" — the
    // same conditional-update shape `ApprovePlantAssertionReview` relies on.
    const result = await this.db
      .updateTable('plants_inventory.taxonomy_seasonal_fact')
      .set({
        review_status: 'horticulturally_reviewed',
        reviewed_by: reviewedBy,
        reviewed_on: reviewedOn,
      })
      .where('id', '=', id)
      .where('review_status', '=', 'awaiting_horticultural_review')
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }
}
