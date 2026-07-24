import { describe, expect, it, vi } from 'vitest';

import type { ResumablePutRequest, ResumablePutResponse } from './gcs-resumable-transport';
import { ResumableUploadAbortedError } from './gcs-resumable-transport';
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  checkResumableUploadStatus,
  uploadResumableFile,
} from './resumable-upload-driver';

const UPLOAD_URL = 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadId=abc';

function blobOfSize(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

function recordingTransport(responses: readonly (ResumablePutResponse | Error)[]): {
  transport: (request: ResumablePutRequest) => Promise<ResumablePutResponse>;
  calls: ResumablePutRequest[];
} {
  const calls: ResumablePutRequest[] = [];
  let index = 0;

  return {
    calls,
    transport: (request) => {
      calls.push(request);
      const outcome = responses[Math.min(index, responses.length - 1)] ?? {
        status: 500,
        rangeHeader: null,
      };
      index += 1;
      request.onProgress?.(request.body?.size ?? 0);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
}

describe('checkResumableUploadStatus', () => {
  it('reports incomplete with the bytes the server actually confirmed', async () => {
    const { transport, calls } = recordingTransport([{ status: 308, rangeHeader: 'bytes=0-1023' }]);

    const status = await checkResumableUploadStatus(transport, UPLOAD_URL, 4096);

    expect(status).toEqual({ kind: 'incomplete', uploadedBytes: 1024, httpStatus: 308 });
    expect(calls[0]?.contentRange).toBe('bytes */4096');
    expect(calls[0]?.body).toBeNull();
  });

  it('reports complete on 200/201', async () => {
    const { transport } = recordingTransport([{ status: 200, rangeHeader: null }]);

    const status = await checkResumableUploadStatus(transport, UPLOAD_URL, 4096);

    expect(status).toEqual({ kind: 'complete', uploadedBytes: 4096, httpStatus: 200 });
  });

  it('reports sessionNotFound on 404', async () => {
    const { transport } = recordingTransport([{ status: 404, rangeHeader: null }]);

    const status = await checkResumableUploadStatus(transport, UPLOAD_URL, 4096);

    expect(status.kind).toBe('sessionNotFound');
  });

  it('reports unexpected on any other status', async () => {
    const { transport } = recordingTransport([{ status: 500, rangeHeader: null }]);

    const status = await checkResumableUploadStatus(transport, UPLOAD_URL, 4096);

    expect(status.kind).toBe('unexpected');
  });
});

describe('uploadResumableFile', () => {
  it('uploads a small file in a single chunk after confirming the session starts empty', async () => {
    const total = 1024;
    const { transport, calls } = recordingTransport([
      { status: 308, rangeHeader: null }, // status check: nothing received yet
      { status: 201, rangeHeader: null }, // the one chunk completes the upload
    ]);
    const onProgress = vi.fn();

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'complete' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.contentRange).toBe(`bytes 0-${String(total - 1)}/${String(total)}`);
    expect(onProgress).toHaveBeenLastCalledWith({ uploadedBytes: total, totalBytes: total });
  });

  it('splits a large file across chunk-size-aligned requests', async () => {
    const total = DEFAULT_CHUNK_SIZE_BYTES * 2 + 100;
    const { transport, calls } = recordingTransport([
      { status: 308, rangeHeader: null },
      { status: 308, rangeHeader: `bytes=0-${String(DEFAULT_CHUNK_SIZE_BYTES - 1)}` },
      { status: 308, rangeHeader: `bytes=0-${String(DEFAULT_CHUNK_SIZE_BYTES * 2 - 1)}` },
      { status: 200, rangeHeader: null },
    ]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'complete' });
    // One status check plus three chunks (two full, one final partial one).
    expect(calls).toHaveLength(4);
    expect(calls[1]?.contentRange).toBe(
      `bytes 0-${String(DEFAULT_CHUNK_SIZE_BYTES - 1)}/${String(total)}`,
    );
    expect(calls[2]?.contentRange).toBe(
      `bytes ${String(DEFAULT_CHUNK_SIZE_BYTES)}-${String(DEFAULT_CHUNK_SIZE_BYTES * 2 - 1)}/${String(total)}`,
    );
    expect(calls[3]?.contentRange).toBe(
      `bytes ${String(DEFAULT_CHUNK_SIZE_BYTES * 2)}-${String(total - 1)}/${String(total)}`,
    );
  });

  it('resumes from the offset the status check reports rather than re-sending already-confirmed bytes', async () => {
    const total = DEFAULT_CHUNK_SIZE_BYTES * 2;
    const { transport, calls } = recordingTransport([
      { status: 308, rangeHeader: `bytes=0-${String(DEFAULT_CHUNK_SIZE_BYTES - 1)}` },
      { status: 201, rangeHeader: null },
    ]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'complete' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.contentRange).toBe(
      `bytes ${String(DEFAULT_CHUNK_SIZE_BYTES)}-${String(total - 1)}/${String(total)}`,
    );
  });

  it('reports paused with the last confirmed offset when the signal is already aborted before the next chunk', async () => {
    const total = DEFAULT_CHUNK_SIZE_BYTES * 2;
    const { transport } = recordingTransport([
      { status: 308, rangeHeader: `bytes=0-${String(DEFAULT_CHUNK_SIZE_BYTES - 1)}` },
    ]);
    const controller = new AbortController();
    controller.abort();

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: controller.signal,
    });

    expect(result).toEqual({ kind: 'paused', uploadedBytes: DEFAULT_CHUNK_SIZE_BYTES });
  });

  it('reports paused when a chunk request itself is aborted mid-flight', async () => {
    const total = 1024;
    const { transport } = recordingTransport([
      { status: 308, rangeHeader: null },
      new ResumableUploadAbortedError(),
    ]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'paused', uploadedBytes: 0 });
  });

  it('reports sessionExpired when the server no longer recognizes the upload session', async () => {
    const total = 1024;
    const { transport } = recordingTransport([{ status: 404, rangeHeader: null }]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'sessionExpired' });
  });

  it('reports a retryable failure on a transport-level (network) error mid-chunk', async () => {
    const total = 1024;
    const { transport } = recordingTransport([
      { status: 308, rangeHeader: null },
      new Error('offline'),
    ]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'failed', retryable: true, uploadedBytes: 0 });
  });

  it('reports a non-retryable failure on an unexpected chunk status', async () => {
    const total = 1024;
    const { transport } = recordingTransport([
      { status: 308, rangeHeader: null },
      { status: 403, rangeHeader: null },
    ]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'failed', retryable: false, uploadedBytes: 0 });
  });

  it('gives up after repeated stalled chunks instead of retrying forever', async () => {
    const total = 1024;
    const { transport, calls } = recordingTransport([
      { status: 308, rangeHeader: null }, // status check
      { status: 308, rangeHeader: null }, // chunk stalls, no bytes confirmed
      { status: 308, rangeHeader: null },
      { status: 308, rangeHeader: null },
    ]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'failed', retryable: true, uploadedBytes: 0 });
    // One status check plus exactly the stall limit's worth of chunk attempts.
    expect(calls).toHaveLength(4);
  });

  it('treats an already-complete session (discovered by the status check) as complete without sending any chunk', async () => {
    const total = 1024;
    const { transport, calls } = recordingTransport([{ status: 200, rangeHeader: null }]);

    const result = await uploadResumableFile({
      transport,
      uploadUrl: UPLOAD_URL,
      file: blobOfSize(total),
      totalBytes: total,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: 'complete' });
    expect(calls).toHaveLength(1);
  });
});
