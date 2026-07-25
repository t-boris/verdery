/**
 * `GetExportRequest` (P8-EXPORT-01): the requester's own export request.
 * Unknown ids and other users' ids are the identical `export.not_found` —
 * the concealment posture the inbox reads set.
 */

import type { ExportRequest as ExportRequestResource } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { exportNotFoundError } from './export-errors.js';
import type { ExportRequestRepository } from './export-request-repository.js';
import { toExportRequestResource } from './export-view.js';

export class GetExportRequest {
  constructor(private readonly exportRequests: ExportRequestRepository) {}

  async execute(exportRequestId: Uuid, requesterProfileId: Uuid): Promise<ExportRequestResource> {
    const request = await this.exportRequests.getForRequester(exportRequestId, requesterProfileId);
    if (request === null) {
      throw exportNotFoundError();
    }

    return toExportRequestResource(request);
  }
}
