/**
 * Chunked-upload orchestration on top of `gcs-resumable-transport.ts`'s raw
 * protocol primitive. Pure logic, transport-injected, so it is fully
 * unit-testable against a recording/fake `ResumableTransport` — mirroring
 * `core/api/plant-gateway.test.ts`'s own `FetchLike`-double convention.
 *
 * Source: architecture/media-storage-and-processing.md, section "7. Upload
 * Flow"; implementation-plan.md work package P6-WEB-01.
 */

import {
  GCS_CHUNK_ALIGNMENT_BYTES,
  ResumableUploadAbortedError,
  parseReceivedBytes,
  type ResumableTransport,
} from './gcs-resumable-transport';

/**
 * 32 chunks of the 256 KiB alignment unit (8 MiB). A reasoned default, not
 * named anywhere in the architecture doc: large enough to keep the request
 * count for this stage's largest accepted file (50 MiB imported plans, per
 * media-storage-and-processing.md section 8.1) at a handful of chunks, small
 * enough that pausing mid-upload never discards more than a few seconds of
 * already-sent bytes on an ordinary connection.
 */
export const DEFAULT_CHUNK_SIZE_BYTES = 32 * GCS_CHUNK_ALIGNMENT_BYTES;

export interface ResumableUploadStatus {
  readonly kind: 'incomplete' | 'complete' | 'sessionNotFound' | 'unexpected';
  readonly uploadedBytes: number;
  readonly httpStatus: number;
}

/**
 * Queries the session's authoritative durable offset directly from Cloud
 * Storage — used both to resume (after a pause, a failed chunk, or a page
 * reload) and, once, before every fresh upload too, so the driver has
 * exactly one source of truth for "how much has the server actually kept"
 * rather than trusting a locally remembered offset that a dropped
 * connection could have made stale.
 */
export async function checkResumableUploadStatus(
  transport: ResumableTransport,
  uploadUrl: string,
  totalBytes: number,
): Promise<ResumableUploadStatus> {
  const response = await transport({
    uploadUrl,
    contentRange: `bytes */${String(totalBytes)}`,
    body: null,
  });

  if (response.status === 200 || response.status === 201) {
    return { kind: 'complete', uploadedBytes: totalBytes, httpStatus: response.status };
  }
  if (response.status === 308) {
    return {
      kind: 'incomplete',
      uploadedBytes: parseReceivedBytes(response.rangeHeader),
      httpStatus: response.status,
    };
  }
  if (response.status === 404) {
    return { kind: 'sessionNotFound', uploadedBytes: 0, httpStatus: response.status };
  }
  return { kind: 'unexpected', uploadedBytes: 0, httpStatus: response.status };
}

export interface ResumableUploadProgress {
  readonly uploadedBytes: number;
  readonly totalBytes: number;
}

export type ResumableUploadResult =
  | { readonly kind: 'complete' }
  | { readonly kind: 'paused'; readonly uploadedBytes: number }
  | { readonly kind: 'sessionExpired' }
  | { readonly kind: 'failed'; readonly retryable: boolean; readonly uploadedBytes: number };

export interface UploadResumableFileOptions {
  readonly transport: ResumableTransport;
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly totalBytes: number;
  readonly chunkSizeBytes?: number;
  readonly onProgress: (progress: ResumableUploadProgress) => void;
  readonly signal: AbortSignal;
}

/**
 * Reconciles with the server's own durable offset first (see
 * `checkResumableUploadStatus`'s own comment), then sends whatever remains
 * in `chunkSizeBytes`-aligned chunks. One call handles a fresh upload
 * (offset discovered to be `0`), a resume after pause, a retry after a
 * failed chunk, and a resume after a page reload alike — the caller never
 * has to pick a different code path for any of those, only supply the same
 * `file` again (see `pending-upload-store.ts` for how that survives a
 * reload).
 */
export async function uploadResumableFile(
  options: UploadResumableFileOptions,
): Promise<ResumableUploadResult> {
  const chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;

  let status: ResumableUploadStatus;
  try {
    status = await checkResumableUploadStatus(
      options.transport,
      options.uploadUrl,
      options.totalBytes,
    );
  } catch (error) {
    if (error instanceof ResumableUploadAbortedError) {
      return { kind: 'paused', uploadedBytes: 0 };
    }
    return { kind: 'failed', retryable: true, uploadedBytes: 0 };
  }

  if (status.kind === 'sessionNotFound') {
    return { kind: 'sessionExpired' };
  }
  if (status.kind === 'unexpected') {
    return { kind: 'failed', retryable: false, uploadedBytes: 0 };
  }
  if (status.kind === 'complete') {
    options.onProgress({ uploadedBytes: options.totalBytes, totalBytes: options.totalBytes });
    return { kind: 'complete' };
  }

  let offset = status.uploadedBytes;
  options.onProgress({ uploadedBytes: offset, totalBytes: options.totalBytes });

  // A chunk that comes back `308` with no advance on the server's own
  // reported offset (the whole chunk was silently dropped, repeatedly) is
  // treated as a real failure after a few attempts rather than an infinite
  // retry loop with no way for the UI to ever surface a "Retry" control.
  const MAX_CONSECUTIVE_STALLED_CHUNKS = 3;
  let consecutiveStalledChunks = 0;

  while (offset < options.totalBytes) {
    if (options.signal.aborted) {
      return { kind: 'paused', uploadedBytes: offset };
    }

    const endInclusive = Math.min(offset + chunkSizeBytes, options.totalBytes) - 1;
    const chunkStart = offset;

    let response;
    try {
      response = await options.transport({
        uploadUrl: options.uploadUrl,
        contentRange: `bytes ${String(chunkStart)}-${String(endInclusive)}/${String(options.totalBytes)}`,
        body: options.file.slice(chunkStart, endInclusive + 1),
        onProgress: (loadedInChunk) =>
          options.onProgress({
            uploadedBytes: chunkStart + loadedInChunk,
            totalBytes: options.totalBytes,
          }),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof ResumableUploadAbortedError) {
        return { kind: 'paused', uploadedBytes: offset };
      }
      return { kind: 'failed', retryable: true, uploadedBytes: offset };
    }

    if (response.status === 200 || response.status === 201) {
      options.onProgress({ uploadedBytes: options.totalBytes, totalBytes: options.totalBytes });
      return { kind: 'complete' };
    }
    if (response.status === 308) {
      // Trust the server's own `Range` header over what this client just
      // attempted to send — a dropped connection mid-chunk can mean fewer
      // bytes landed than were written to the socket. A response with no
      // `Range` header at all means zero bytes are durably stored yet
      // (per Google's own protocol), so the next iteration correctly
      // re-sends from the start rather than silently trusting a guess.
      const newOffset = parseReceivedBytes(response.rangeHeader);
      if (newOffset <= chunkStart) {
        consecutiveStalledChunks += 1;
        if (consecutiveStalledChunks >= MAX_CONSECUTIVE_STALLED_CHUNKS) {
          return { kind: 'failed', retryable: true, uploadedBytes: offset };
        }
      } else {
        consecutiveStalledChunks = 0;
      }
      offset = newOffset;
      options.onProgress({ uploadedBytes: offset, totalBytes: options.totalBytes });
      continue;
    }
    if (response.status === 404) {
      return { kind: 'sessionExpired' };
    }
    return { kind: 'failed', retryable: false, uploadedBytes: offset };
  }

  return { kind: 'complete' };
}
