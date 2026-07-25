/**
 * `RecordExportCheckpoints` (P8-EXPORT-01): persists one snapshot
 * attempt's staged sections and its boundary, atomically — the worker
 * calls this exactly once per snapshot it staged in full, and from that
 * commit on the export's structured content is FROZEN (a retried attempt
 * resumes from these rows; `RunExportSnapshot` never re-reads a
 * checkpointed request).
 *
 * Duplicate-safe: `replaceCheckpoints` swaps the whole set, so a
 * redelivered call with the same staged sections converges; a call
 * arriving after the request turned terminal is a counted no-op (the late
 * duplicate of an attempt that already finished the whole job).
 */

import type { ExportCheckpointRequest } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { isExportRequestTerminal, recordExportBoundary } from '../domain/export-request.js';
import { exportNotFoundError } from './export-errors.js';
import type { ExportsUnitOfWork } from './exports-unit-of-work.js';

export interface RecordExportCheckpointsSummary {
  readonly exportRequestId: Uuid;
  readonly state: string;
  readonly sectionsRecorded: number;
}

export class RecordExportCheckpoints {
  constructor(
    private readonly unitOfWork: ExportsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    exportRequestId: Uuid,
    body: ExportCheckpointRequest,
  ): Promise<RecordExportCheckpointsSummary> {
    const boundaryAt = new Date(Date.parse(body.boundaryAt));
    if (Number.isNaN(boundaryAt.getTime())) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        'boundaryAt must be an ISO-8601 instant.',
        { details: [{ code: 'export.checkpoint.boundary_invalid', pointer: '/boundaryAt' }] },
      );
    }
    if (body.sections.length === 0) {
      throw new ValidationError(SharedErrorCode.RequestInvalid, 'sections must not be empty.', {
        details: [{ code: 'export.checkpoint.sections_empty', pointer: '/sections' }],
      });
    }
    const now = this.clock.now();

    return this.unitOfWork.run(async (context) => {
      const request = await context.exportRequests.get(exportRequestId);
      if (request === null) {
        throw exportNotFoundError();
      }
      if (isExportRequestTerminal(request)) {
        return { exportRequestId, state: request.state, sectionsRecorded: 0 };
      }

      await context.exportRequests.replaceCheckpoints(exportRequestId, body.sections, now);
      await context.exportRequests.update(recordExportBoundary(request, boundaryAt, now));

      return { exportRequestId, state: 'running', sectionsRecorded: body.sections.length };
    });
  }
}
