/**
 * The garden aggregate: identity and lifecycle metadata only.
 *
 * No coordinate space, map objects, or geometry — those arrive with
 * P3-DATA-01. Ownership is expressed through `collaboration.membership` (a
 * role), never a foreign key on this entity: "the permission matrix is
 * implemented as stable capabilities rather than scattered role-name
 * comparisons."
 *
 * Source: architecture/identity-and-authorization.md, section "8. Garden Roles";
 * architecture/data-and-geospatial-design.md, section "6. Garden Aggregate".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { GardenErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type GardenLifecycleState = 'active' | 'archived' | 'deletion_requested';

const MAX_NAME_LENGTH = 120;

export interface Garden {
  readonly id: Uuid;
  readonly name: string;
  readonly lifecycleState: GardenLifecycleState;
  readonly revision: number;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletionRequestedAt: Date | null;
}

/**
 * Trims and validates a proposed garden name.
 *
 * The OpenAPI schema already enforces `minLength`/`maxLength` before a
 * handler runs, but a string of only spaces satisfies both while still
 * failing the migration's `garden_name_not_blank` check — this function is
 * what turns that case into a clean `ValidationError` instead of a raw
 * constraint-violation error surfacing from the database.
 */
export function validateGardenName(rawName: string): string {
  const name = rawName.trim();

  if (name.length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'Garden name must not be blank.', {
      details: [{ code: 'garden.name.blank', pointer: '/name' }],
    });
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `Garden name must be at most ${String(MAX_NAME_LENGTH)} characters.`,
      { details: [{ code: 'garden.name.too_long', pointer: '/name' }] },
    );
  }

  return name;
}

export function createGarden(id: Uuid, rawName: string, ownerProfileId: Uuid, now: Date): Garden {
  return {
    id,
    name: validateGardenName(rawName),
    lifecycleState: 'active',
    revision: 1,
    createdByProfileId: ownerProfileId,
    createdAt: now,
    updatedAt: now,
    deletionRequestedAt: null,
  };
}

function requireMutable(garden: Garden): void {
  if (garden.lifecycleState === 'deletion_requested') {
    throw new DomainRuleViolatedError(
      GardenErrorCode.LifecycleConflict,
      'A garden pending deletion cannot be changed.',
    );
  }
}

export function renameGarden(garden: Garden, rawName: string, now: Date): Garden {
  requireMutable(garden);

  return {
    ...garden,
    name: validateGardenName(rawName),
    revision: garden.revision + 1,
    updatedAt: now,
  };
}

export function archiveGarden(garden: Garden, now: Date): Garden {
  if (garden.lifecycleState !== 'active') {
    throw new DomainRuleViolatedError(
      GardenErrorCode.LifecycleConflict,
      garden.lifecycleState === 'archived'
        ? 'This garden is already archived.'
        : 'A garden pending deletion cannot be archived.',
    );
  }

  return { ...garden, lifecycleState: 'archived', revision: garden.revision + 1, updatedAt: now };
}

export function requestGardenDeletion(garden: Garden, now: Date): Garden {
  if (garden.lifecycleState === 'deletion_requested') {
    throw new DomainRuleViolatedError(
      GardenErrorCode.LifecycleConflict,
      'Deletion has already been requested for this garden.',
    );
  }

  return {
    ...garden,
    lifecycleState: 'deletion_requested',
    revision: garden.revision + 1,
    updatedAt: now,
    deletionRequestedAt: now,
  };
}
