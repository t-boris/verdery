/**
 * Typed application errors.
 *
 * Errors are raised as stable categories by domain and application code. The
 * transport layer alone decides HTTP status codes, so a use case stays usable
 * from a worker or a job where HTTP has no meaning.
 *
 * Source: architecture/backend-modular-monolith.md, section "14. Error Model".
 */

import type { ErrorDetail } from '@verdery/api-contracts';

/**
 * Stable error categories.
 *
 * Source: architecture/backend-modular-monolith.md, section "14. Error Model".
 */
export type ErrorCategory =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'staleRevision'
  | 'requestTooLarge'
  | 'domainRuleViolated'
  | 'quotaExceeded'
  | 'unsupportedCapability'
  | 'dependencyUnavailable'
  | 'internal';

export interface ApplicationErrorOptions {
  /**
   * Structured details describing which member of the request was rejected.
   * Never free-form prose: clients localize by code.
   */
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
}

/**
 * Base class for every error the API converts into the contract error envelope.
 *
 * `message` is safe fallback text in English. It is not a localization source
 * and must not contain internal diagnostics.
 *
 * Source: architecture/api-design.md, section "12. Error Contract".
 */
export abstract class ApplicationError extends Error {
  abstract readonly category: ErrorCategory;

  /** Stable dotted code from the shared catalogue or the raising module. */
  readonly code: string;

  readonly details: readonly ErrorDetail[] | undefined;

  constructor(code: string, message: string, options: ApplicationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
  }
}

/** The request violated the contract or a documented input rule. */
export class ValidationError extends ApplicationError {
  readonly category = 'validation' as const;
}

/** Credentials are missing or could not be verified. */
export class UnauthenticatedError extends ApplicationError {
  readonly category = 'unauthenticated' as const;
}

/** The actor is authenticated but lacks the required capability. */
export class ForbiddenError extends ApplicationError {
  readonly category = 'forbidden' as const;
}

/**
 * The resource does not exist, or its existence is deliberately concealed from
 * an actor who is not allowed to learn about it.
 */
export class NotFoundError extends ApplicationError {
  readonly category = 'notFound' as const;
}

/** The command conflicts with current domain or synchronization state. */
export class ConflictError extends ApplicationError {
  readonly category = 'conflict' as const;
}

/** An explicit revision precondition did not match the stored revision. */
export class StaleRevisionError extends ApplicationError {
  readonly category = 'staleRevision' as const;
}

/** The request or its declared upload exceeds the permitted size. */
export class RequestTooLargeError extends ApplicationError {
  readonly category = 'requestTooLarge' as const;
}

/** The request is structurally valid but violates a domain rule. */
export class DomainRuleViolatedError extends ApplicationError {
  readonly category = 'domainRuleViolated' as const;
}

/** A quota or rate limit was exceeded. */
export class QuotaExceededError extends ApplicationError {
  readonly category = 'quotaExceeded' as const;
}

/** The requested capability is not supported for this actor, plan, or resource. */
export class UnsupportedCapabilityError extends ApplicationError {
  readonly category = 'unsupportedCapability' as const;
}

/** A required dependency is temporarily unavailable; retrying may succeed. */
export class DependencyUnavailableError extends ApplicationError {
  readonly category = 'dependencyUnavailable' as const;
}

/** An unexpected failure. Its message is never sent to a client. */
export class InternalError extends ApplicationError {
  readonly category = 'internal' as const;
}
