/**
 * The capability each routed operation FAMILY requires at the sync push
 * boundary — G-8, `docs/development/garden-capability-matrix.md`: until now,
 * `push-sync-operations.ts`/`sync-operation-router.ts`/the four
 * `route-*-operation.ts` files performed no capability check of their own,
 * inheriting safety entirely from whatever the delegated command happened to
 * check. This is a defence-in-depth BOUNDARY assertion, not a replacement for
 * those per-command checks, which stay exactly as they are.
 *
 * One capability per family, not per command, because every command actually
 * routed through sync within a family already requires the SAME one —
 * verified by inspection, not assumed:
 *
 * - `gardenObject` (all 13 map commands), `plant` (all 9), `observation`
 *   (both), `task` (all 8, excluding `assignTask`, which is not part of the
 *   sync push protocol at all — `SyncTaskCommand` has no `tasks.assignTask`
 *   member) — every one calls `GardenAuthorization.requireCapability` with
 *   `'editGardenContent'`, directly or through a shared `require*AndAuthorize`
 *   helper.
 * - `garden` — `gardens.rename`/`gardens.archive`/`gardens.delete_request`
 *   all require `'manageGarden'`. `gardens.create` requires nothing: it
 *   names a garden that does not exist yet, so there is no membership to
 *   check against — `null` here means "no boundary check applies", not "any
 *   role may do this forever"; `CreateGarden` itself has no capability gate
 *   either, by the same necessity.
 *
 * A future command that needs a DIFFERENT capability than its family's
 * declared one is exactly the case this file's own exhaustive switch over
 * `SyncOperationPayload['recordType']` forces a reviewer to confront: the
 * switch cannot silently keep compiling for a new `recordType` without a
 * matching arm here.
 */

import type { SyncOperationPayload } from '@verdery/api-contracts';
import type { GardenCapability } from '../../gardens-mapping/public.js';

/** `null` means no boundary check applies for this exact payload — see this file's own header comment on `gardens.create`. */
export function requiredPushCapability(payload: SyncOperationPayload): GardenCapability | null {
  switch (payload.recordType) {
    case 'garden':
      return payload.command.commandType === 'gardens.create' ? null : 'manageGarden';
    case 'gardenObject':
    case 'plant':
    case 'observation':
    case 'task':
      return 'editGardenContent';
  }
}
