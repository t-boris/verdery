/**
 * Shared optimistic-concurrency guard for the garden lifecycle commands.
 *
 * Source: architecture/api-design.md, section "7. Optimistic Concurrency".
 */

import { GardenErrorCode } from '@verdery/api-contracts';
import { NotFoundError, StaleRevisionError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Garden } from '../domain/garden.js';
import type { GardenRepository } from './garden-repository.js';

function staleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    GardenErrorCode.StaleRevision,
    'The garden changed before this command was applied.',
    { details: [{ code: 'garden.revision', parameters: { currentRevision } }] },
  );
}

/**
 * Fetches the garden, checks it against `expectedRevision` (concealing a
 * missing garden as `notFound`, exactly like {@link GardenAuthorization}),
 * applies `transform`, and writes it back guarded by the *actually observed*
 * revision — a second, narrower check than the first: it only ever catches a
 * write racing in during this same transaction, which `expectedRevision`
 * cannot have anticipated.
 */
export async function applyRevisionGuardedUpdate(
  gardens: GardenRepository,
  gardenId: Uuid,
  expectedRevision: number,
  transform: (garden: Garden) => Garden,
): Promise<Garden> {
  const garden = await gardens.findById(gardenId);
  if (garden === null) {
    throw new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.');
  }
  if (garden.revision !== expectedRevision) {
    throw staleRevisionError(garden.revision);
  }

  const updated = transform(garden);
  const applied = await gardens.update(updated, garden.revision);
  if (!applied) {
    throw staleRevisionError(garden.revision);
  }

  return updated;
}
