/**
 * Unit coverage for `GcsDerivativeObjectSink` — a hand-built fake `Storage`
 * (only the `.bucket().file().save()` shape this class actually calls),
 * mirroring `../validation/gcs-media-object-source.test.ts`'s own fake-
 * Storage convention on the read side.
 */

import { createHash } from 'node:crypto';
import type { Storage } from '@google-cloud/storage';
import { describe, expect, it } from 'vitest';
import { GcsDerivativeObjectSink } from './gcs-derivative-object-sink.js';

function fakeStorage(): {
  storage: Storage;
  saved: { bucket: string; key: string; contentType: string; buffer: Buffer }[];
} {
  const saved: { bucket: string; key: string; contentType: string; buffer: Buffer }[] = [];
  const storage = {
    bucket: (bucketName: string) => ({
      file: (objectKey: string) => ({
        save: (buffer: Buffer, options: { contentType: string }) => {
          saved.push({
            bucket: bucketName,
            key: objectKey,
            contentType: options.contentType,
            buffer,
          });
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Storage;
  return { storage, saved };
}

describe('GcsDerivativeObjectSink', () => {
  it('writes the buffer to the configured bucket at the given object key, real content type, byte size, and checksum', async () => {
    const { storage, saved } = fakeStorage();
    const sink = new GcsDerivativeObjectSink(storage, 'derived-bucket');
    const buffer = Buffer.from('a small derivative payload');

    const stored = await sink.write('ab/media-id/object-uuid', buffer, 'image/jpeg');

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      bucket: 'derived-bucket',
      key: 'ab/media-id/object-uuid',
      contentType: 'image/jpeg',
    });
    expect(stored).toEqual({
      bucketName: 'derived-bucket',
      objectKey: 'ab/media-id/object-uuid',
      byteSize: buffer.length,
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    });
  });

  it('a different buffer produces a different real checksum, not a fixed placeholder', async () => {
    const { storage } = fakeStorage();
    const sink = new GcsDerivativeObjectSink(storage, 'derived-bucket');

    const first = await sink.write('key-a', Buffer.from('payload one'), 'image/png');
    const second = await sink.write('key-b', Buffer.from('payload two'), 'image/png');

    expect(first.checksumSha256).not.toBe(second.checksumSha256);
  });
});
