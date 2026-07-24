/**
 * Unit coverage for `GcsMediaObjectSource` — the real bounded-download
 * mechanism behind this stage's "at or just over the byte-size cap" required
 * fixture and the streaming SHA-256 checksum. Uses a hand-built fake
 * `Storage` (a plain object satisfying only the `.bucket().file().
 * createReadStream()` shape this class actually calls), never real Cloud
 * Storage credentials or a network call — matching this codebase's
 * port-plus-adapter-plus-fake convention.
 */

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Storage } from '@google-cloud/storage';
import { describe, expect, it } from 'vitest';
import { GcsMediaObjectSource } from './gcs-media-object-source.js';
import { ObjectTooLargeError } from './media-object-source.js';

function fakeStorage(chunks: readonly Buffer[]): Storage {
  return {
    bucket: () => ({
      file: () => ({
        createReadStream: () => Readable.from(chunks),
      }),
    }),
  } as unknown as Storage;
}

describe('GcsMediaObjectSource', () => {
  it('materializes an object under the byte cap, computing a real streaming checksum from the actual bytes', async () => {
    const bytes = Buffer.from('a small, ordinary test payload');
    const source = new GcsMediaObjectSource(fakeStorage([bytes]));

    const object = await source.materialize('bucket', 'object-key', bytes.length + 1);
    try {
      expect(object.byteSize).toBe(bytes.length);
      expect(object.checksumSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(object.header.equals(bytes)).toBe(true);
    } finally {
      await object.dispose();
    }
  });

  it('accepts a file exactly at the byte-size cap', async () => {
    const exactlyAtCap = Buffer.alloc(100, 0x41);
    const source = new GcsMediaObjectSource(fakeStorage([exactlyAtCap]));

    const object = await source.materialize('bucket', 'object-key', 100);
    try {
      expect(object.byteSize).toBe(100);
    } finally {
      await object.dispose();
    }
  });

  it('rejects a file one byte over the cap before reading further — the parser-bomb / oversized-object fixture', async () => {
    const oneOverCap = Buffer.alloc(101, 0x41);
    const source = new GcsMediaObjectSource(fakeStorage([oneOverCap]));

    await expect(source.materialize('bucket', 'object-key', 100)).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });

  it('rejects a cap violation that only becomes apparent mid-stream, across multiple chunks', async () => {
    // The cap is enforced as bytes arrive, not after buffering the whole
    // object — split the payload so the 100-byte cap is only exceeded by the
    // SECOND chunk, proving the check runs per-chunk during the stream, not
    // once at the end.
    const source = new GcsMediaObjectSource(
      fakeStorage([Buffer.alloc(60, 0x41), Buffer.alloc(60, 0x42)]),
    );

    await expect(source.materialize('bucket', 'object-key', 100)).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });

  it('reports the real object size and cap on the ObjectTooLargeError, not a rounded or generic value', async () => {
    const source = new GcsMediaObjectSource(fakeStorage([Buffer.alloc(150, 0x41)]));

    try {
      await source.materialize('bucket', 'object-key', 100);
      expect.unreachable('materialize should have rejected an oversized object');
    } catch (error) {
      expect(error).toBeInstanceOf(ObjectTooLargeError);
      const objectTooLargeError = error as ObjectTooLargeError;
      expect(objectTooLargeError.actualBytes).toBe(150);
      expect(objectTooLargeError.maxBytes).toBe(100);
    }
  });
});
