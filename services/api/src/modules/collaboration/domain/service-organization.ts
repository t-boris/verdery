/**
 * The service-organization aggregate: identity and optimistic-concurrency
 * bookkeeping only.
 *
 * No lifecycle state, matching the P9B-DATA-01 migration's own "NO LIFECYCLE
 * ON `service_organization`" comment: nothing in this package's scope asks an
 * organization to be archived, suspended, or deleted, so no vocabulary is
 * declared with zero producers. If organization deletion ever becomes a real
 * requirement, it arrives as an additive migration then, the same way garden
 * deletion arrived in P8-DELETE-01 well after gardens themselves did.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "7. Service Organizations and Assignments";
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Service Organizations".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

const MAX_NAME_LENGTH = 120;

export interface ServiceOrganization {
  readonly id: Uuid;
  readonly name: string;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Trims and validates a proposed organization name — the same
 * blank-after-trim safety net `gardens_mapping/domain/garden.ts`'s
 * `validateGardenName` provides for `garden_name_not_blank`, applied here
 * against `service_organization_name_not_blank_check`. The OpenAPI schema
 * already enforces `minLength`/`maxLength` before a handler runs, but a
 * string of only spaces satisfies both while still failing the database
 * CHECK — this function is what turns that case into a clean
 * `ValidationError` instead of a raw constraint-violation error surfacing
 * from the database.
 */
export function validateOrganizationName(rawName: string): string {
  const name = rawName.trim();

  if (name.length === 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'Organization name must not be blank.',
      { details: [{ code: 'organization.name.blank', pointer: '/name' }] },
    );
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `Organization name must be at most ${String(MAX_NAME_LENGTH)} characters.`,
      { details: [{ code: 'organization.name.too_long', pointer: '/name' }] },
    );
  }

  return name;
}

/**
 * Builds a new organization, `revision` 1. Creating the organization's first
 * `organization_membership` row (the caller, as `organization_admin`) is the
 * caller's job, in the same transaction — mirroring `createGarden`, which
 * likewise only builds the garden entity itself and leaves granting the
 * first membership to `CreateGarden.execute` (ADR-0012: "a solo professional
 * may start with an organization containing one administrator").
 */
export function createServiceOrganization(
  id: Uuid,
  rawName: string,
  now: Date,
): ServiceOrganization {
  return {
    id,
    name: validateOrganizationName(rawName),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}
