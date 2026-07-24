/**
 * HTTP-level tests for the Cloud Tasks validation target: request routing,
 * authentication gating, manifest shape validation, and status-code mapping.
 * Deep validation LOGIC is covered by `media-validator.test.ts`; this suite
 * only proves the transport wrapper around it, mirroring
 * `services/api/tests/http/media-processing-callback-route.test.ts`'s own
 * stated split between HTTP-contract tests and business-logic tests.
 *
 * Uses a fake `MediaValidationJobProcessor` (the narrow port
 * `validation-http-server.ts` depends on — see that file's own header
 * comment), never a real `MediaValidator`, so this suite never touches
 * Cloud Storage or a real parser.
 */

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { MediaProcessingManifest, MediaProcessingResult } from '@verdery/api-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '../logger.js';
import {
  InvocationAuthenticationError,
  type InvocationVerifier,
} from './oidc-invocation-verifier.js';
import {
  type MediaValidationJobProcessor,
  ValidationHttpServer,
} from './validation-http-server.js';

function silentLogger(): Logger {
  const noop = (): void => {
    /* no-op */
  };
  return {
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  } as unknown as Logger;
}

/** Accepts exactly one fixed bearer value; rejects everything else, matching `services/api`'s own `FakeCloudTasksInvocationVerifier` test-double shape. */
class FakeInvocationVerifier implements InvocationVerifier {
  verify(authorizationHeader: string | undefined): Promise<void> {
    if (authorizationHeader === 'Bearer valid-token') {
      return Promise.resolve();
    }
    return Promise.reject(new InvocationAuthenticationError());
  }
}

class RecordingProcessor implements MediaValidationJobProcessor {
  readonly received: MediaProcessingManifest[] = [];
  rejectNextWith: Error | null = null;

  execute(manifest: MediaProcessingManifest): Promise<MediaProcessingResult> {
    this.received.push(manifest);
    if (this.rejectNextWith !== null) {
      const error = this.rejectNextWith;
      this.rejectNextWith = null;
      return Promise.reject(error);
    }
    return Promise.resolve({
      jobId: manifest.jobId,
      processorVersion: 'test',
      inputChecksums: [],
      outputObjects: [],
      resultSummary: { accepted: true },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 1 },
      outcome: 'succeeded',
    });
  }
}

function manifestFor(jobId: string): MediaProcessingManifest {
  return {
    jobId,
    mediaId: randomUUID(),
    processorConfigVersion: 'v1',
    inputObjects: [{ bucketName: 'bucket', objectKey: 'object' }],
    expectedChecksums: [],
    validation: {
      mediaClass: 'garden_photo',
      displayFilename: 'photo.jpg',
      expectedContentType: 'image/jpeg',
      expectedByteSize: 100,
    },
  };
}

async function post(
  port: number,
  path: string,
  body: unknown,
  authorization?: string,
): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(authorization === undefined ? {} : { authorization }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: response.statusCode ?? 0,
            body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
          });
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

describe('ValidationHttpServer', () => {
  let server: ValidationHttpServer;
  let processor: RecordingProcessor;
  let port: number;

  async function start(): Promise<void> {
    processor = new RecordingProcessor();
    server = new ValidationHttpServer(new FakeInvocationVerifier(), processor, silentLogger());
    port = await server.listen(0);
  }

  afterEach(async () => {
    await server.close();
  });

  it('returns 204 and invokes the processor when authenticated and the manifest matches the URL', async () => {
    await start();
    const jobId = randomUUID();

    const response = await post(
      port,
      `/internal/media-validation-jobs/${jobId}`,
      manifestFor(jobId),
      'Bearer valid-token',
    );

    expect(response.statusCode).toBe(204);
    expect(processor.received).toHaveLength(1);
    expect(processor.received[0]?.jobId).toBe(jobId);
  });

  it('rejects a missing Authorization header with 401, before ever invoking the processor', async () => {
    await start();
    const jobId = randomUUID();

    const response = await post(
      port,
      `/internal/media-validation-jobs/${jobId}`,
      manifestFor(jobId),
    );

    expect(response.statusCode).toBe(401);
    expect(processor.received).toHaveLength(0);
  });

  it('rejects an invalid bearer token with 401', async () => {
    await start();
    const jobId = randomUUID();

    const response = await post(
      port,
      `/internal/media-validation-jobs/${jobId}`,
      manifestFor(jobId),
      'Bearer wrong-token',
    );

    expect(response.statusCode).toBe(401);
    expect(processor.received).toHaveLength(0);
  });

  it('rejects a manifest whose jobId disagrees with the URL with 400, without invoking the processor', async () => {
    await start();
    const jobId = randomUUID();

    const response = await post(
      port,
      `/internal/media-validation-jobs/${jobId}`,
      manifestFor(randomUUID()),
      'Bearer valid-token',
    );

    expect(response.statusCode).toBe(400);
    expect(processor.received).toHaveLength(0);
  });

  it('rejects a structurally invalid manifest with 400', async () => {
    await start();
    const jobId = randomUUID();

    const response = await post(
      port,
      `/internal/media-validation-jobs/${jobId}`,
      { jobId },
      'Bearer valid-token',
    );

    expect(response.statusCode).toBe(400);
    expect(processor.received).toHaveLength(0);
  });

  it('returns 404 for an unrecognized path', async () => {
    await start();

    const response = await post(port, '/not-a-real-route', {}, 'Bearer valid-token');

    expect(response.statusCode).toBe(404);
  });

  it('answers the health check without authentication', async () => {
    await start();

    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const request = http.request(
        { method: 'GET', host: '127.0.0.1', port, path: '/health/live' },
        (res) => resolve({ statusCode: res.statusCode ?? 0 }),
      );
      request.on('error', reject);
      request.end();
    });

    expect(response.statusCode).toBe(204);
  });

  it('returns 503, not 500, when the processor throws a transient error — a retryable signal to Cloud Tasks', async () => {
    await start();
    const jobId = randomUUID();
    processor.rejectNextWith = new Error('object storage temporarily unavailable');

    const response = await post(
      port,
      `/internal/media-validation-jobs/${jobId}`,
      manifestFor(jobId),
      'Bearer valid-token',
    );

    expect(response.statusCode).toBe(503);
  });
});
