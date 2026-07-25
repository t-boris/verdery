import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { EXPORT_GENERATION_JOB_KIND } from '@verdery/api-contracts';
import { z } from 'zod';
import { MEDIA_VALIDATION_JOB_KIND } from '../job-kind.js';
import type { Logger } from '../logger.js';
import type { WorkerJobManifest } from '../relay/media-processing-queue.js';
import {
  InvocationAuthenticationError,
  type InvocationVerifier,
} from './oidc-invocation-verifier.js';

/**
 * The one method this HTTP server needs from its processor — a narrow port,
 * not a concrete class, matching this codebase's own
 * port-plus-adapter-plus-fake convention (see `MediaProcessingResultRecorder`
 * for the identical shape). `MediaProcessingJobRouter` satisfies it
 * structurally — `main.ts` wires the router here, so this ONE server
 * dispatches an inbound manifest to the validator, the derivative
 * generator, the deletion job, or (P8-EXPORT-01) the export-generation job
 * by its own `jobKind`; the return value is ignored (every job kind
 * records its outcome through its own authenticated hop-2 callback). This
 * class's own name and route (`/internal/media-validation-jobs/:jobId`)
 * are unchanged from P6-WORKER-01 despite that: renaming both across
 * `main.ts`, this file's own test, `services/workers/README.md`, and every
 * `MEDIA_PROCESSING_TASK_URL` reference in
 * `infrastructure/gcloud/scripts/deploy-workers.sh` was judged more churn
 * than the rename was worth for a route no client ever sees by name.
 */
export interface MediaValidationJobProcessor {
  execute(manifest: WorkerJobManifest): Promise<unknown>;
}

const MAX_BODY_BYTES = 128 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const JOB_PATH = new RegExp(`^/internal/media-validation-jobs/(${UUID})$`, 'u');

const mediaManifestSchema = z.object({
  jobId: z.string().regex(new RegExp(`^${UUID}$`, 'u')),
  mediaId: z.string().regex(new RegExp(`^${UUID}$`, 'u')),
  processorConfigVersion: z.string().min(1),
  inputObjects: z
    .array(z.object({ bucketName: z.string().min(1), objectKey: z.string().min(1) }))
    .length(1),
  expectedChecksums: z.array(z.string().regex(/^[0-9a-f]{64}$/u)),
  validation: z.object({
    mediaClass: z.string().min(1),
    displayFilename: z.string().min(1),
    expectedContentType: z.string().min(1),
    expectedByteSize: z.number().int().positive(),
  }),
  traceId: z.string().min(1).optional(),
  // Absent means `media_validation` — see `MediaProcessingManifest.jobKind`'s
  // own doc comment in `@verdery/api-contracts` and
  // `MediaProcessingJobRouter`'s own header comment.
  jobKind: z.string().min(1).optional(),
  // Present only on a `media_deletion` manifest (P6-RET-01) — the
  // bucket/prefix pairs the deletion job removes; `ProcessMediaDeletionJob`
  // itself treats a deletion manifest arriving without one as terminally
  // malformed, so this schema does not duplicate that jobKind-conditional
  // rule here.
  deletion: z
    .object({
      objectPrefixes: z
        .array(z.object({ bucketName: z.string().min(1), objectKeyPrefix: z.string().min(1) }))
        .min(1),
    })
    .optional(),
});

/** P8-EXPORT-01's manifest family — a separate shape, not optional fields on the media manifest; see `ExportGenerationManifest`'s own contract doc comment. */
const exportManifestSchema = z.object({
  jobId: z.string().regex(new RegExp(`^${UUID}$`, 'u')),
  jobKind: z.literal(EXPORT_GENERATION_JOB_KIND),
  exportRequestId: z.string().regex(new RegExp(`^${UUID}$`, 'u')),
  traceId: z.string().min(1).optional(),
});

const manifestSchema = z.union([exportManifestSchema, mediaManifestSchema]);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(rawChunk);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function send(response: ServerResponse, statusCode: number, body?: object): void {
  response.statusCode = statusCode;
  if (body === undefined) {
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

export class ValidationHttpServer {
  private readonly server: Server;

  constructor(
    private readonly verifier: InvocationVerifier,
    private readonly processor: MediaValidationJobProcessor,
    private readonly logger: Logger,
  ) {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  /** Resolves once the server is accepting connections; returns the actually-bound port (== `port` unless `port` was `0`). */
  async listen(port: number): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '0.0.0.0', resolve);
    });

    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Failed to determine the bound port.');
    }
    return address.port;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/health/live') {
      send(response, 204);
      return;
    }

    const match = request.method === 'POST' ? JOB_PATH.exec(request.url ?? '') : null;
    if (match === null) {
      send(response, 404, { error: 'not_found' });
      return;
    }

    let manifest: WorkerJobManifest | undefined;
    try {
      const rawAuthorization: unknown = request.headers['authorization'];
      const authorization = typeof rawAuthorization === 'string' ? rawAuthorization : undefined;
      await this.verifier.verify(authorization);
      manifest = manifestSchema.parse(await readJson(request)) as WorkerJobManifest;
      if (manifest.jobId !== match[1]) {
        send(response, 400, { error: 'job_id_mismatch' });
        return;
      }

      await this.processor.execute(manifest);
      send(response, 204);
    } catch (error) {
      if (error instanceof InvocationAuthenticationError) {
        send(response, 401, { error: 'unauthenticated' });
        return;
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        send(response, 400, { error: 'invalid_manifest' });
        return;
      }
      // Named for what this server now IS (the one target ALL THREE job
      // kinds dispatch through — this class's own header comment), not for
      // its P6-WORKER-01-era validation-only role: the pre-P6-OBS-01 event
      // name `media_validation.failed` would have hidden a deletion or
      // derivative job's retry storm inside a validation-named series.
      // `jobKind` absent on the manifest means `media_validation` by
      // contract (`MediaProcessingManifest.jobKind`); a body that failed
      // before parsing has no kind to report and logs `null`.
      this.logger.error(
        {
          err: error,
          event: 'media_processing.job_failed_retryable',
          jobId: match[1],
          jobKind: manifest === undefined ? null : (manifest.jobKind ?? MEDIA_VALIDATION_JOB_KIND),
        },
        'Media processing job failed retryably; Cloud Tasks will retry',
      );
      send(response, 503, { error: 'processing_unavailable' });
    }
  }
}
