/**
 * Maps the domain `Garden` to the exact shape the API contract returns.
 *
 * Application code returns this contract-shaped view, not the domain entity,
 * from every command handler: the idempotency store caches the literal
 * response a retried request must replay, so what a use case returns and
 * what the client eventually receives must be one and the same value, not
 * two shapes a transport-layer mapping step could let drift apart.
 */

import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { Garden } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';

export function toGardenResource(garden: Garden, callerRole: GardenRole): GardenResource {
  return {
    id: garden.id,
    name: garden.name,
    lifecycleState:
      garden.lifecycleState === 'deletion_requested' ? 'deletionRequested' : garden.lifecycleState,
    callerRole,
    revision: garden.revision,
    createdAt: garden.createdAt.toISOString(),
    updatedAt: garden.updatedAt.toISOString(),
  };
}
