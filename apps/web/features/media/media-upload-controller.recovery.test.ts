import { describe, expect, it, vi } from 'vitest';

import { ResumableUploadAbortedError } from './gcs-resumable-transport';
import type { ResumablePutRequest, ResumablePutResponse } from './gcs-resumable-transport';
import { createMediaUploadController } from './media-upload-controller';
import {
  FakePendingUploadStore,
  GARDEN_ID,
  MEDIA_ID,
  baseMedia,
  fakeFile,
  fakeMediaGateway,
  ok,
  scriptedTransport,
  uploadSession,
} from './media-upload-test-fixtures';

/**
 * Reload-recovery (`checkForRecoverableUpload`/`resumeRecovered`/
 * `discardRecovered`), cancellation, and subscriber-notification behaviors.
 * Lifecycle/retry behavior lives in `media-upload-controller.test.ts` — split
 * only because the combined suite exceeded this repository's 600-line
 * source-file limit.
 */
/**
 * Drives fake timers until the controller reaches `phase`.
 *
 * Not a fixed number of flushes: registration hashes the file first
 * (`media-checksum.ts`), and how many awaits stand between the pick and the
 * upload is an implementation detail. Counting them passed locally and failed
 * in CI, where the digest resolved a tick later — so this waits for the state
 * the test is actually about, and gives up after a bound rather than hanging
 * if it never arrives.
 */
/**
 * Waits for the controller to reach a phase, then returns.
 *
 * The upload path awaits several promises before it starts sending — the
 * checksum among them — so a FIXED number of flushes is a race: it passed
 * locally and failed on a loaded CI runner, which is what brought this
 * helper about. The bound here is generous rather than tuned, and
 * exhausting it throws naming the phase actually reached, so a genuine hang
 * reads as a hang instead of as a confusing assertion about the wrong state.
 *
 * Only `advanceTimersByTimeAsync` is used to yield: `vi.useFakeTimers()`
 * fakes `setImmediate` too, so waiting on one here would never return.
 */
async function advanceUntilPhase(
  controller: { getState: () => { phase: string } },
  phase: string,
  maxTurns = 200,
): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (controller.getState().phase === phase) return;
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error(
    `Timed out waiting for phase "${phase}"; the controller stayed at "${controller.getState().phase}".`,
  );
}

describe('createMediaUploadController — reload recovery, cancellation, subscribers', () => {
  it('finds an unexpired pending record on mount and resumes it to completion', async () => {
    const store = new FakePendingUploadStore();
    await store.put({
      mediaId: MEDIA_ID,
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      displayFilename: 'backyard.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 1024,
      uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadId=abc',
      uploadUrlExpiresAt: '2026-07-21T10:00:00Z',
      confirmedOffsetBytes: 512,
      savedAt: '2026-07-21T09:00:00Z',
      file: new Blob([new Uint8Array(1024)]),
    });

    const { gateway, getStatus, complete } = fakeMediaGateway();
    getStatus.mockResolvedValue(ok(baseMedia({ uploadState: 'authorized', revision: 1 })));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: null, revision: 2 })),
    );
    const { transport } = scriptedTransport([
      { status: 308, rangeHeader: 'bytes=0-511' },
      { status: 201, rangeHeader: null },
    ]);

    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport,
      store,
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:30:00Z'),
    });

    await controller.checkForRecoverableUpload();
    expect(controller.getState().phase).toBe('recoverable');
    expect(controller.getState().uploadedBytes).toBe(512);

    await controller.resumeRecovered();
    expect(controller.getState().phase).toBe('processing');
    controller.dispose();
  });

  it('purges an already-expired pending record on mount rather than offering to resume it', async () => {
    const store = new FakePendingUploadStore();
    await store.put({
      mediaId: MEDIA_ID,
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      displayFilename: 'backyard.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 1024,
      uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadId=abc',
      uploadUrlExpiresAt: '2026-07-21T08:00:00Z',
      confirmedOffsetBytes: 512,
      savedAt: '2026-07-21T07:00:00Z',
      file: new Blob([new Uint8Array(1024)]),
    });

    const { gateway } = fakeMediaGateway();
    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport: () => Promise.reject(new Error('should not be called')),
      store,
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:30:00Z'),
    });

    await controller.checkForRecoverableUpload();

    expect(controller.getState().phase).toBe('idle');
    expect(await store.get(MEDIA_ID)).toBeNull();
    controller.dispose();
  });

  it('discards a recovered record on request, deleting it from the store', async () => {
    const store = new FakePendingUploadStore();
    await store.put({
      mediaId: MEDIA_ID,
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      displayFilename: 'backyard.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 1024,
      uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadId=abc',
      uploadUrlExpiresAt: '2026-07-21T10:00:00Z',
      confirmedOffsetBytes: 512,
      savedAt: '2026-07-21T09:00:00Z',
      file: new Blob([new Uint8Array(1024)]),
    });

    const { gateway } = fakeMediaGateway();
    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport: () => Promise.reject(new Error('should not be called')),
      store,
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:30:00Z'),
    });

    await controller.checkForRecoverableUpload();
    expect(controller.getState().phase).toBe('recoverable');

    await controller.discardRecovered();
    expect(controller.getState().phase).toBe('idle');
    expect(await store.get(MEDIA_ID)).toBeNull();
    controller.dispose();
  });

  it('cancels an in-flight upload, aborting the transport and clearing its pending record', async () => {
    vi.useFakeTimers();
    const { gateway, register } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));

    let abortedSignal: AbortSignal | undefined;
    const transport = (request: ResumablePutRequest): Promise<ResumablePutResponse> => {
      if (request.body === null) {
        return Promise.resolve({ status: 308, rangeHeader: null }); // status check
      }
      abortedSignal = request.signal;
      // Mirrors the real `createXhrResumableTransport`: the request settles
      // only once its signal aborts (or, in the browser, once the server
      // responds) — never on its own.
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new ResumableUploadAbortedError()));
      });
    };

    const store = new FakePendingUploadStore();
    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport,
      store,
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:00:00Z'),
    });

    const uploadPromise = controller.startUpload(fakeFile());
    await advanceUntilPhase(controller, 'uploading');
    expect(controller.getState().phase).toBe('uploading');

    await controller.cancel();
    expect(abortedSignal?.aborted).toBe(true);
    expect(controller.getState().phase).toBe('idle');
    expect(await store.get(MEDIA_ID)).toBeNull();

    controller.dispose();
    await uploadPromise.catch(() => undefined);
    vi.useRealTimers();
  });

  it('notifies subscribers on every state change and stops after dispose', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: null, revision: 2 })),
    );
    const { transport } = scriptedTransport([
      { status: 308, rangeHeader: null },
      { status: 201, rangeHeader: null },
    ]);

    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport,
      store: new FakePendingUploadStore(),
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:00:00Z'),
    });

    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    await controller.startUpload(fakeFile());
    expect(listener).toHaveBeenCalled();

    const callsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    controller.dispose();
    expect(listener.mock.calls.length).toBe(callsBeforeUnsubscribe);
  });
});
