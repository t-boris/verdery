import { SharedErrorCode } from '@verdery/api-contracts';

import type { ApiClient, RequestSpec } from './client';
import type { ApiResult } from './result';

/**
 * What a client does when the session cookie it sent is no longer accepted.
 *
 * Kept as an interface so this decorator stays free of Firebase: the browser
 * wiring in `config.ts` supplies the real implementation, and tests supply a
 * double.
 */
export interface SessionRecovery {
  /**
   * Attempts to mint a fresh session cookie from the identity provider's own
   * credentials. Resolves `true` when the caller may replay its request.
   */
  recover(): Promise<boolean>;
  /**
   * Called once when no session can be recovered: the person is signed out in
   * fact, whatever the cookie jar still holds, and must be told so. May be
   * asynchronous — clearing the stale cookie before navigating is part of the
   * job.
   */
  abandon(): Promise<void> | void;
}

/**
 * Replays one request after refreshing an expired session.
 *
 * WHY REPLAYING IS SAFE, INCLUDING FOR MUTATIONS. A `401` means the API
 * rejected the request before executing anything: no command ran, no revision
 * moved, no row changed. Replaying it cannot double-apply an effect that was
 * never applied. This is a different situation from retrying after a timeout,
 * which is why the `Idempotency-Key` machinery exists and why this decorator
 * does not need to reason about it.
 *
 * WHY THE RECOVERY IS SHARED. A single expired cookie fails every query on
 * the screen at once. Without deduplication each one would mint its own
 * session, so concurrent failures await one in-flight recovery and then each
 * replays its own request.
 *
 * Only `auth.unauthenticated` is recovered. An authorization failure
 * (`403`-shaped) means the session is valid and the capability is not;
 * refreshing a token cannot change that, and treating it as a session problem
 * would sign people out for opening a garden they may not edit.
 *
 * Source: architecture/web-application-design.md, section
 * "7. Authentication Session"; architecture/identity-and-authorization.md,
 * section "9. Session Lifecycle".
 */
export function withSessionRecovery(client: ApiClient, recovery: SessionRecovery): ApiClient {
  let inFlight: Promise<boolean> | null = null;

  function recoverOnce(): Promise<boolean> {
    inFlight ??= recovery.recover().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  return {
    async request<TData>(spec: RequestSpec): Promise<ApiResult<TData>> {
      const result = await client.request<TData>(spec);

      if (result.ok || result.code !== SharedErrorCode.Unauthenticated) {
        return result;
      }

      const recovered = await recoverOnce();

      if (!recovered) {
        await recovery.abandon();
        return result;
      }

      // One replay only. A second `auth.unauthenticated` after a fresh
      // session is a real answer — the caller is not allowed to be here —
      // and looping on it would hide that behind a stall.
      const replayed = await client.request<TData>(spec);

      if (!replayed.ok && replayed.code === SharedErrorCode.Unauthenticated) {
        await recovery.abandon();
      }

      return replayed;
    },
  };
}
