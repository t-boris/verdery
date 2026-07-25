/**
 * Authenticated machine-to-machine result endpoint. The validation worker,
 * not Cloud Tasks directly, posts a `MediaProcessingResult` here using its
 * Google-signed service-identity token. It is intentionally outside the
 * Firebase user-authenticated route group and outside public OpenAPI.
 */

import type { MediaProcessingResult } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import { UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { RecordMediaProcessingResult } from '../application/record-media-processing-result.js';

export interface MediaProcessingCallbackRouteDependencies {
  readonly recordMediaProcessingResult: RecordMediaProcessingResult;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function requireJobId(request: FastifyRequest): string {
  const { jobId } = request.params as { jobId?: unknown };

  if (typeof jobId !== 'string' || !UUID_PATTERN.test(jobId)) {
    throw invalid('jobId must be a UUID.', 'request.job_id.invalid', '/jobId');
  }

  return jobId;
}

const OUTCOMES = new Set(['succeeded', 'partial', 'failed_terminal', 'cancelled']);

function requireResultBody(request: FastifyRequest): MediaProcessingResult {
  const body = request.body as Partial<MediaProcessingResult> | undefined;

  if (
    typeof body?.jobId !== 'string' ||
    typeof body.processorVersion !== 'string' ||
    !Array.isArray(body.inputChecksums) ||
    !Array.isArray(body.outputObjects) ||
    typeof body.resultSummary !== 'object' ||
    body.resultSummary === null ||
    typeof body.outcome !== 'string' ||
    !OUTCOMES.has(body.outcome)
  ) {
    throw invalid(
      'The processing result is missing required fields.',
      'request.processing_result.invalid',
      '/',
    );
  }

  return body as MediaProcessingResult;
}

export function registerMediaProcessingCallbackRoute(
  app: FastifyInstance,
  dependencies: MediaProcessingCallbackRouteDependencies,
): void {
  app.post('/internal/media-processing-jobs/:jobId/callback', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const jobId = requireJobId(request);
    const result = requireResultBody(request);
    // The result's own jobId must agree with the URL's — a mismatch means
    // this task was misdelivered or its body was tampered with in transit,
    // neither of which this endpoint should silently paper over.
    if (result.jobId !== jobId) {
      throw invalid(
        'The processing result jobId does not match the callback URL.',
        'request.processing_result.job_id_mismatch',
        '/jobId',
      );
    }

    const summary = await dependencies.recordMediaProcessingResult.execute(jobId, result);

    // One structured line per delivery — job kind, disposition, outcome, and
    // latency figures only, never object keys, filenames, or URLs
    // (architecture/media-storage-and-processing.md section 19; P6-OBS-01).
    // Logged here at the transport layer from the application layer's own
    // returned summary, the same split `sync-routes.ts` established for
    // P5-OBS-01. Null-valued duration fields are omitted, matching
    // `pullLagMilliseconds`' own absent-when-uncomputable precedent.
    request.log.info(
      {
        event: 'media.processing.result_recorded',
        jobId,
        disposition: summary.disposition,
        jobKind: summary.jobKind,
        mediaId: summary.mediaId,
        outcome: summary.outcome,
        outcomeCode: summary.outcomeCode,
        attempt: summary.attempt,
        ...(summary.mediaClass === null ? {} : { mediaClass: summary.mediaClass }),
        ...(summary.workerDurationMs === null
          ? {}
          : { workerDurationMs: summary.workerDurationMs }),
        ...(summary.requestedToCompletedMs === null
          ? {}
          : { requestedToCompletedMs: summary.requestedToCompletedMs }),
        ...(summary.deletionLagMs === null ? {} : { deletionLagMs: summary.deletionLagMs }),
      },
      'Media processing result recorded',
    );

    return reply.status(204).send();
  });
}
