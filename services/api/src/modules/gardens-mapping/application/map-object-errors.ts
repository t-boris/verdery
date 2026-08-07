/**
 * Shared error constructors for the map object aggregate — the equivalent of
 * `apply-revision-guarded-update.ts`'s inline `staleRevisionError`, factored
 * out because more than one command handler needs the "not found" case too
 * (every command targeting an existing object starts by looking it up).
 */

import { MapErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import type { MapObject } from '../domain/map-object.js';

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

/** Enforces an individual object's durable edit lock at the application boundary. */
export function requireMapObjectEditable(object: MapObject): void {
  if (object.isLocked) {
    throw new DomainRuleViolatedError(
      MapErrorCode.Locked,
      'This map object is locked. Unlock it before changing its content.',
    );
  }
}
