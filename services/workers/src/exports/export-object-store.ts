/**
 * Port for the export job's own Cloud Storage reads and writes
 * (P8-EXPORT-01): staging section objects, reading them (and media
 * originals) back, and streaming the assembled ZIP — the worker's
 * byte-moving half of the split (`export-api-client.ts` is the database
 * half). Follows the `DerivativeObjectSink`/`MediaObjectSource`
 * port-plus-adapter-plus-fake convention; the real adapter is
 * `gcs-export-object-store.ts`.
 */

import type { Writable } from 'node:stream';

export interface StoredExportObject {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
}

/** A destination stream plus its durable-completion promise — `whenStored` resolves only once the object is fully written. */
export interface ExportObjectWriteStream {
  readonly writable: Writable;
  whenStored(): Promise<void>;
}

export interface ExportObjectStore {
  /** Buffered write for the small staged section objects. */
  write(
    bucketName: string,
    objectKey: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredExportObject>;

  /** Whole-object read; `null` when no object exists — never throws for a simple absence (a deleted media original is a LISTED fact, not an error). */
  read(bucketName: string, objectKey: string): Promise<Buffer | null>;

  /** Streaming write for the final ZIP — packages can exceed what one buffer should hold. */
  openWriteStream(
    bucketName: string,
    objectKey: string,
    contentType: string,
  ): ExportObjectWriteStream;
}
