'use client';

import type { MediaClass } from '@verdery/api-contracts';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createBrowserApiClient,
  createMediaGateway,
  generateIdempotencyKey,
} from '@/core/api/public';

import { createXhrResumableTransport } from './gcs-resumable-transport';
import {
  createIndexedDbPendingUploadStore,
  isPendingUploadStoreAvailable,
} from './indexed-db-pending-upload-store';
import { createMediaUploadController, type MediaUploadState } from './media-upload-controller';

export interface UseMediaUploadResult extends MediaUploadState {
  readonly startUpload: (file: File) => void;
  readonly pause: () => void;
  readonly resumeRecovered: () => void;
  readonly discardRecovered: () => void;
  readonly retry: () => void;
  readonly cancel: () => void;
}

/**
 * React adapter over `media-upload-controller.ts`. One controller instance
 * per (`gardenId`, `mediaClass`) pairing, created lazily and disposed on
 * unmount; `useSyncExternalStore` mirrors the controller's own state into
 * React renders, the same pattern `core/connectivity/network-status.ts`
 * already uses for `onlineManager` — this hook owns no state of its own.
 *
 * On mount, checks for a resumable upload left behind by an earlier session
 * (a pause, a crash, or an ordinary reload) — see
 * `media-upload-controller.ts`'s `checkForRecoverableUpload`. Finding one
 * never starts network activity by itself; the caller decides, through
 * `resumeRecovered`/`discardRecovered`.
 *
 * Source: architecture/web-application-design.md, section "12. Media
 * Upload"; implementation-plan.md work package P6-WEB-01.
 */
export function useMediaUpload(gardenId: string, mediaClass: MediaClass): UseMediaUploadResult {
  const controller = useMemo(
    () =>
      createMediaUploadController({
        gardenId,
        mediaClass,
        mediaGateway: createMediaGateway(createBrowserApiClient()),
        transport: createXhrResumableTransport(),
        // `null` under server rendering or when the browser disables
        // `indexedDB` (some private-browsing modes) — resumability across a
        // reload is then simply unavailable, never a crash.
        store: isPendingUploadStoreAvailable() ? createIndexedDbPendingUploadStore() : null,
        generateIdempotencyKey,
        now: () => new Date(),
      }),
    [gardenId, mediaClass],
  );

  useEffect(() => {
    void controller.checkForRecoverableUpload();
    return () => controller.dispose();
  }, [controller]);

  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );

  return {
    ...state,
    startUpload: (file) => void controller.startUpload(file),
    pause: () => controller.pause(),
    resumeRecovered: () => void controller.resumeRecovered(),
    discardRecovered: () => void controller.discardRecovered(),
    retry: () => void controller.retry(),
    cancel: () => void controller.cancel(),
  };
}
