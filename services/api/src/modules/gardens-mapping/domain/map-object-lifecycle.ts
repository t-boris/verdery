/**
 * Shared transition logic for `DeleteMapObject` and `RestoreMapObject` — the
 * two commands are near-mirrors of each other, so the one rule they share
 * ("cannot transition to the state the object is already in") lives here
 * once rather than duplicated in each handler's `execute()`.
 */

import { MapErrorCode } from '@verdery/api-contracts';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { MapObject, MapObjectLifecycleState } from './map-object.js';

export function transitionMapObjectLifecycle(
  object: MapObject,
  target: MapObjectLifecycleState,
  now: Date,
): MapObject {
  if (object.lifecycleState === target) {
    throw new DomainRuleViolatedError(
      MapErrorCode.LifecycleConflict,
      target === 'deleted'
        ? 'This map object has already been deleted.'
        : 'This map object is not deleted.',
    );
  }

  return {
    ...object,
    lifecycleState: target,
    currentRevision: object.currentRevision + 1,
    updatedAt: now,
  };
}
