import type {
  Media,
  MediaAccess,
  MediaClass,
  MediaListResult,
  MediaUploadSession,
  RegisterMediaUploadRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

/**
 * Gateway for the four Media endpoints (P6-API-01).
 *
 * Every method here talks to `services/api` only — registration, completion
 * verification, status polling, and short-lived access. The actual file
 * bytes never travel through this gateway or through `ApiClient`: the
 * browser uploads directly to the resumable session URI `register` returns,
 * a real Cloud Storage endpoint, using `features/media`'s own resumable
 * upload driver (`resumable-upload-driver.ts`). Matches this codebase's
 * "binary media bypasses the interactive API data path" rule (architecture
 * doc section 2) applied to the client side of the same rule.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Media`;
 * architecture/web-application-design.md, section "8. API Access", "12. Media Upload".
 */
export interface MediaGateway {
  /** `RegisterMediaUpload` — creates the media record and opens its upload session in one call. */
  register(
    gardenId: string,
    input: RegisterMediaUploadRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<MediaUploadSession>>;
  /** `GetMediaStatus` — reads the record's current upload/processing state. Used for polling after completion. */
  getStatus(gardenId: string, mediaId: string, signal?: AbortSignal): Promise<ApiResult<Media>>;
  /**
   * `CompleteMediaUpload` — idempotent: safe to call again after a network
   * failure without risking a duplicate verification attempt.
   */
  complete(
    gardenId: string,
    mediaId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Media>>;
  /** `GetMediaAccess` — a short-lived signed download URL. Originals require `available` + `processed`; a derivative id (from `Media.derivatives`) is servable at `available` alone. */
  getAccess(
    gardenId: string,
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<MediaAccess>>;
  /** `ListGardenMedia` (P6-PLAN-01) — a garden's original media records, most recent first, optionally one class. */
  list(
    gardenId: string,
    options?: {
      mediaClass?: MediaClass;
      /** Restrict to originals with these exact bytes — the duplicate check a client runs on a photo it just hashed. */
      checksumSha256?: string;
      /** Restrict to originals whose pixels look like this record's — the near-duplicate check, which catches a re-encoded or resized copy the checksum cannot. */
      similarToMediaId?: string;
      cursor?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<ApiResult<MediaListResult>>;
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

export function createMediaGateway(client: ApiClient): MediaGateway {
  return {
    register(gardenId, input, idempotencyKey, signal) {
      return client.request<MediaUploadSession>({
        method: 'POST',
        path: `/gardens/${gardenId}/media`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getStatus(gardenId, mediaId, signal) {
      return client.request<Media>({
        method: 'GET',
        path: `/gardens/${gardenId}/media/${mediaId}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    complete(gardenId, mediaId, expectedRevision, idempotencyKey, signal) {
      return client.request<Media>({
        method: 'POST',
        path: `/gardens/${gardenId}/media/${mediaId}/complete`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getAccess(gardenId, mediaId, signal) {
      return client.request<MediaAccess>({
        method: 'GET',
        path: `/gardens/${gardenId}/media/${mediaId}/access`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    list(gardenId, options, signal) {
      const query = new URLSearchParams();
      if (options?.mediaClass !== undefined) {
        query.set('mediaClass', options.mediaClass);
      }
      if (options?.checksumSha256 !== undefined) {
        query.set('checksumSha256', options.checksumSha256);
      }
      if (options?.similarToMediaId !== undefined) {
        query.set('similarToMediaId', options.similarToMediaId);
      }
      if (options?.cursor !== undefined) {
        query.set('cursor', options.cursor);
      }
      if (options?.limit !== undefined) {
        query.set('limit', String(options.limit));
      }
      const queryString = query.toString();
      return client.request<MediaListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/media${queryString === '' ? '' : `?${queryString}`}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
