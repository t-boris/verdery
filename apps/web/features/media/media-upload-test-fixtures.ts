/**
 * Shared fakes/fixtures for `media-upload-controller.test.ts` and
 * `media-upload-controller.recovery.test.ts` — split out only because the
 * combined test suite exceeded this repository's 600-line source-file
 * limit (`scripts/check-file-size.mjs`), not a separate concern. Not itself
 * a `*.test.ts` file, so Vitest's own `include` glob does not pick it up.
 */
import type { Media, MediaUploadSession } from '@verdery/api-contracts';
import { vi } from 'vitest';

import type { ApiFailure, ApiResult, MediaGateway } from '@/core/api/public';

import type { ResumablePutRequest, ResumablePutResponse } from './gcs-resumable-transport';
import type { PendingUploadRecord, PendingUploadStore } from './pending-upload-store';

export const GARDEN_ID = 'garden-1';
export const MEDIA_ID = 'media-1';

export function ok<TData>(data: TData): ApiResult<TData> {
  return { ok: true, status: 200, correlationId: 'corr-1', data };
}

export const TRANSPORT_FAILURE: ApiFailure = {
  ok: false,
  kind: 'transport',
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: 'corr-1',
  retryable: true,
  details: [],
  status: null,
};

export function baseMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: MEDIA_ID,
    gardenId: GARDEN_ID,
    uploadedByProfileId: 'profile-1',
    mediaClass: 'garden_photo',
    displayFilename: 'backyard.jpg',
    declaredContentType: 'image/jpeg',
    verifiedContentType: null,
    declaredByteSize: 1024,
    verifiedByteSize: null,
    checksumSha256: null,
    uploadState: 'authorized',
    processingState: null,
    sensitivityClassification: 'standard',
    revision: 1,
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
    ...overrides,
  };
}

export function uploadSession(overrides: Partial<Media> = {}): MediaUploadSession {
  return {
    media: baseMedia(overrides),
    uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadId=abc',
    uploadUrlExpiresAt: '2026-07-21T10:00:00Z',
  };
}

export function fakeFile(name = 'backyard.jpg', size = 1024, type = 'image/jpeg'): File {
  return new File([new Uint8Array(size)], name, { type });
}

export function fakeMediaGateway(): {
  gateway: MediaGateway;
  register: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
} {
  const register = vi.fn();
  const getStatus = vi.fn();
  const complete = vi.fn();
  const getAccess = vi.fn();
  const list = vi.fn();
  return {
    register,
    getStatus,
    complete,
    gateway: { register, getStatus, complete, getAccess, list },
  };
}

export class FakePendingUploadStore implements PendingUploadStore {
  readonly records = new Map<string, PendingUploadRecord>();

  put(record: PendingUploadRecord): Promise<void> {
    this.records.set(record.mediaId, record);
    return Promise.resolve();
  }

  get(mediaId: string): Promise<PendingUploadRecord | null> {
    return Promise.resolve(this.records.get(mediaId) ?? null);
  }

  updateOffset(mediaId: string, confirmedOffsetBytes: number): Promise<void> {
    const existing = this.records.get(mediaId);
    if (existing !== undefined) {
      this.records.set(mediaId, { ...existing, confirmedOffsetBytes });
    }
    return Promise.resolve();
  }

  delete(mediaId: string): Promise<void> {
    this.records.delete(mediaId);
    return Promise.resolve();
  }

  listByGarden(gardenId: string): Promise<readonly PendingUploadRecord[]> {
    return Promise.resolve(
      [...this.records.values()].filter((record) => record.gardenId === gardenId),
    );
  }
}

/** Scripted `ResumableTransport`: each call consumes the next scripted outcome. */
export function scriptedTransport(outcomes: readonly (ResumablePutResponse | Error)[]): {
  transport: (request: ResumablePutRequest) => Promise<ResumablePutResponse>;
  calls: ResumablePutRequest[];
} {
  const calls: ResumablePutRequest[] = [];
  let index = 0;
  return {
    calls,
    transport: (request) => {
      calls.push(request);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)] ?? {
        status: 500,
        rangeHeader: null,
      };
      index += 1;
      if (request.body !== null) {
        request.onProgress?.(request.body.size);
      }
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
}
