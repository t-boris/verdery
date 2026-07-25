/**
 * Dispatches an inbound manifest to the validator or the derivative
 * generator by `manifest.jobKind`.
 *
 * This is the concrete resolution to this work package's own "generalize
 * `validation-http-server.ts` to route by `job_kind`, or add a second,
 * parallel entrypoint" question: ONE HTTP endpoint, ONE Cloud Tasks queue,
 * ONE task URL, and ONE OIDC audience stay correct for both job kinds —
 * `validation-http-server.ts` itself needs no change beyond accepting this
 * router in place of a bare `ProcessMediaValidationJob` as its `processor`
 * dependency (it already only requires something satisfying
 * `MediaValidationJobProcessor`'s narrow `execute(manifest)` shape, which
 * this router also structurally satisfies). A second parallel entrypoint
 * would have meant a second Cloud Run route, a second `MEDIA_PROCESSING_*`
 * URL/audience pair, and a second queue-to-service wiring in
 * `10-media-processing-queue.sh`/`deploy-workers.sh` for no real benefit —
 * both job kinds already share one authenticated caller (Cloud Tasks) and
 * one result-recording callback contract.
 *
 * `validation-http-server.ts`'s own file/class name is unchanged even though
 * it is no longer validation-only — see that file's own header comment for
 * why keeping the established name (rather than renaming across `main.ts`,
 * its own test file, and `services/workers/README.md`'s documented route)
 * was judged the clearer choice this session, now that its actual job is
 * "the worker's one authenticated HTTP target," not "the validator's HTTP
 * target" specifically.
 */

import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import {
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  MEDIA_VALIDATION_JOB_KIND,
} from './job-kind.js';

/** The one method `ProcessMediaValidationJob`, `ProcessMediaDerivativeGenerationJob`, and `ProcessMediaDeletionJob` all expose — this router's own dependency shape, and the same shape `validation-http-server.ts`'s own `MediaValidationJobProcessor` port already declares. */
export interface MediaProcessingJobExecutor {
  execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult>;
}

export class MediaProcessingJobRouter implements MediaProcessingJobExecutor {
  constructor(
    private readonly validationJob: MediaProcessingJobExecutor,
    private readonly derivativeGenerationJob: MediaProcessingJobExecutor,
    private readonly deletionJob: MediaProcessingJobExecutor,
  ) {}

  /** `manifest.jobKind` absent (every manifest built before this field existed) defaults to `MEDIA_VALIDATION_JOB_KIND` — see `MediaProcessingManifest.jobKind`'s own doc comment in `@verdery/api-contracts`. */
  execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult> {
    const jobKind = manifest.jobKind ?? MEDIA_VALIDATION_JOB_KIND;
    if (jobKind === MEDIA_DERIVATIVE_GENERATION_JOB_KIND) {
      return this.derivativeGenerationJob.execute(manifest);
    }
    if (jobKind === MEDIA_DELETION_JOB_KIND) {
      return this.deletionJob.execute(manifest);
    }
    return this.validationJob.execute(manifest);
  }
}
