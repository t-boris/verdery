/**
 * Shared in-memory test doubles for the export job's own unit tests —
 * the `relay-test-doubles.ts` convention. Not itself a `*.test.ts` file,
 * so vitest never runs it as a suite; imports no devDependency, so the
 * production build compiling it stays clean.
 */

import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type {
  ExportCheckpointRequest,
  ExportCompletionRequest,
  ExportSnapshotResponse,
} from '@verdery/api-contracts';
import type { Logger } from '../logger.js';
import type { ExportApiClient } from './export-api-client.js';
import type {
  ExportObjectStore,
  ExportObjectWriteStream,
  StoredExportObject,
} from './export-object-store.js';

export function silentLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as Logger;
}

export class FakeExportApiClient implements ExportApiClient {
  snapshots: ExportSnapshotResponse[] = [];
  readonly checkpointCalls: { exportRequestId: string; body: ExportCheckpointRequest }[] = [];
  readonly completionCalls: { exportRequestId: string; body: ExportCompletionRequest }[] = [];
  private snapshotIndex = 0;

  fetchSnapshot(_exportRequestId: string): Promise<ExportSnapshotResponse> {
    const snapshot = this.snapshots[Math.min(this.snapshotIndex, this.snapshots.length - 1)];
    this.snapshotIndex += 1;
    if (snapshot === undefined) {
      return Promise.reject(new Error('FakeExportApiClient: no snapshot seeded'));
    }
    return Promise.resolve(snapshot);
  }

  recordCheckpoints(exportRequestId: string, body: ExportCheckpointRequest): Promise<void> {
    this.checkpointCalls.push({ exportRequestId, body });
    return Promise.resolve();
  }

  recordCompletion(exportRequestId: string, body: ExportCompletionRequest): Promise<void> {
    this.completionCalls.push({ exportRequestId, body });
    return Promise.resolve();
  }
}

/** In-memory object store keyed `bucket/objectKey`; the ZIP write stream collects into the same map when it finishes. */
export class FakeExportObjectStore implements ExportObjectStore {
  readonly objects = new Map<string, Buffer>();
  /** When set, the next `openWriteStream` sink fails with this error mid-write — the assembly-crash injection point. */
  failNextZipWrite: Error | null = null;

  private key(bucketName: string, objectKey: string): string {
    return `${bucketName}/${objectKey}`;
  }

  seed(bucketName: string, objectKey: string, content: Buffer): void {
    this.objects.set(this.key(bucketName, objectKey), content);
  }

  delete(bucketName: string, objectKey: string): void {
    this.objects.delete(this.key(bucketName, objectKey));
  }

  write(
    bucketName: string,
    objectKey: string,
    content: Buffer,
    _contentType: string,
  ): Promise<StoredExportObject> {
    this.objects.set(this.key(bucketName, objectKey), content);
    return Promise.resolve({
      bucketName,
      objectKey,
      byteSize: content.length,
      checksumSha256: createHash('sha256').update(content).digest('hex'),
    });
  }

  read(bucketName: string, objectKey: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(this.key(bucketName, objectKey)) ?? null);
  }

  openWriteStream(
    bucketName: string,
    objectKey: string,
    _contentType: string,
  ): ExportObjectWriteStream {
    const failure = this.failNextZipWrite;
    this.failNextZipWrite = null;

    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    const stored = new Promise<void>((resolve, reject) => {
      if (failure !== null) {
        // Fail asynchronously, after some bytes may already be in flight —
        // the shape a real GCS stream failure takes.
        stream.once('data', () => stream.destroy(failure));
        stream.once('error', reject);
        return;
      }
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.once('error', reject);
      stream.once('finish', () => {
        this.objects.set(this.key(bucketName, objectKey), Buffer.concat(chunks));
        resolve();
      });
    });

    return { writable: stream, whenStored: () => stored };
  }
}
