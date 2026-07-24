import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import { z } from 'zod';
import type { Logger } from '../logger.js';
import {
  InvocationAuthenticationError,
  type InvocationVerifier,
} from './oidc-invocation-verifier.js';

/**
 * The one method this HTTP server needs from `ProcessMediaValidationJob` —
 * a narrow port, not the concrete class, matching this codebase's own
 * port-plus-adapter-plus-fake convention (see `MediaProcessingResultRecorder`
 * for the identical shape). `ProcessMediaValidationJob` satisfies this
 * interface structurally without declaring `implements`; a test fake can
 * satisfy it too, without needing to construct a real `MediaValidator`.
 */
export interface MediaValidationJobProcessor {
  execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult>;
}

const MAX_BODY_BYTES = 128 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const JOB_PATH = new RegExp(`^/internal/media-validation-jobs/(${UUID})$`, 'u');

const manifestSchema = z.object({
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
});

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

    try {
      const rawAuthorization: unknown = request.headers['authorization'];
      const authorization = typeof rawAuthorization === 'string' ? rawAuthorization : undefined;
      await this.verifier.verify(authorization);
      const manifest = manifestSchema.parse(await readJson(request)) as MediaProcessingManifest;
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
      this.logger.error(
        { err: error, event: 'media_validation.failed', jobId: match[1] },
        'Media validation failed retryably',
      );
      send(response, 503, { error: 'validation_unavailable' });
    }
  }
}
