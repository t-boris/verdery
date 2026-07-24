/**
 * The Cloud Tasks HTTP task target for a media-processing job (P6-ASYNC-01).
 *
 * NOT part of `@verdery/api-contracts`'s public OpenAPI surface: this is a
 * machine-to-machine callback Cloud Tasks itself invokes with a Google-signed
 * OIDC token, never a request an iOS/web client constructs — the same
 * reasoning that already keeps `MediaProcessingManifest`/`MediaProcessingResult`
 * (the contract package's own hand-written additions) out of `openapi.yaml`.
 * Registered outside the Firebase-authenticated route group in `app.ts`, the
 * same way `/health/*` and `/auth/session` are: this endpoint authenticates
 * itself entirely differently (`CloudTasksInvocationVerifier`, not a Firebase
 * session or ID token).
 *
 * Request body: the `MediaProcessingManifest` the relay enqueued as the Cloud
 * Tasks task's own HTTP body (section 13, "Processing Manifest") — accepted
 * and shape-checked here so a malformed task never reaches the command layer,
 * but its CONTENT is not otherwise consulted: `RecordMediaProcessingResult`
 * derives every fact it needs from the durable `processing_job` row itself,
 * not from a caller-supplied body, matching section 14's "The backend
 * validates result ownership" — ownership is established by looking up the
 * trusted job row, not by trusting whatever the request claims. See that
 * command's own header comment for why this one honest-placeholder handler
 * currently plays both "the worker that processes the manifest" and "the
 * backend that records the result."
 */

import type { MediaProcessingManifest } from '@verdery/api-contracts';
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

/** Shape-checks the manifest without acting on its content — see this file's own header comment. */
function requireManifestBody(request: FastifyRequest): MediaProcessingManifest {
  const body = request.body as Partial<MediaProcessingManifest> | undefined;

  if (typeof body?.jobId !== 'string' || typeof body.mediaId !== 'string') {
    throw invalid(
      'The processing manifest is missing required fields.',
      'request.manifest.invalid',
      '/',
    );
  }

  return body as MediaProcessingManifest;
}

export function registerMediaProcessingCallbackRoute(
  app: FastifyInstance,
  dependencies: MediaProcessingCallbackRouteDependencies,
): void {
  app.post('/internal/media-processing-jobs/:jobId/callback', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const jobId = requireJobId(request);
    const manifest = requireManifestBody(request);
    // The manifest's own jobId must agree with the URL's — a mismatch means
    // this task was misdelivered or its body was tampered with in transit,
    // neither of which this endpoint should silently paper over.
    if (manifest.jobId !== jobId) {
      throw invalid(
        'The manifest jobId does not match the callback URL.',
        'request.manifest.job_id_mismatch',
        '/jobId',
      );
    }

    await dependencies.recordMediaProcessingResult.execute(jobId);

    return reply.status(204).send();
  });
}
