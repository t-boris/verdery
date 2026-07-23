/**
 * The sync protocol version window this server currently supports.
 *
 * Checked by `RegisterSyncClient` and `PushSyncOperations` — "the same code
 * and meaning `PushSyncOperations` and `GetSyncChanges` use" per
 * `registerSyncClient`'s own OpenAPI description. `GetSyncChanges` is
 * P5-BE-02's concern, not built this stage, but this constant and guard are
 * written so that stage only has to import and call them, not redefine them.
 *
 * Only a lower bound exists: this is the sync protocol's first shipped
 * version, so there is no upper bound to reject yet — the server always
 * supports "up to whatever it implements today." A future protocol
 * revision that needs to drop support for version 1 clients extends this
 * one guard, not a parallel one.
 *
 * Source: architecture/offline-synchronization.md, section
 * "21. Protocol Versioning".
 */

import { SyncErrorCode } from '@verdery/api-contracts';
import { ConflictError } from '../../../platform/errors/application-error.js';

export const MIN_SUPPORTED_SYNC_PROTOCOL_VERSION = 1;

/**
 * Throws `ConflictError` (`sync.protocol_version.unsupported`, mapped to
 * `409` — see `platform/errors/error-response.ts`'s category table) when
 * `protocolVersion` is below the supported window. Never deletes or implies
 * anything about the caller's local outbox, per the OpenAPI operation's own
 * description.
 */
export function requireSupportedSyncProtocolVersion(protocolVersion: number): void {
  if (protocolVersion < MIN_SUPPORTED_SYNC_PROTOCOL_VERSION) {
    throw new ConflictError(
      SyncErrorCode.ProtocolVersionUnsupported,
      `Sync protocol version ${protocolVersion} is no longer supported; minimum supported version is ${MIN_SUPPORTED_SYNC_PROTOCOL_VERSION}.`,
    );
  }
}
