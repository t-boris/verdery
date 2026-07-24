/**
 * Real Google Cloud Storage resumable-upload wire protocol, browser side.
 *
 * `MediaUploadSession.uploadUrl` (from `RegisterMediaUpload`) is a resumable
 * session URI created server-side by `@google-cloud/storage`'s
 * `file.createResumableUpload()` — the same
 * `POST .../o?uploadType=resumable` call Google's own client library makes.
 * From that point on, the PROTOCOL is plain HTTP that any client can speak
 * directly, documented at
 * https://cloud.google.com/storage/docs/performing-resumable-uploads:
 *
 * - A chunk is uploaded with `PUT {uploadUrl}`, header
 *   `Content-Range: bytes {start}-{end}/{total}`, body = that byte range.
 *   Every chunk except the final one must be a multiple of 256 KiB
 *   (`GCS_CHUNK_ALIGNMENT_BYTES`); the final chunk (the one whose `end + 1`
 *   equals `total`) may be any remaining size.
 * - The service replies `308 Resume Incomplete` for an accepted
 *   intermediate chunk, with a `Range: bytes=0-{lastByteIndex}` response
 *   header confirming exactly how much it has durably received — never
 *   assumed equal to what this client believes it just sent, because a
 *   dropped connection mid-chunk can leave the two disagreeing.
 * - The service replies `200`/`201` with the created object's JSON metadata
 *   once the final chunk lands.
 * - The upload's current durable offset can be queried at any time —
 *   crucially, after a page reload, once the file's bytes are available
 *   again (see `pending-upload-store.ts`) — with a status-check request:
 *   `PUT {uploadUrl}`, header `Content-Range: bytes *\/{total}`, empty body.
 *   Same three response shapes apply (308 incomplete / 200-201 complete /
 *   404 the session no longer exists — expired or never valid).
 *
 * `XMLHttpRequest`, not `fetch`, is used for the one thing this module
 * needs that `fetch` cannot reliably give across this codebase's supported
 * browsers (`package.json`'s `browserslist`, Safari included): a real
 * bytes-sent progress event for the request body
 * (`xhr.upload.onprogress`). `fetch`'s upload-progress story is a
 * `ReadableStream` request body, which Safari does not support sending in a
 * `fetch` request as of this codebase's supported Safari baseline.
 *
 * Source: architecture/media-storage-and-processing.md, section "7. Upload
 * Flow"; implementation-plan.md work package P6-WEB-01.
 */

/** GCS's own chunk-size granularity requirement: every non-final chunk must be a multiple of this. */
export const GCS_CHUNK_ALIGNMENT_BYTES = 256 * 1024;

/** One HTTP request against a resumable session URI: a byte-range chunk, or an empty status check. */
export interface ResumablePutRequest {
  readonly uploadUrl: string;
  /** `bytes {start}-{end}/{total}` for a chunk, or `bytes *\/{total}` for a status check. */
  readonly contentRange: string;
  /** `null` for a status check (empty body). */
  readonly body: Blob | null;
  /** Called with cumulative bytes sent for THIS request as the browser reports them. */
  readonly onProgress?: (loadedBytes: number) => void;
  readonly signal?: AbortSignal;
}

export interface ResumablePutResponse {
  readonly status: number;
  /** The response `Range` header (`bytes=0-{lastByteIndex}`), when present. */
  readonly rangeHeader: string | null;
}

/** The seam tests substitute — mirrors `core/api/client.ts`'s own `FetchLike` adapter convention. */
export type ResumableTransport = (request: ResumablePutRequest) => Promise<ResumablePutResponse>;

/** `AbortError` from an aborted `XMLHttpRequest`, distinguished from a real network failure. */
export class ResumableUploadAbortedError extends Error {
  constructor() {
    super('The upload request was aborted.');
    this.name = 'ResumableUploadAbortedError';
  }
}

/**
 * The real transport: issues the PUT directly against Cloud Storage from
 * the browser. Never routed through `core/api/client.ts` — this call
 * targets `storage.googleapis.com`, not this application's own API origin
 * (architecture doc section 2, "Binary media bypasses the interactive API
 * data path").
 */
export function createXhrResumableTransport(): ResumableTransport {
  return (request) =>
    new Promise<ResumablePutResponse>((resolve, reject) => {
      if (request.signal?.aborted === true) {
        reject(new ResumableUploadAbortedError());
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('PUT', request.uploadUrl, true);
      xhr.setRequestHeader('Content-Range', request.contentRange);

      const onAbortSignal = () => xhr.abort();
      request.signal?.addEventListener('abort', onAbortSignal);
      const detach = () => request.signal?.removeEventListener('abort', onAbortSignal);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          request.onProgress?.(event.loaded);
        }
      };
      xhr.onload = () => {
        detach();
        resolve({ status: xhr.status, rangeHeader: xhr.getResponseHeader('Range') });
      };
      xhr.onerror = () => {
        detach();
        reject(new Error('The upload request failed before receiving a response.'));
      };
      xhr.onabort = () => {
        detach();
        reject(new ResumableUploadAbortedError());
      };

      xhr.send(request.body);
    });
}

/** Parses a `Range: bytes=0-{lastByteIndex}` response header into a byte count. `null` means zero bytes received. */
export function parseReceivedBytes(rangeHeader: string | null): number {
  if (rangeHeader === null) {
    return 0;
  }
  const match = /^bytes=0-(\d+)$/u.exec(rangeHeader.trim());
  return match?.[1] === undefined ? 0 : Number(match[1]) + 1;
}
