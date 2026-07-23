/**
 * A registered client installation: one app install on one device, per
 * `packages/api-contracts/openapi.yaml`'s `SyncClientInstallation`.
 *
 * Deliberately not a revision-guarded aggregate like `Garden`/`Plant`/`Task`:
 * there is no `expectedRevision`/`If-Match` on `registerSyncClient` (the
 * OpenAPI operation takes only `Idempotency-Key`), and every field this type
 * carries is simply overwritten on every register-or-refresh call — see
 * `sync-client-installation-repository.ts`'s own doc comment for why
 * `profileId` in particular is reassignable, not fixed at first insert.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type SyncClientPlatform = 'ios' | 'web';

export interface SyncClientInstallation {
  readonly id: Uuid;
  readonly profileId: Uuid;
  readonly platform: SyncClientPlatform;
  readonly appVersion: string;
  readonly protocolVersion: number;
  readonly registeredAt: Date;
  readonly lastSeenAt: Date;
}
