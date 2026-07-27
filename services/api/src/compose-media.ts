/**
 * Composition-root helper for the media module's P6-API-01 HTTP surface:
 * registration, authorized resumable upload sessions, completion
 * verification, status, and authorized short-lived access — split out of
 * `app.ts` purely to keep that file at or below the repository's 600-line
 * source-file limit, the same reason `compose-gardens-mapping.ts` was split
 * out. Still composition-root code, not a module boundary.
 *
 * Reuses `gardenAuthorization` (constructed once, by
 * `composeGardensMapping`, and threaded through every module that depends on
 * it) rather than building a second authorization instance.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import {
  CompleteMediaUpload,
  DeleteGardenMedia,
  GetClientMediaAccess,
  GetMediaAccess,
  GetMediaRetentionPolicy,
  GetMediaStatus,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
  KyselyMediaUnitOfWork,
  ListGardenMedia,
  RecordMediaProcessingResult,
  RegisterMediaUpload,
  RunMediaRetentionSweep,
} from './modules/media/public.js';
import type {
  ClientMediaRoutesDependencies,
  MediaProcessingCallbackRouteDependencies,
  MediaRetentionSweepRouteDependencies,
  MediaRoutesDependencies,
  MediaStorageGateway,
} from './modules/media/public.js';
import { KyselyAuditLogger } from './platform/audit/kysely-audit-logger.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { MediaConfiguration } from './platform/configuration/configuration-schema.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

export interface MediaComposition {
  readonly mediaRoutesDependencies: MediaRoutesDependencies;
  readonly mediaProcessingCallbackRouteDependencies: MediaProcessingCallbackRouteDependencies;
  readonly mediaRetentionSweepRouteDependencies: MediaRetentionSweepRouteDependencies;
  readonly clientMediaRoutesDependencies: ClientMediaRoutesDependencies;
}

/**
 * `mediaStorageGateway` arrives already constructed — `main.ts` builds the
 * real `GcsMediaStorageGateway` adapter (or a test builds a fake), the same
 * "port arrives from the caller, this file only wires it into commands"
 * shape `composeGardensMapping` follows for `database`/`clock` themselves.
 * `bucketNames` is threaded separately from the gateway because
 * `RegisterMediaUpload` needs to pick a bucket per `MediaClass` BEFORE it
 * ever calls the gateway — see `media-storage-target.ts`.
 */
export function composeMedia(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  mediaStorageGateway: MediaStorageGateway,
  bucketNames: MediaConfiguration['buckets'],
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
): MediaComposition {
  const mediaRepository = new KyselyMediaRepository(database.queries);
  const mediaIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const mediaUnitOfWork = new KyselyMediaUnitOfWork(database.queries, clock);
  const auditLogger = new KyselyAuditLogger(database.queries, clock);

  const mediaRoutesDependencies: MediaRoutesDependencies = {
    registerMediaUpload: new RegisterMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      gardenAuthorization,
      mediaStorageGateway,
      bucketNames,
      clock,
    ),
    completeMediaUpload: new CompleteMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      gardenAuthorization,
      mediaStorageGateway,
      clock,
    ),
    getMediaStatus: new GetMediaStatus(mediaRepository, gardenAuthorization),
    listGardenMedia: new ListGardenMedia(mediaRepository, gardenAuthorization),
    getMediaAccess: new GetMediaAccess(
      mediaRepository,
      gardenAuthorization,
      mediaStorageGateway,
      auditLogger,
      clock,
    ),
    // P6-RET-01: user-facing deletion and the static retention policy.
    deleteGardenMedia: new DeleteGardenMedia(
      mediaIdempotency,
      mediaUnitOfWork,
      gardenAuthorization,
      bucketNames,
      clock,
    ),
    getMediaRetentionPolicy: new GetMediaRetentionPolicy(),
  };

  // P6-ASYNC-01: the Cloud Tasks processing-callback route. Its own unit of
  // work is deliberately a fresh `KyselyMediaUnitOfWork` instance, not
  // `mediaUnitOfWork` reused from above — both are stateless wrappers around
  // the same pooled `database.queries`, so there is no shared-state reason to
  // reuse one, and keeping this composition block self-contained mirrors how
  // `composeSynchronization` builds its own dependencies from already-built
  // pieces without threading every intermediate variable across blocks.
  const mediaProcessingCallbackRouteDependencies: MediaProcessingCallbackRouteDependencies = {
    recordMediaProcessingResult: new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(database.queries, clock),
      clock,
      bucketNames.derived,
    ),
    cloudTasksInvocationVerifier,
  };

  // P6-RET-01: the worker-triggered retention sweep — same verifier, same
  // machine-to-machine posture as the processing callback above.
  const mediaRetentionSweepRouteDependencies: MediaRetentionSweepRouteDependencies = {
    runMediaRetentionSweep: new RunMediaRetentionSweep(
      new KyselyMediaUnitOfWork(database.queries, clock),
      bucketNames,
      clock,
    ),
    cloudTasksInvocationVerifier,
  };

  // P9C-API-01: the client-portal's own thin transport wrapper around the
  // already-built `GetClientMediaAccess` (P9C-MEDIA-01) — no new
  // authorization logic, only its own dependencies wired the same way
  // `mediaRoutesDependencies.getMediaAccess` above wires the OPERATIONAL
  // command. `KyselyClientMediaEntitlementSource` is the narrow read port
  // into `collaboration`'s own client-publication tables that command
  // already depends on (see that port's own header for the module-boundary
  // reasoning).
  const clientMediaRoutesDependencies: ClientMediaRoutesDependencies = {
    getClientMediaAccess: new GetClientMediaAccess(
      mediaRepository,
      new KyselyClientMediaEntitlementSource(database.queries),
      mediaStorageGateway,
      // P9C-OBS-01: the same read-path `AuditLogger` instance
      // `getMediaAccess` above already uses — no per-call state to
      // duplicate.
      auditLogger,
      clock,
    ),
  };

  return {
    mediaRoutesDependencies,
    mediaProcessingCallbackRouteDependencies,
    mediaRetentionSweepRouteDependencies,
    clientMediaRoutesDependencies,
  };
}
