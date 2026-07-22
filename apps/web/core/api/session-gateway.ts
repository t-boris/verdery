import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface SessionGateway {
  /** Exchanges a freshly obtained Firebase ID token for a session cookie. No CSRF token exists yet. */
  createSession(idToken: string, signal?: AbortSignal): Promise<ApiResult<void>>;
  /** Idempotent: succeeds even without a valid session, so a broken client state can always be cleared. */
  endSession(signal?: AbortSignal): Promise<ApiResult<void>>;
}

export function createSessionGateway(client: ApiClient): SessionGateway {
  return {
    createSession(idToken, signal) {
      return client.request<void>({
        method: 'POST',
        path: '/auth/session',
        body: { idToken },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    endSession(signal) {
      return client.request<void>({
        method: 'DELETE',
        path: '/auth/session',
        headers: csrfHeader(),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
