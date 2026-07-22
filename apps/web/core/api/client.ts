import { API_BASE_PATH } from '@verdery/api-contracts';

import { CORRELATION_ID_HEADER, createCorrelationId } from './correlation';
import { failureFromResponse, malformedResponseFailure, transportFailure } from './failure';
import type { ApiResult } from './result';

/** The subset of `fetch` the client uses, so tests can supply a double. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Header carrying the Firebase App Check token, when one is available. */
export const APP_CHECK_HEADER_NAME = 'X-Firebase-AppCheck';

export interface ApiClientOptions {
  /** Origin of the API, without the version path and without a trailing slash. */
  readonly origin: string;
  readonly fetchImplementation: FetchLike;
  readonly createCorrelationId?: () => string;
  /**
   * Resolves the current Firebase App Check token, or `null` when one is not
   * available. A rejected promise is treated the same as `null`: App Check
   * is a monitor-only signal for now, so it must never block a request.
   *
   * Source: architecture/identity-and-authorization.md, section
   * "12. App Check".
   */
  readonly getAppCheckToken?: () => Promise<string | null>;
}

export interface RequestSpec {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path below the version prefix, for example `/health/live`. */
  readonly path: string;
  /** JSON-serialized and sent with `Content-Type: application/json`. Omit for a bodyless request. */
  readonly body?: unknown;
  /**
   * Additional request headers — `Idempotency-Key`, `If-Match`, and the CSRF
   * header, for the callers that need them. Never used for the session
   * cookie itself, which the browser attaches automatically.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Statuses that carry the operation's own schema rather than the error
   * envelope. `/health/ready` is the first such case: its `503` response is a
   * readiness report, not a failure to read readiness.
   */
  readonly schemaStatuses?: readonly number[];
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  request<TData>(spec: RequestSpec): Promise<ApiResult<TData>>;
}

const NO_CONTENT = 204;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Transport used by every gateway.
 *
 * It is hand-written on purpose: generated clients are wrapped rather than
 * called directly, so contract-level behaviour such as the error envelope, the
 * correlation header, and the session cookie lives in one reviewed place.
 *
 * Source: architecture/api-design.md, section "3. Contract Ownership";
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const nextCorrelationId = options.createCorrelationId ?? createCorrelationId;

  async function request<TData>(spec: RequestSpec): Promise<ApiResult<TData>> {
    const correlationId = nextCorrelationId();
    const url = `${options.origin}${API_BASE_PATH}${spec.path}`;

    // Never let App Check block a request: a missing provider, a rejected
    // promise, and a `null` resolution are all treated the same way here.
    // Source: architecture/identity-and-authorization.md, section "12. App Check".
    const appCheckToken =
      options.getAppCheckToken === undefined
        ? null
        : await options.getAppCheckToken().catch(() => null);

    let response: Response;

    try {
      response = await options.fetchImplementation(url, {
        method: spec.method,
        headers: {
          accept: 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
          ...(spec.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(appCheckToken === null ? {} : { [APP_CHECK_HEADER_NAME]: appCheckToken }),
          ...spec.headers,
        },
        ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
        // The session is an HTTP-only cookie, so it is never read or attached
        // by application code.
        // Source: architecture/web-application-design.md, section "7. Authentication Session".
        credentials: 'include',
        signal: spec.signal ?? null,
      });
    } catch {
      // The rejection value of `fetch` is a browser-specific object with no
      // contract behind it, so nothing from it is carried into the result.
      return transportFailure(correlationId);
    }

    const carriesSchema = response.ok || (spec.schemaStatuses ?? []).includes(response.status);

    if (!carriesSchema) {
      return failureFromResponse(parseJson(await response.text()), response.status, correlationId);
    }

    if (response.status === NO_CONTENT) {
      return { ok: true, status: response.status, correlationId, data: undefined as TData };
    }

    const body = parseJson(await response.text());

    if (body === undefined) {
      return malformedResponseFailure(response.status, correlationId);
    }

    // Success payloads are trusted to match the contract: OpenAPI validation is
    // enforced on the server, and the generated types are the client's view of
    // that same document.
    // Source: architecture/api-design.md, section "22. Security".
    return { ok: true, status: response.status, correlationId, data: body as TData };
  }

  return { request };
}
