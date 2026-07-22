/**
 * Transport-level error handling.
 *
 * Every failure leaving the service — typed, framework-raised, or entirely
 * unexpected — becomes the same contract error envelope. Nothing else in the
 * service writes an error response.
 *
 * Source: architecture/api-design.md, section "12. Error Contract";
 * architecture/backend-modular-monolith.md, section "14. Error Model".
 */

import type { ErrorDetail } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import {
  ApplicationError,
  DependencyUnavailableError,
  NotFoundError,
  QuotaExceededError,
  RequestTooLargeError,
  ValidationError,
} from './application-error.js';
import { mapCategory, toErrorEnvelope, toUnexpectedErrorEnvelope } from './error-response.js';

/**
 * Code for a request that matched no route.
 *
 * The shared catalogue covers pipeline outcomes that clients must handle for
 * every endpoint; an unknown path is a client programming error rather than a
 * domain outcome, so it carries a transport-owned code.
 */
export const ROUTE_NOT_FOUND_CODE = 'request.route_not_found';

/** Converts AJV output into contract details without echoing free-form prose. */
function toValidationDetails(error: FastifyError): readonly ErrorDetail[] | undefined {
  if (!Array.isArray(error.validation) || error.validation.length === 0) {
    return undefined;
  }

  return error.validation.map((issue) => ({
    code: issue.keyword,
    ...(issue.instancePath === '' ? {} : { pointer: issue.instancePath }),
  }));
}

/**
 * Recognizes failures raised by Fastify itself.
 *
 * Returns `null` when the failure is not a known framework rejection, which
 * means it is unexpected and must not reach the client in any detail.
 */
export function translateFrameworkError(error: FastifyError): ApplicationError | null {
  const details = toValidationDetails(error);

  if (details !== undefined) {
    return new ValidationError(SharedErrorCode.RequestInvalid, 'The request failed validation.', {
      details,
    });
  }

  switch (error.statusCode) {
    case 413:
      return new RequestTooLargeError(
        SharedErrorCode.RequestTooLarge,
        'The request exceeds the permitted size.',
      );
    case 429:
      return new QuotaExceededError(SharedErrorCode.RateLimited, 'Too many requests.');
    case 503:
      // Raised when the instance is under load and rejects work early. The
      // shared catalogue has no separate overload code, and this one carries
      // the retry semantics the client needs.
      return new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        'The service is temporarily unable to accept this request.',
      );
    case 400:
    case 405:
    case 406:
    case 415:
      return new ValidationError(SharedErrorCode.RequestInvalid, 'The request is not acceptable.');
    default:
      return null;
  }
}

/** Registers the error and not-found handlers on the instance. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const applicationError =
      error instanceof ApplicationError ? error : translateFrameworkError(error);

    if (applicationError === null) {
      // The original error is recorded server-side only; the response carries
      // nothing but the correlation identifier needed to find this log line.
      request.log.error({ err: error, event: 'request.unexpected_failure' }, 'Unhandled failure');
      return reply.status(500).send(toUnexpectedErrorEnvelope(request.correlationId));
    }

    const mapping = mapCategory(applicationError.category);

    if (mapping.status >= 500) {
      request.log.error(
        { err: applicationError, event: 'request.dependency_failure', code: applicationError.code },
        'Request failed with a server-side error',
      );
    }

    return reply
      .status(mapping.status)
      .send(toErrorEnvelope(applicationError, request.correlationId));
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new NotFoundError(ROUTE_NOT_FOUND_CODE, 'The requested route does not exist.');

    return reply
      .status(mapCategory(error.category).status)
      .send(toErrorEnvelope(error, request.correlationId));
  });
}
