/**
 * Mapping from application error categories to the HTTP contract.
 *
 * This is the only place where a domain concept becomes a status code, so the
 * table can be compared against the contract during review.
 *
 * Source: architecture/api-design.md, section "13. Status Codes";
 * architecture/backend-modular-monolith.md, section "14. Error Model".
 */

import type { ApiError } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import type { ApplicationError, ErrorCategory } from './application-error.js';

export interface TransportMapping {
  readonly status: number;
  /** Whether repeating the identical request may succeed later. */
  readonly retryable: boolean;
}

/**
 * `unsupportedCapability` maps to 422 because the contract defines no dedicated
 * status for it and the request is structurally valid but rejected by a rule.
 */
const CATEGORY_MAPPING: Readonly<Record<ErrorCategory, TransportMapping>> = {
  validation: { status: 400, retryable: false },
  unauthenticated: { status: 401, retryable: false },
  forbidden: { status: 403, retryable: false },
  notFound: { status: 404, retryable: false },
  conflict: { status: 409, retryable: false },
  staleRevision: { status: 412, retryable: false },
  requestTooLarge: { status: 413, retryable: false },
  domainRuleViolated: { status: 422, retryable: false },
  unsupportedCapability: { status: 422, retryable: false },
  quotaExceeded: { status: 429, retryable: true },
  internal: { status: 500, retryable: false },
  dependencyUnavailable: { status: 503, retryable: true },
};

/** Returns the status code and retry semantics for a category. */
export function mapCategory(category: ErrorCategory): TransportMapping {
  return CATEGORY_MAPPING[category];
}

/** Builds the contract error envelope for a typed application error. */
export function toErrorEnvelope(error: ApplicationError, correlationId: string): ApiError {
  const mapping = mapCategory(error.category);

  return {
    error: {
      code: error.code,
      message: error.message,
      correlationId,
      retryable: mapping.retryable,
      ...(error.details === undefined ? {} : { details: [...error.details] }),
    },
  };
}

/**
 * Envelope for a failure that was not raised as a typed application error.
 *
 * The client learns only that the request failed and which correlation
 * identifier to quote. Internal exception messages are never sent.
 *
 * Source: architecture/backend-modular-monolith.md, section "14. Error Model".
 */
export function toUnexpectedErrorEnvelope(correlationId: string): ApiError {
  return {
    error: {
      code: SharedErrorCode.Internal,
      message: 'An unexpected internal error occurred.',
      correlationId,
      retryable: false,
    },
  };
}
