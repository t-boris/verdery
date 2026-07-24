import { createHash } from 'node:crypto';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Storage } from '@google-cloud/storage';
import {
  type MaterializedMediaObject,
  type MediaObjectSource,
  ObjectTooLargeError,
} from './media-object-source.js';

const HEADER_LIMIT_BYTES = 64 * 1024;

/**
 * Streams a private GCS object to an isolated temporary directory while
 * enforcing the byte ceiling and computing SHA-256. No object bytes enter
 * PostgreSQL, Cloud Tasks, or the interactive API.
 */
export class GcsMediaObjectSource implements MediaObjectSource {
  constructor(private readonly storage: Storage) {}

  async materialize(
    bucketName: string,
    objectKey: string,
    maxBytes: number,
  ): Promise<MaterializedMediaObject> {
    const directory = await mkdtemp(join(tmpdir(), 'verdery-media-'));
    const path = join(directory, 'input');
    const output = await open(path, 'wx', 0o600);
    const hash = createHash('sha256');
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;
    let byteSize = 0;

    try {
      const input = this.storage.bucket(bucketName).file(objectKey).createReadStream();
      for await (const rawChunk of input as AsyncIterable<Uint8Array>) {
        const chunk = Buffer.from(rawChunk);
        byteSize += chunk.length;
        if (byteSize > maxBytes) {
          throw new ObjectTooLargeError(byteSize, maxBytes);
        }
        hash.update(chunk);
        if (headerBytes < HEADER_LIMIT_BYTES) {
          const part = chunk.subarray(0, HEADER_LIMIT_BYTES - headerBytes);
          headerChunks.push(part);
          headerBytes += part.length;
        }
        await output.write(chunk);
      }
      await output.close();

      return {
        path,
        byteSize,
        checksumSha256: hash.digest('hex'),
        header: Buffer.concat(headerChunks),
        dispose: async () => rm(directory, { recursive: true, force: true }),
      };
    } catch (error) {
      await output.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
