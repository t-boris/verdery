/**
 * Port for `platform.sync_client_installation`.
 *
 * One method, not `insert`/`update`/`findById` separately: every write to
 * this table is a register-or-refresh, and the "insert vs. refresh"
 * distinction the OpenAPI operation needs (`201` vs. `200`) is exactly what
 * `wasCreated` reports back, computed by the same statement that performs
 * the write — see `KyselySyncClientInstallationRepository` for the
 * `INSERT ... ON CONFLICT DO UPDATE` this maps onto.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  SyncClientInstallation,
  SyncClientPlatform,
} from '../domain/sync-client-installation.js';

export interface RegisterOrRefreshInstallationInput {
  readonly id: Uuid;
  readonly profileId: Uuid;
  readonly platform: SyncClientPlatform;
  readonly appVersion: string;
  readonly protocolVersion: number;
  readonly now: Date;
}

export interface RegisterOrRefreshInstallationResult {
  readonly installation: SyncClientInstallation;
  /** `true` when `id` had never been registered before this call. */
  readonly wasCreated: boolean;
}

export interface SyncClientInstallationRepository {
  /**
   * Registers a new installation, or refreshes an existing one under the
   * same `id` — reassigning `profileId`/`platform`/`appVersion`/
   * `protocolVersion`/`lastSeenAt` unconditionally, while `registeredAt`
   * is preserved from the row's original insert. See the migration's own
   * comment on `platform.sync_client_installation.profile_id` for why a
   * reassignment, not a conflict, is the correct behavior here.
   */
  registerOrRefresh(
    input: RegisterOrRefreshInstallationInput,
  ): Promise<RegisterOrRefreshInstallationResult>;
}
