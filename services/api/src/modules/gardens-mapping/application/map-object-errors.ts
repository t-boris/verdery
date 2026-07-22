/**
 * Shared error constructors for the map object aggregate — the equivalent of
 * `apply-revision-guarded-update.ts`'s inline `staleRevisionError`, factored
 * out because more than one command handler needs the "not found" case too
 * (every command targeting an existing object starts by looking it up).
 */

import { MapErrorCode } from '@verdery/api-contracts';
import { NotFoundError, StaleRevisionError } from '../../../platform/errors/application-error.js';

export function mapObjectNotFoundError(): NotFoundError {
  return new NotFoundError(MapErrorCode.NotFound, 'Map object not found.');
}

export function mapObjectStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    MapErrorCode.StaleRevision,
    'The map object changed before this command was applied.',
    { details: [{ code: 'map.object.revision', parameters: { currentRevision } }] },
  );
}
