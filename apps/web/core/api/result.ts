import type { ErrorDetail } from '@verdery/api-contracts';

/**
 * Failures the gateway itself produces, in a namespace the server never uses.
 *
 * The contract only defines codes for responses the server managed to send. A
 * browser gateway must also represent a request that never arrived and a
 * response that cannot be interpreted, and it must do so without colliding with
 * a server code.
 *
 * Source: architecture/api-design.md, section "12. Error Envelope".
 */
export const ClientErrorCode = {
  /** The request never produced a response: offline, DNS, TLS, CORS, or abort. */
  TransportFailure: 'client.transport_failure',
  /** A response arrived but did not match the contract for that status. */
  MalformedResponse: 'client.malformed_response',
} as const;

export type ClientErrorCode = (typeof ClientErrorCode)[keyof typeof ClientErrorCode];

export interface ApiSuccess<TData> {
  readonly ok: true;
  readonly status: number;
  readonly correlationId: string;
  readonly data: TData;
}

/** Where a failure came from, which decides whether retrying can help. */
export type ApiFailureKind = 'contract' | 'transport' | 'malformed';

export interface ApiFailure {
  readonly ok: false;
  readonly kind: ApiFailureKind;
  /** Stable code the interface localizes. Never displayed to the user as-is. */
  readonly code: string;
  /** Safe English fallback from the contract. Used only when the code is unknown. */
  readonly fallbackMessage: string;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly details: readonly ErrorDetail[];
  /** HTTP status, or `null` when no response arrived. */
  readonly status: number | null;
}

/**
 * Outcome of one API call.
 *
 * The gateway returns this instead of throwing, so a handled server error and
 * an unexpected rendering defect stay distinguishable: only the second one
 * reaches an error boundary.
 *
 * Source: architecture/web-application-design.md, section "13. Error Boundaries".
 */
export type ApiResult<TData> = ApiSuccess<TData> | ApiFailure;

export function isFailure<TData>(result: ApiResult<TData>): result is ApiFailure {
  return !result.ok;
}
