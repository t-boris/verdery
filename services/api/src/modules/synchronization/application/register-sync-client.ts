/**
 * `PUT /v1/sync/clients/{clientInstallationId}` — registers or refreshes
 * client installation metadata.
 *
 * Idempotency-guarded the same way every other mutation in this codebase is
 * (`IdempotencyStore.check`/`save`, `Idempotency-Key` header) — this
 * endpoint is naturally idempotent by its own PUT-at-a-known-id semantics,
 * but a stored, fingerprint-checked replay is still the established
 * convention every sibling module's command follows (see, for example,
 * `gardens-mapping/application/create-garden.ts`), and it additionally
 * catches a retried request whose declared fields subtly changed (a
 * different `appVersion` under the same key) rather than silently applying
 * whichever one happens to run last.
 *
 * `SYNC_REGISTER_CLIENT_TTL_MILLISECONDS` uses the same 24-hour figure every
 * other command's own `run-idempotent-command.ts` uses — this is an
 * ordinary same-session REST retry (a client re-sending the same PUT after a
 * dropped response), not a long-offline outbox operation, so the longer TTL
 * `push-sync-idempotency.ts` uses for `PushSyncOperations` does not apply
 * here.
 */

import type { SyncClientInstallation as SyncClientInstallationResource } from '@verdery/api-contracts';
import type {
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { SyncClientPlatform } from '../domain/sync-client-installation.js';
import type { SyncClientInstallationRepository } from './sync-client-installation-repository.js';
import { requireSupportedSyncProtocolVersion } from './sync-protocol-version.js';

const OPERATION = 'sync.registerClient';
const SYNC_REGISTER_CLIENT_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface RegisterSyncClientRequest {
  readonly platform: SyncClientPlatform;
  readonly appVersion: string;
  readonly protocolVersion: number;
}

export interface RegisterSyncClientResult {
  readonly statusCode: 200 | 201;
  readonly installation: SyncClientInstallationResource;
}

function toResource(installation: {
  id: Uuid;
  platform: SyncClientPlatform;
  appVersion: string;
  protocolVersion: number;
  registeredAt: Date;
  lastSeenAt: Date;
}): SyncClientInstallationResource {
  return {
    id: installation.id,
    platform: installation.platform,
    appVersion: installation.appVersion,
    protocolVersion: installation.protocolVersion,
    registeredAt: installation.registeredAt.toISOString(),
    lastSeenAt: installation.lastSeenAt.toISOString(),
  };
}

export class RegisterSyncClient {
  constructor(
    private readonly installations: SyncClientInstallationRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly clock: Clock,
  ) {}

  async execute(
    clientInstallationId: Uuid,
    profileId: Uuid,
    request: RegisterSyncClientRequest,
    idempotencyKey: string,
  ): Promise<RegisterSyncClientResult> {
    requireSupportedSyncProtocolVersion(request.protocolVersion);

    const input: IdempotencyRecordInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ clientInstallationId, request }),
    };

    const check = await this.idempotency.check(input);
    if (check.kind === 'replay') {
      return {
        statusCode: check.responseStatusCode as 200 | 201,
        installation: check.responseBody as SyncClientInstallationResource,
      };
    }

    const { installation, wasCreated } = await this.installations.registerOrRefresh({
      id: clientInstallationId,
      profileId,
      platform: request.platform,
      appVersion: request.appVersion,
      protocolVersion: request.protocolVersion,
      now: this.clock.now(),
    });

    const statusCode = wasCreated ? 201 : 200;
    const resource = toResource(installation);

    await this.idempotency.save(input, statusCode, resource, SYNC_REGISTER_CLIENT_TTL_MILLISECONDS);

    return { statusCode, installation: resource };
  }
}
