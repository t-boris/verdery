/**
 * Streaming ZIP assembly for one export package (P8-EXPORT-01), over
 * `archiver` — the boring, maintained choice for streaming ZIP writing in
 * Node (the `sharp`/`file-type` dependency-selection precedent: a
 * first-party format implementation would be hundreds of lines of
 * central-directory bookkeeping this project has no reason to own, and
 * `archiver` is the ecosystem's long-standability default with zip64
 * support built in). Entries stream through a SHA-256/byte-count tee into
 * the caller's sink, so the package's own checksum and size are computed
 * exactly once, on exactly the bytes stored.
 */

import { createHash, type Hash } from 'node:crypto';
import { Transform, type Writable } from 'node:stream';
import archiver, { type Archiver } from 'archiver';

export interface FinalizedZipPackage {
  readonly byteSize: number;
  readonly checksumSha256: string;
}

export class ZipPackageWriter {
  private readonly archive: Archiver;
  private readonly hash: Hash;
  private byteSize = 0;
  private readonly sinkDone: Promise<void>;

  constructor(sink: Writable) {
    this.hash = createHash('sha256');
    // Deflate at default level: the structured sections compress well, and
    // already-compressed media (JPEG/PNG) costs little extra CPU.
    this.archive = archiver('zip', { zlib: { level: 6 } });

    const tee = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        this.hash.update(chunk);
        this.byteSize += chunk.length;
        callback(null, chunk);
      },
    });

    this.sinkDone = new Promise<void>((resolve, reject) => {
      sink.once('finish', resolve);
      sink.once('error', reject);
      this.archive.once('error', reject);
      tee.once('error', reject);
    });

    this.archive.pipe(tee).pipe(sink);
  }

  addEntry(entryPath: string, content: Buffer): void {
    this.archive.append(content, { name: entryPath });
  }

  /**
   * Writes the central directory and resolves once the SINK has finished —
   * the figures describe fully stored bytes, never in-flight ones. The two
   * halves (archiver's own finalize, the sink's completion) are awaited as
   * a settled pair: on a mid-stream failure BOTH typically reject, and
   * awaiting them sequentially would leave whichever rejects second as an
   * unhandled rejection while still surfacing only one failure.
   */
  async finalize(): Promise<FinalizedZipPackage> {
    const settled = await Promise.allSettled([this.archive.finalize(), this.sinkDone]);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected !== undefined) {
      throw rejected.reason;
    }

    return { byteSize: this.byteSize, checksumSha256: this.hash.digest('hex') };
  }
}
