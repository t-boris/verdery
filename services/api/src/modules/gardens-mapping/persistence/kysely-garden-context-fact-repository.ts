/**
 * Kysely implementation of `GardenContextFactRepository` (P9D-CONTEXT-01).
 *
 * `recordOrUpdate` mirrors `KyselyProviderQuotaRepository.advanceWindow`'s
 * `sql\`... + 1\`` increment inside `doUpdateSet` (see that file's header)
 * for `revision`, and `KyselySyncClientInstallationRepository.registerOrRefresh`
 * for the overall "one INSERT ... ON CONFLICT DO UPDATE, no prior SELECT"
 * shape — both established precedents for this exact
 * create-or-update-by-natural-key pattern.
 *
 * `translateCheckViolation` here is a small LOCAL copy, not this module's
 * shared `persistence/translate-check-violation.ts`: that file's own header
 * scopes it to "a `garden_object`/detail-table write" and hardcodes a
 * `map.constraint_violation.*` detail code — accurate for every OTHER table
 * that file guards, but `garden_context_fact` is not a map/geometry table,
 * so reusing that prefix here would mislabel the error. Mirrors the
 * `plants_inventory.constraint_violation.*`-prefixed copy
 * `plants-inventory/persistence/translate-check-violation.ts` already keeps
 * for the identical reason, sized down to a local function since only this
 * one repository method needs it.
 */

import { sql, type Kysely, type Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { SharedErrorCode } from '@verdery/api-contracts';
import {
  isCheckViolation,
  isForeignKeyViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenContextFact,
  GardenContextFactProvenance,
  GardenContextFactValue,
  GardenContextKind,
  GardenContextSource,
} from '../domain/garden-context-fact.js';
import type { GardenContextFactRepository } from '../application/garden-context-fact-repository.js';
import type { GardenContextFactRow } from './schema.js';

/** Returns a `ValidationError` for a `CHECK`/`FOREIGN KEY` violation on this table, `null` otherwise — see this file's header for why this is a local copy rather than the shared `map`-prefixed translator. */
function translateGardenContextFactCheckViolation(
  error: unknown,
  pointer: string,
): ValidationError | null {
  if (!isCheckViolation(error) && !isForeignKeyViolation(error)) {
    return null;
  }

  const constraint = postgresConstraintName(error) ?? 'unknown_constraint';

  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'The submitted data violates a database-enforced domain rule.',
    {
      details: [
        { code: `gardens_mapping.garden_context_fact.constraint_violation.${constraint}`, pointer },
      ],
      cause: error,
    },
  );
}

function toGardenContextFact(row: Selectable<GardenContextFactRow>): GardenContextFact {
  const value = {
    contextKind: row.context_kind as GardenContextKind,
    value: row.value,
  } as GardenContextFactValue;

  const provenance =
    row.source === 'horticulturally_reviewed_default'
      ? {
          source: 'horticulturally_reviewed_default' as const,
          // Non-null: `garden_context_fact_source_reviewed_linkage_check`
          // guarantees both are present exactly when `source` is this value.
          reviewedBy: row.reviewed_by as string,
          reviewedOn: row.reviewed_on as string,
        }
      : { source: row.source as Exclude<GardenContextSource, 'horticulturally_reviewed_default'> };

  return {
    ...value,
    ...provenance,
    id: row.id,
    gardenId: row.garden_id,
    recordedByProfileId: row.recorded_by_profile_id,
    recordedAt: row.recorded_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyGardenContextFactRepository implements GardenContextFactRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async recordOrUpdate(
    id: Uuid,
    gardenId: Uuid,
    input: GardenContextFactValue & GardenContextFactProvenance,
    recordedByProfileId: Uuid,
    now: Date,
  ): Promise<GardenContextFact> {
    const reviewedBy =
      input.source === 'horticulturally_reviewed_default' ? input.reviewedBy : null;
    const reviewedOn =
      input.source === 'horticulturally_reviewed_default' ? input.reviewedOn : null;

    try {
      const row = await this.db
        .insertInto('gardens_mapping.garden_context_fact')
        .values({
          id,
          garden_id: gardenId,
          context_kind: input.contextKind,
          value: input.value,
          source: input.source,
          reviewed_by: reviewedBy ?? null,
          reviewed_on: reviewedOn ?? null,
          recorded_by_profile_id: recordedByProfileId,
          recorded_at: now,
          revision: 1,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['garden_id', 'context_kind']).doUpdateSet({
            value: input.value,
            source: input.source,
            reviewed_by: reviewedBy ?? null,
            reviewed_on: reviewedOn ?? null,
            recorded_by_profile_id: recordedByProfileId,
            recorded_at: now,
            revision: sql<number>`gardens_mapping.garden_context_fact.revision + 1`,
            updated_at: now,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return toGardenContextFact(row);
    } catch (error) {
      const translated = translateGardenContextFactCheckViolation(error, '/value');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  async listForGarden(gardenId: Uuid): Promise<readonly GardenContextFact[]> {
    const rows = await this.db
      .selectFrom('gardens_mapping.garden_context_fact')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .orderBy('context_kind')
      .execute();

    return rows.map(toGardenContextFact);
  }
}
