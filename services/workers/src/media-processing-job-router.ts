/**
 * Dispatches an inbound manifest to the validator, the derivative
 * generator, the deletion job, or (P8-EXPORT-01) the export-generation job
 * by `manifest.jobKind`.
 *
 * This is the concrete resolution to this work package's own "generalize
 * `validation-http-server.ts` to route by `job_kind`, or add a second,
 * parallel entrypoint" question: ONE HTTP endpoint, ONE Cloud Tasks queue,
 * ONE task URL, and ONE OIDC audience stay correct for every job kind —
 * `validation-http-server.ts` itself needs no change beyond accepting this
 * router in place of a bare `ProcessMediaValidationJob` as its `processor`
 * dependency. A second parallel entrypoint would have meant a second Cloud
 * Run route, a second `MEDIA_PROCESSING_*` URL/audience pair, and a second
 * queue-to-service wiring in `10-media-processing-queue.sh`/
 * `deploy-workers.sh` for no real benefit — all job kinds already share
 * one authenticated caller (Cloud Tasks).
 *
 * P8-EXPORT-01 adds a second manifest FAMILY (`ExportGenerationManifest` —
 * see its contract doc comment for why it is not optional fields on the
 * media manifest), so the router's own input is the `WorkerJobManifest`
 * union and the export branch narrows by the discriminating `jobKind`
 * literal. The export job records its outcome through its OWN hop-2
 * endpoints (`/internal/exports/...`), not the media result callback, so
 * its executor returns nothing.
 *
 * `validation-http-server.ts`'s own file/class name is unchanged even though
 * it is no longer validation-only — see that file's own header comment for
 * why keeping the established name (rather than renaming across `main.ts`,
 * its own test file, and `services/workers/README.md`'s documented route)
 * was judged the clearer choice, now that its actual job is "the worker's
 * one authenticated HTTP target."
 */

import type {
  ExportGenerationManifest,
  MediaProcessingManifest,
  MediaProcessingResult,
} from '@verdery/api-contracts';
import { EXPORT_GENERATION_JOB_KIND } from '@verdery/api-contracts';
import {
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  MEDIA_VALIDATION_JOB_KIND,
} from './job-kind.js';
import type { WorkerJobManifest } from './relay/media-processing-queue.js';

/** The one method `ProcessMediaValidationJob`, `ProcessMediaDerivativeGenerationJob`, and `ProcessMediaDeletionJob` all expose. */
export interface MediaProcessingJobExecutor {
  execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult>;
}

/** The export job's own narrower shape (P8-EXPORT-01) — no result body; completion goes through the export-specific hop-2 endpoints. */
export interface ExportGenerationJobExecutor {
  execute(manifest: ExportGenerationManifest): Promise<void>;
}

export class MediaProcessingJobRouter {
  constructor(
    private readonly validationJob: MediaProcessingJobExecutor,
    private readonly derivativeGenerationJob: MediaProcessingJobExecutor,
    private readonly deletionJob: MediaProcessingJobExecutor,
    private readonly exportGenerationJob: ExportGenerationJobExecutor,
  ) {}

  /** `manifest.jobKind` absent (every manifest built before this field existed) defaults to `MEDIA_VALIDATION_JOB_KIND` — see `MediaProcessingManifest.jobKind`'s own doc comment in `@verdery/api-contracts`. */
  async execute(manifest: WorkerJobManifest): Promise<MediaProcessingResult | void> {
    if (manifest.jobKind === EXPORT_GENERATION_JOB_KIND) {
      return this.exportGenerationJob.execute(manifest as ExportGenerationManifest);
    }

    const mediaManifest = manifest as MediaProcessingManifest;
    const jobKind = mediaManifest.jobKind ?? MEDIA_VALIDATION_JOB_KIND;
    if (jobKind === MEDIA_DERIVATIVE_GENERATION_JOB_KIND) {
      return this.derivativeGenerationJob.execute(mediaManifest);
    }
    if (jobKind === MEDIA_DELETION_JOB_KIND) {
      return this.deletionJob.execute(mediaManifest);
    }
    return this.validationJob.execute(mediaManifest);
  }
}
