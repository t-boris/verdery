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
  GetMediaAccess,
  GetMediaStatus,
  KyselyMediaRepository,
  KyselyMediaUnitOfWork,
  RegisterMediaUpload,
} from './modules/media/public.js';
import type { MediaRoutesDependencies, MediaStorageGateway } from './modules/media/public.js';
import { KyselyAuditLogger } from './platform/audit/kysely-audit-logger.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { MediaConfiguration } from './platform/configuration/configuration-schema.js';
import type { Clock } from './shared/time/clock.js';

export interface MediaComposition {
  readonly mediaRoutesDependencies: MediaRoutesDependencies;
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
    getMediaAccess: new GetMediaAccess(
      mediaRepository,
      gardenAuthorization,
      mediaStorageGateway,
      auditLogger,
      clock,
    ),
  };

  return { mediaRoutesDependencies };
}
