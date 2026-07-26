import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenLifecycleState } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';
import type {
  GardenAssignmentAccess,
  GardenAssignmentAccessSource,
} from '../application/garden-assignment-access-source.js';

/**
 * SELECT-only cross-schema implementation of `GardenAssignmentAccessSource`
 * — the `KyselyGardenRecipientSource`/`KyselyEvaluationGardenSource`
 * narrow-read-port precedent (see the port's own header). Reads
 * `collaboration.garden_assignment`, a table the `collaboration` module
 * owns, through Kysely's shared typed schema; never imports or reuses
 * `collaboration`'s own `KyselyGardenAssignmentRepository`.
 *
 * INNER JOIN to `gardens_mapping.garden`, not a second query — the same
 * reason `KyselyMembershipRepository.findGardenAccess` joins rather than
 * reading the lifecycle state separately: authorization decides on the role
 * and the lifecycle state together, at one instant, and the join is what
 * turns a `garden_assignment` row naming an already-purged garden (the table
 * carries no foreign key on `garden_id` — see the P9B-DATA-01 migration's
 * own "NO FOREIGN KEY ON `garden_id`" comment) into the `null` the caller
 * conceals as `notFound`, instead of authorizing against a garden that no
 * longer exists.
 */
export class KyselyGardenAssignmentAccessSource implements GardenAssignmentAccessSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findActiveAssignment(
    gardenId: Uuid,
    profileId: Uuid,
  ): Promise<GardenAssignmentAccess | null> {
    const row = await this.db
      .selectFrom('collaboration.garden_assignment')
      .innerJoin(
        'gardens_mapping.garden',
        'gardens_mapping.garden.id',
        'collaboration.garden_assignment.garden_id',
      )
      .select([
        'collaboration.garden_assignment.id as id',
        'collaboration.garden_assignment.role as role',
        'gardens_mapping.garden.lifecycle_state as lifecycle_state',
      ])
      .where('collaboration.garden_assignment.garden_id', '=', gardenId)
      .where('collaboration.garden_assignment.profile_id', '=', profileId)
      .where('collaboration.garden_assignment.state', '=', 'active')
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      assignmentId: row.id,
      role: row.role as GardenRole,
      gardenLifecycleState: row.lifecycle_state as GardenLifecycleState,
    };
  }
}
