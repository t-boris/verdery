import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenSeasonalFactAcceptanceInput,
  TaxonomySeasonalFactProposalInput,
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

  async findAcceptedForGarden(
    gardenId: Uuid,
    taxonomyReferenceId: Uuid,
    hemisphere: Hemisphere,
  ): Promise<TaxonomySeasonalFact | null> {
    // The join IS the gate: with no acceptance row for this garden the fact
    // does not come back at all. It is an inner join rather than a filter
    // applied afterwards so there is no shape of this query that returns an
    // unaccepted fact for a caller to forget to check.
    const row = await this.db
      .selectFrom('plants_inventory.taxonomy_seasonal_fact as fact')
      .innerJoin(
        'plants_inventory.garden_seasonal_fact_acceptance as acceptance',
        'acceptance.taxonomy_seasonal_fact_id',
        'fact.id',
      )
      .selectAll('fact')
      .where('acceptance.garden_id', '=', gardenId)
      .where('fact.taxonomy_reference_id', '=', taxonomyReferenceId)
      .where('fact.hemisphere', '=', hemisphere)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return toTaxonomySeasonalFact(row);
  }

  async listAwaitingAcceptanceForGarden(
    gardenId: Uuid,
    hemisphere: Hemisphere,
    limit: number,
  ): Promise<readonly TaxonomySeasonalFactReviewItem[]> {
    // Joined to the taxon so the queue carries names rather than UUIDs — no
    // one can judge sowing months for an identifier. Restricted to taxa this
    // garden actually grows, because those are the only ones its owner is in
    // a position to decide about.
    const rows = await this.db
      .selectFrom('plants_inventory.taxonomy_seasonal_fact as fact')
      .innerJoin(
        'plants_inventory.taxonomy_reference as reference',
        'reference.id',
        'fact.taxonomy_reference_id',
      )
      .selectAll('fact')
      .select(['reference.scientific_name', 'reference.common_name'])
      .where('fact.hemisphere', '=', hemisphere)
      // Grown here…
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('plants_inventory.plant')
            .select('plants_inventory.plant.id')
            .whereRef(
              'plants_inventory.plant.taxonomy_reference_id',
              '=',
              'fact.taxonomy_reference_id',
            )
            .where('plants_inventory.plant.garden_id', '=', gardenId)
            // Same `status = 'active'` probe the evaluation source uses to
            // decide a garden has anything worth evaluating: a removed
            // plant is not a reason to ask its owner about sowing months.
            .where('plants_inventory.plant.status', '=', 'active'),
        ),
      )
      // …and not already decided.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('plants_inventory.garden_seasonal_fact_acceptance as accepted')
              .select('accepted.id')
              .whereRef('accepted.taxonomy_seasonal_fact_id', '=', 'fact.id')
              .where('accepted.garden_id', '=', gardenId),
          ),
        ),
      )
      .orderBy('fact.created_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      fact: toTaxonomySeasonalFact(row),
      scientificName: row.scientific_name,
      commonName: row.common_name,
    }));
  }

  async acceptForGarden(input: GardenSeasonalFactAcceptanceInput): Promise<boolean> {
    // The hemisphere is re-checked HERE against the fact's own column rather
    // than trusted from the caller: an id names a `(taxon, hemisphere)` pair,
    // and a garden accepting timing computed for the other half of the world
    // would light its rules with inverted months. `false` covers both "no
    // such fact" and "wrong hemisphere" — from the caller's side both mean
    // "there is nothing here for this garden to accept", and separating them
    // would let a probe confirm an id exists.
    const inserted = await this.db
      .insertInto('plants_inventory.garden_seasonal_fact_acceptance')
      .columns([
        'id',
        'garden_id',
        'taxonomy_seasonal_fact_id',
        'accepted_by_profile_id',
        'accepted_on',
      ])
      .expression((eb) =>
        eb
          .selectFrom('plants_inventory.taxonomy_seasonal_fact as fact')
          .select((select) => [
            select.val(input.id).as('id'),
            select.val(input.gardenId).as('garden_id'),
            'fact.id as taxonomy_seasonal_fact_id',
            select.val(input.acceptedByProfileId).as('accepted_by_profile_id'),
            select.val(input.acceptedOn).as('accepted_on'),
          ])
          .where('fact.id', '=', input.taxonomySeasonalFactId)
          .where('fact.hemisphere', '=', input.hemisphere),
      )
      // Accepting twice is one decision recorded once, not an error: a
      // retried or double-submitted accept must not fail the caller.
      .onConflict((conflict) =>
        conflict.columns(['garden_id', 'taxonomy_seasonal_fact_id']).doNothing(),
      )
      .executeTakeFirst();

    if (Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0) {
      return true;
    }

    // Nothing inserted means either the fact did not match, or it was
    // already accepted. Only the second is success, so it is confirmed
    // rather than assumed.
    const existing = await this.db
      .selectFrom('plants_inventory.garden_seasonal_fact_acceptance')
      .select('id')
      .where('garden_id', '=', input.gardenId)
      .where('taxonomy_seasonal_fact_id', '=', input.taxonomySeasonalFactId)
      .executeTakeFirst();

    return existing !== undefined;
  }

  async insertProposal(input: TaxonomySeasonalFactProposalInput): Promise<boolean> {
    const inserted = await this.db
      .insertInto('plants_inventory.taxonomy_seasonal_fact')
      .values({
        id: input.id,
        taxonomy_reference_id: input.taxonomyReferenceId,
        hemisphere: input.hemisphere,
        sow_indoors_start_month: input.sowIndoorsStartMonth,
        sow_indoors_end_month: input.sowIndoorsEndMonth,
        sow_outdoors_start_month: input.sowOutdoorsStartMonth,
        sow_outdoors_end_month: input.sowOutdoorsEndMonth,
        transplant_start_month: input.transplantStartMonth,
        transplant_end_month: input.transplantEndMonth,
        harvest_start_month: input.harvestStartMonth,
        harvest_end_month: input.harvestEndMonth,
        days_to_maturity_min: input.daysToMaturityMin,
        days_to_maturity_max: input.daysToMaturityMax,
        succession_interval_days: input.successionIntervalDays,
        rotation_rest_seasons: input.rotationRestSeasons,
        // Fixed, never caller-supplied: this path exists for one lane, and
        // recording AI output as human-authored would be a provenance lie.
        // The migration's own citation-linkage CHECK requires a NULL
        // citation for this method, which is why none is written.
        authoring_method: 'ai_proposed_reviewed',
        source_citation: null,
        review_status: 'awaiting_horticultural_review',
        reviewed_by: null,
        reviewed_on: null,
      })
      // The table's unique `(taxonomy_reference_id, hemisphere)` key does
      // the work: a second pass over the same taxon proposes nothing, and a
      // reviewer's approved row is never overwritten.
      .onConflict((conflict) =>
        conflict.columns(['taxonomy_reference_id', 'hemisphere']).doNothing(),
      )
      .executeTakeFirst();

    return Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0;
  }
}
