/**
 * Port for writing one derivative object's bytes to the derived bucket.
 *
 * Follows this codebase's established port-plus-adapter-plus-fake
 * convention (see `../validation/media-object-source.ts` for the identical
 * shape on the READ side): the real adapter is
 * `gcs-derivative-object-sink.ts` (`@google-cloud/storage`-backed); tests
 * use a fake implementing this same interface.
 */

export interface StoredDerivativeObject {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
}

export interface DerivativeObjectSink {
  /** Writes `buffer` to `objectKey` in this sink's own bucket, returning the real, computed byte size and SHA-256 checksum. */
  write(objectKey: string, buffer: Buffer, contentType: string): Promise<StoredDerivativeObject>;
}
