/**
 * `RunExportSnapshot` (P8-EXPORT-01): the generation job's first hop-2 call
 * — begins (or re-begins) the attempt, then either serves the FULL
 * structured snapshot or, once checkpoints exist, only the checkpoint list
 * (the snapshot is never re-read after it is checkpointed; that is what
 * makes the recorded boundary a real one — see the contract type's own doc
 * comment on the two shapes).
 *
 * Transaction shape, deliberately three small ones rather than one long
 * one (section 6's "do not hold one unbounded database transaction"):
 * 1. begin — the `requested/running -> running` transition + attempt count;
 * 2. the reader's own `REPEATABLE READ, READ ONLY` snapshot transaction;
 * 3. nothing — section building is pure and the response is returned.
 * A crash between 1 and the worker's checkpoint write costs only a re-read
 * under a fresh (still internally consistent) snapshot.
 */

import type { ExportSnapshotResponse } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import { ConflictError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { beginExportGeneration, isExportRequestTerminal } from '../domain/export-request.js';
import type { ExportRequest } from '../domain/export-request.js';
import { exportNotFoundError } from './export-errors.js';
import type { ExportsUnitOfWork } from './exports-unit-of-work.js';
import type { ExportSnapshotReader } from './export-snapshot-reader.js';
import { buildExportSections } from './export-sections.js';

/** The exports-bucket prefix one export's staged section objects live under — request-scoped, so leftover staging (a failed export) is isolated and the bucket's 7-day lifecycle rule cleans it. */
export function exportStagingObjectKeyPrefix(exportRequestId: Uuid): string {
  return `staging/${exportRequestId}/`;
}

export class RunExportSnapshot {
  constructor(
    private readonly unitOfWork: ExportsUnitOfWork,
    private readonly snapshotReader: ExportSnapshotReader,
    private readonly serviceVersion: string,
    private readonly clock: Clock,
  ) {}

  async execute(exportRequestId: Uuid): Promise<ExportSnapshotResponse> {
    const now = this.clock.now();

    const { request, checkpoints } = await this.unitOfWork.run(async (context) => {
      const stored = await context.exportRequests.get(exportRequestId);
      if (stored === null) {
        throw exportNotFoundError();
      }
      if (isExportRequestTerminal(stored)) {
        return { request: stored, checkpoints: [] as const };
      }

      const begun = beginExportGeneration(stored, now);
      const updated = await context.exportRequests.update(begun);
      if (!updated) {
        // A concurrent writer advanced the row between read and write —
        // possible only under duplicated concurrent delivery. 409 keeps the
        // losing delivery retryable without inventing state.
        throw new ConflictError(
          SharedErrorCode.StaleRevision,
          'The export request changed concurrently; retry the snapshot.',
        );
      }

      const recorded = await context.exportRequests.listCheckpoints(exportRequestId);
      return { request: begun, checkpoints: recorded };
    });

    const base = {
      exportRequestId: request.id,
      state: request.state,
      scope: request.scope,
      includeMedia: request.includeMedia,
      formatVersion: request.formatVersion,
      packageTarget: {
        bucketName: request.packageBucketName,
        objectKey: request.packageObjectKey,
      },
      stagingObjectKeyPrefix: exportStagingObjectKeyPrefix(request.id),
    };

    if (isExportRequestTerminal(request) || checkpoints.length > 0) {
      return {
        ...base,
        boundaryAt: request.boundaryAt === null ? null : request.boundaryAt.toISOString(),
        checkpoints: checkpoints.map((checkpoint) => ({
          entryPath: checkpoint.entryPath,
          disposition: checkpoint.disposition,
          bucketName: checkpoint.bucketName,
          objectKey: checkpoint.objectKey,
          contentType: checkpoint.contentType,
          checksumSha256: checkpoint.checksumSha256,
          byteSize: checkpoint.byteSize,
        })),
        sections: [],
      };
    }

    const snapshot = await this.snapshotReader.readSnapshot(this.toSnapshotScope(request));
    const sections = buildExportSections(snapshot, {
      exportRequestId: request.id,
      formatVersion: request.formatVersion,
      serviceVersion: this.serviceVersion,
    });

    return {
      ...base,
      boundaryAt: snapshot.boundaryAt.toISOString(),
      checkpoints: [],
      sections,
    };
  }

  private toSnapshotScope(request: ExportRequest) {
    return {
      scope: request.scope,
      requesterProfileId: request.requesterProfileId,
      gardenId: request.gardenId,
      includeMedia: request.includeMedia,
    };
  }
}
