import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResumableUploadAbortedError } from './gcs-resumable-transport';
import type { ResumablePutRequest, ResumablePutResponse } from './gcs-resumable-transport';
import { createMediaUploadController } from './media-upload-controller';
import {
  FakePendingUploadStore,
  GARDEN_ID,
  MEDIA_ID,
  TRANSPORT_FAILURE,
  baseMedia,
  fakeFile,
  fakeMediaGateway,
  ok,
  scriptedTransport,
  uploadSession,
} from './media-upload-test-fixtures';

/**
 * Upload-lifecycle behavior: fresh registration through terminal outcomes,
 * and every retry path. `media-upload-controller.recovery.test.ts` covers
 * the reload-recovery, cancellation, and subscriber-notification behaviors
 * — split only because the combined suite exceeded this repository's
 * 600-line source-file limit.
 */
describe('createMediaUploadController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives a fresh upload from idle through registering, uploading, completing, to processed', async () => {
    const { gateway, register, getStatus, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: 'processing', revision: 2 })),
    );
    getStatus.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: 'processed', revision: 2 })),
    );

    const { transport } = scriptedTransport([
      { status: 308, rangeHeader: null }, // status check
      { status: 201, rangeHeader: null }, // single chunk completes
    ]);

    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport,
      store: new FakePendingUploadStore(),
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:00:00Z'),
      pollIntervalMs: 10,
    });

    await controller.startUpload(fakeFile());
    expect(controller.getState().phase).toBe('processing');

    await vi.advanceTimersByTimeAsync(20);

    expect(controller.getState().phase).toBe('processed');
    expect(register).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(GARDEN_ID, MEDIA_ID, 1, 'idem-1');
    controller.dispose();
  });

  it('reports the rejected outcome without polling', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(ok(baseMedia({ uploadState: 'rejected', revision: 2 })));
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

    await controller.startUpload(fakeFile());

    expect(controller.getState().phase).toBe('rejected');
    controller.dispose();
  });

  it('surfaces a processing_failed outcome from a later poll', async () => {
    const { gateway, register, getStatus, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: 'processing', revision: 2 })),
    );
    getStatus.mockResolvedValue(
      ok(
        baseMedia({ uploadState: 'available', processingState: 'processing_failed', revision: 2 }),
      ),
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
      pollIntervalMs: 10,
    });

    await controller.startUpload(fakeFile());
    await vi.advanceTimersByTimeAsync(20);

    expect(controller.getState().phase).toBe('processingFailed');
    controller.dispose();
  });

  it('keeps polling and exposes pollFailure on a transient poll failure, without leaving the processing view', async () => {
    const { gateway, register, getStatus, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: 'processing', revision: 2 })),
    );
    getStatus
      .mockResolvedValueOnce(TRANSPORT_FAILURE)
      .mockResolvedValueOnce(
        ok(baseMedia({ uploadState: 'available', processingState: 'processed', revision: 2 })),
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
      pollIntervalMs: 10,
    });

    await controller.startUpload(fakeFile());
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.getState().phase).toBe('processing');
    expect(controller.getState().pollFailure).toEqual(TRANSPORT_FAILURE);

    await vi.advanceTimersByTimeAsync(10);
    expect(controller.getState().phase).toBe('processed');
    expect(controller.getState().pollFailure).toBeNull();
    controller.dispose();
  });

  it('pauses on an aborted chunk and resumes to completion on retry', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession({ declaredByteSize: 1024 })));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: 'processed', revision: 2 })),
    );

    let callCount = 0;
    const transport = (_request: ResumablePutRequest): Promise<ResumablePutResponse> => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({ status: 308, rangeHeader: null }); // status check
      }
      if (callCount === 2) {
        return Promise.reject(new ResumableUploadAbortedError());
      }
      return Promise.resolve({ status: 201, rangeHeader: null });
    };

    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport,
      store: new FakePendingUploadStore(),
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:00:00Z'),
    });

    await controller.startUpload(fakeFile('plan.jpg', 1024));
    expect(controller.getState().phase).toBe('paused');

    await controller.retry();
    expect(controller.getState().phase).toBe('processed');
    controller.dispose();
  });

  it('reports a retryable uploadFailed on a network error, and completes after retry', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: null, revision: 2 })),
    );

    const { transport: firstTransport } = scriptedTransport([
      { status: 308, rangeHeader: null },
      new Error('network dropped'),
    ]);
    let useFirst = true;
    const secondScript = scriptedTransport([
      { status: 308, rangeHeader: null },
      { status: 201, rangeHeader: null },
    ]);
    const transport = (request: ResumablePutRequest) =>
      useFirst ? firstTransport(request) : secondScript.transport(request);

    const controller = createMediaUploadController({
      gardenId: GARDEN_ID,
      mediaClass: 'garden_photo',
      mediaGateway: gateway,
      transport,
      store: new FakePendingUploadStore(),
      generateIdempotencyKey: () => 'idem-1',
      now: () => new Date('2026-07-21T09:00:00Z'),
    });

    await controller.startUpload(fakeFile());
    expect(controller.getState().phase).toBe('uploadFailed');
    expect(controller.getState().retryable).toBe(true);

    useFirst = false;
    await controller.retry();
    expect(controller.getState().phase).toBe('processing');
    controller.dispose();
  });

  it('re-registers from scratch after a sessionExpired outcome', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete.mockResolvedValue(
      ok(baseMedia({ uploadState: 'available', processingState: null, revision: 2 })),
    );

    const { transport } = scriptedTransport([
      { status: 308, rangeHeader: null },
      { status: 404, rangeHeader: null },
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

    await controller.startUpload(fakeFile());
    expect(controller.getState().phase).toBe('sessionExpired');

    await controller.retry();
    expect(controller.getState().phase).toBe('processing');
    expect(register).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('surfaces a register API failure as apiFailed, and retries successfully', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValueOnce(TRANSPORT_FAILURE).mockResolvedValueOnce(ok(uploadSession()));
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

    await controller.startUpload(fakeFile());
    expect(controller.getState().phase).toBe('apiFailed');
    expect(controller.getState().apiFailure).toEqual(TRANSPORT_FAILURE);

    await controller.retry();
    expect(controller.getState().phase).toBe('processing');
    controller.dispose();
  });

  it('surfaces a complete API failure as apiFailed, and retries the complete call alone', async () => {
    const { gateway, register, complete } = fakeMediaGateway();
    register.mockResolvedValue(ok(uploadSession()));
    complete
      .mockResolvedValueOnce(TRANSPORT_FAILURE)
      .mockResolvedValueOnce(
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

    await controller.startUpload(fakeFile());
    expect(controller.getState().phase).toBe('apiFailed');

    await controller.retry();
    expect(controller.getState().phase).toBe('processing');
    expect(complete).toHaveBeenCalledTimes(2);
    // Only ONE registration ever happened — retrying a failed *complete*
    // must not re-register (that would create a second media record for the
    // same file).
    expect(register).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
