/**
 * `GetExportDownload` (P8-EXPORT-01): the established signed-access
 * mechanism (`GetMediaAccess`'s own short-lived signed URL, minted by the
 * same `MediaStorageGateway`) applied to the export package —
 * architecture/data-export-and-deletion.md section 9's delivery rules:
 *
 * - REQUESTER-BOUND: only the requester resolves the request at all
 *   (concealment), and the package's media record is deliberately
 *   `gardenId`-less so no garden-scoped media route can ever serve it to
 *   a collaborator — see `registerExportPackageMediaRecord`.
 * - SHORT-LIVED: the signed URL's TTL is the gateway's own; repeated
 *   download after expiry is exactly this endpoint again ("Repeated
 *   download requires reauthorization after URL expiration").
 * - EXPIRING: past `expiresAt`, or once the retention pipeline moved the
 *   package's media record out of `available` (deletion scheduled or
 *   done), the answer is `export.not_downloadable` — both gates checked,
 *   because the sweep is periodic and the bucket rule is age-based, so
 *   neither alone is the instant the promise ends.
 */

import type { MediaAccess } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MediaRepository, MediaStorageGateway } from '../../media/public.js';
import { exportNotDownloadableError, exportNotFoundError } from './export-errors.js';
import type { ExportRequestRepository } from './export-request-repository.js';

export class GetExportDownload {
  constructor(
    private readonly exportRequests: ExportRequestRepository,
    private readonly media: MediaRepository,
    private readonly storage: MediaStorageGateway,
    private readonly clock: Clock,
  ) {}

  async execute(exportRequestId: Uuid, requesterProfileId: Uuid): Promise<MediaAccess> {
    const request = await this.exportRequests.getForRequester(exportRequestId, requesterProfileId);
    if (request === null) {
      throw exportNotFoundError();
    }

    const now = this.clock.now();
    if (
      request.state !== 'completed' ||
      request.expiresAt === null ||
      request.expiresAt.getTime() <= now.getTime()
    ) {
      throw exportNotDownloadableError();
    }

    const record = await this.media.get(request.outputMediaId);
    if (record === null || record.uploadState !== 'available') {
      throw exportNotDownloadableError();
    }

    const access = await this.storage.createSignedDownloadUrl(
      // Always both set: the completion transaction registered the record
      // with the pre-computed package target.
      { bucketName: record.bucketName as string, objectKey: record.objectKey as string },
      now,
    );

    return { url: access.url, expiresAt: access.expiresAt.toISOString() };
  }
}
