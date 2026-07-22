import { isApiError, type ApiError } from '@verdery/api-contracts';

import { ClientErrorCode, type ApiFailure } from './result';

/** Statuses whose failure may succeed on an identical retry when the envelope does not say. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Converts the contract's error envelope into a typed failure.
 *
 * The envelope's `message` is kept only as a fallback: interfaces localize by
 * `code`, because the server never produces final user-facing sentences for
 * ordinary errors.
 *
 * Source: architecture/api-design.md, section "12. Error Envelope";
 * architecture/web-application-design.md, section "15. Localization".
 */
export function failureFromEnvelope(
  envelope: ApiError,
  status: number,
  requestCorrelationId: string,
): ApiFailure {
  const { error } = envelope;

  return {
    ok: false,
    kind: 'contract',
    code: error.code,
    fallbackMessage: error.message,
    correlationId: error.correlationId === '' ? requestCorrelationId : error.correlationId,
    retryable: error.retryable,
    details: error.details ?? [],
    status,
  };
}

/** Failure for a request that produced no response at all. */
export function transportFailure(correlationId: string): ApiFailure {
  return {
    ok: false,
    kind: 'transport',
    code: ClientErrorCode.TransportFailure,
    fallbackMessage: 'The API could not be reached.',
    correlationId,
    // A network failure is by definition unconfirmed, so an identical read may
    // still succeed. Mutations guard against duplicates with an idempotency key.
    retryable: true,
    details: [],
    status: null,
  };
}

/** Failure for a response whose body does not match the contract for its status. */
export function malformedResponseFailure(status: number, correlationId: string): ApiFailure {
  return {
    ok: false,
    kind: 'malformed',
    code: ClientErrorCode.MalformedResponse,
    fallbackMessage: 'The API returned a response that does not match the contract.',
    correlationId,
    retryable: RETRYABLE_STATUSES.has(status),
    details: [],
    status,
  };
}

/**
 * Builds the failure for an unsuccessful response.
 *
 * A body that is not the shared envelope is reported as malformed rather than
 * guessed at, because inventing a code would make an infrastructure error look
 * like a domain error.
 */
export function failureFromResponse(
  body: unknown,
  status: number,
  requestCorrelationId: string,
): ApiFailure {
  return isApiError(body)
    ? failureFromEnvelope(body, status, requestCorrelationId)
    : malformedResponseFailure(status, requestCorrelationId);
}
