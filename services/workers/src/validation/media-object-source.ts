export interface MaterializedMediaObject {
  readonly path: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly header: Buffer;
  dispose(): Promise<void>;
}

export interface MediaObjectSource {
  materialize(
    bucketName: string,
    objectKey: string,
    maxBytes: number,
  ): Promise<MaterializedMediaObject>;
}

export class ObjectTooLargeError extends Error {
  constructor(
    readonly actualBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Object size ${actualBytes} exceeds the ${maxBytes} byte limit.`);
    this.name = 'ObjectTooLargeError';
  }
}
