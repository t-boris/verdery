/**
 * P11-PROV-01's own authorization gate — there is no platform-wide
 * "reviewer" role anywhere in this codebase (`docs/architecture/identity-
 * and-authorization.md` section 13 describes staff/support access only as
 * an undesigned aspiration), so this is a comma-separated verified-email
 * allowlist (`PLANT_REVIEWER_EMAILS`), the smallest gate that needs no new
 * DB/role infrastructure.
 *
 * The guard lives HERE, called first thing inside each use case's
 * `execute()` — never a Fastify preHandler — mirroring
 * `OrganizationAuthorization.requireCapability`'s own "the guard is a call
 * at the top of the use case" convention, just without a
 * capability-repository behind it.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ForbiddenError } from '../../../platform/errors/application-error.js';

export interface PlantReviewerActor {
  readonly email: string | undefined;
  readonly emailVerified: boolean;
}

/** Throws `ForbiddenError` unless `actor` carries a verified email present in `reviewerEmails` (already lower-cased by `toApplicationConfiguration`). */
export function requirePlantReviewerAccess(
  reviewerEmails: readonly string[],
  actor: PlantReviewerActor,
): void {
  if (reviewerEmails.length === 0) {
    throw new ForbiddenError(
      SharedErrorCode.Forbidden,
      'No plant-fact reviewer is configured for this environment.',
    );
  }
  if (actor.email === undefined || !actor.emailVerified) {
    throw new ForbiddenError(
      SharedErrorCode.Forbidden,
      'Reviewing a plant-fact assertion requires a verified email.',
    );
  }
  if (!reviewerEmails.includes(actor.email.toLowerCase())) {
    throw new ForbiddenError(
      SharedErrorCode.Forbidden,
      'This account is not an authorized plant-fact reviewer.',
    );
  }
}
