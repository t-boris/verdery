/**
 * `CompleteExport` (P8-EXPORT-01): the generation job's terminal hop-2
 * call. On success, ONE transaction binds the three facts that must never
 * diverge: the `export_package` media record (registered `available`, with
 * the live 7-day registration-anchored retention deadline), the request's
 * `completed` transition (checksum + the SAME expiry instant), and the
 * `export.completed` outbox event the relay turns into the requester's
 * `export_ready` in-app intent. On terminal failure, the request fails
 * with its machine reason and nothing else exists — a failed export never
 * exposes a partial object (section 16).
 *
 * IDEMPOTENT: a redelivered completion against an already-terminal request
 * is a no-op 200 — the media record, expiry, and event all already exist
 * from the transaction that won.
 */

import type { ExportCompletionRequest, ExportCompletedEventPayload } from '@verdery/api-contracts';
import { EXPORT_COMPLETED_EVENT_TYPE, SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { registerExportPackageMediaRecord } from '../../media/public.js';
import { completeExportRequest, failExportRequest } from '../domain/export-request.js';
import { exportNotFoundError } from './export-errors.js';
import type { ExportsUnitOfWork } from './exports-unit-of-work.js';

export interface CompleteExportSummary {
  readonly exportRequestId: Uuid;
  readonly state: string;
  /** `false` on the idempotent replay path — the request was already terminal. */
  readonly transitioned: boolean;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export class CompleteExport {
  constructor(
    private readonly unitOfWork: ExportsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    exportRequestId: Uuid,
    body: ExportCompletionRequest,
  ): Promise<CompleteExportSummary> {
    const now = this.clock.now();

    return this.unitOfWork.run(async (context) => {
      const request = await context.exportRequests.get(exportRequestId);
      if (request === null) {
        throw exportNotFoundError();
      }
      if (request.state === 'completed' || request.state === 'failed') {
        return { exportRequestId, state: request.state, transitioned: false };
      }

      if (body.outcome === 'failed_terminal') {
        const failureCode = body.failureCode ?? null;
        if (failureCode === null || failureCode === '') {
          throw invalid(
            'failureCode is required for failed_terminal.',
            'export.completion.failure_code_required',
            '/failureCode',
          );
        }
        await context.exportRequests.update(failExportRequest(request, failureCode, now));
        return { exportRequestId, state: 'failed', transitioned: true };
      }

      const packageFacts = body.package;
      if (packageFacts === undefined) {
        throw invalid(
          'package is required for succeeded.',
          'export.completion.package_required',
          '/package',
        );
      }
      // The worker must have written exactly the pre-computed target — any
      // other object is a defect, not a negotiable location.
      if (
        packageFacts.bucketName !== request.packageBucketName ||
        packageFacts.objectKey !== request.packageObjectKey
      ) {
        throw invalid(
          'package target does not match the request’s own.',
          'export.completion.package_target_mismatch',
          '/package',
        );
      }

      const record = registerExportPackageMediaRecord(
        request.outputMediaId,
        {
          uploadedByProfileId: request.requesterProfileId,
          displayFilename: `verdery-export-${request.id}.zip`,
          contentType: packageFacts.contentType,
          byteSize: packageFacts.byteSize,
          checksumSha256: packageFacts.checksumSha256,
          bucketName: packageFacts.bucketName,
          objectKey: packageFacts.objectKey,
        },
        now,
      );
      await context.media.insert(record);

      // The class's registration-anchored rule always yields a deadline
      // for export_package — the cast states that invariant.
      const expiresAt = record.retentionDeadlineAt as Date;
      const completed = completeExportRequest(
        request,
        { outputChecksumSha256: record.checksumSha256 as string, expiresAt },
        now,
      );
      await context.exportRequests.update(completed);

      const payload: ExportCompletedEventPayload = {
        exportRequestId: request.id,
        requesterProfileId: request.requesterProfileId,
        scope: request.scope,
        gardenId: request.gardenId,
        outputMediaId: request.outputMediaId,
        expiresAt: expiresAt.toISOString(),
      };
      await context.outbox.append({
        eventType: EXPORT_COMPLETED_EVENT_TYPE,
        aggregateType: 'export_request',
        aggregateId: request.id,
        payload,
      });

      return { exportRequestId, state: 'completed', transitioned: true };
    });
  }
}
