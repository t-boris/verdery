import { SharedErrorCode } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import type { ErrorCategory } from './application-error.js';
import {
  DependencyUnavailableError,
  StaleRevisionError,
  ValidationError,
} from './application-error.js';
import { mapCategory, toErrorEnvelope, toUnexpectedErrorEnvelope } from './error-response.js';

const CORRELATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

describe('mapCategory', () => {
  // The expected values are the contract's own table, restated here so a change
  // to the mapping cannot pass review unnoticed.
  // Source: architecture/api-design.md, section "13. Status Codes".
  const expectedStatuses: ReadonlyArray<readonly [ErrorCategory, number]> = [
    ['validation', 400],
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['notFound', 404],
    ['conflict', 409],
    ['staleRevision', 412],
    ['requestTooLarge', 413],
    ['domainRuleViolated', 422],
    ['unsupportedCapability', 422],
    ['quotaExceeded', 429],
    ['internal', 500],
    ['dependencyUnavailable', 503],
  ];

  it.each(expectedStatuses)('maps %s to %i', (category, status) => {
    expect(mapCategory(category).status).toBe(status);
  });

  it('marks only temporary failures as retryable', () => {
    expect(mapCategory('dependencyUnavailable').retryable).toBe(true);
    expect(mapCategory('quotaExceeded').retryable).toBe(true);
    expect(mapCategory('validation').retryable).toBe(false);
    expect(mapCategory('staleRevision').retryable).toBe(false);
  });
});

describe('toErrorEnvelope', () => {
  it('produces the contract envelope with the request correlation identifier', () => {
    const error = new StaleRevisionError(
      SharedErrorCode.StaleRevision,
      'The supplied revision is stale.',
    );

    expect(toErrorEnvelope(error, CORRELATION_ID)).toEqual({
      error: {
        code: 'concurrency.stale_revision',
        message: 'The supplied revision is stale.',
        correlationId: CORRELATION_ID,
        retryable: false,
      },
    });
  });

  it('includes structured details and the retry hint of the category', () => {
    const error = new ValidationError(SharedErrorCode.RequestInvalid, 'Invalid request.', {
      details: [{ code: 'required', pointer: '/name' }],
    });

    const envelope = toErrorEnvelope(error, CORRELATION_ID);

    expect(envelope.error.details).toEqual([{ code: 'required', pointer: '/name' }]);
    expect(envelope.error.retryable).toBe(false);
  });

  it('reports a dependency outage as retryable', () => {
    const error = new DependencyUnavailableError(
      SharedErrorCode.DependencyUnavailable,
      'The database is unavailable.',
    );

    expect(toErrorEnvelope(error, CORRELATION_ID).error.retryable).toBe(true);
  });
});

describe('toUnexpectedErrorEnvelope', () => {
  it('exposes nothing but the shared internal code and the correlation identifier', () => {
    expect(toUnexpectedErrorEnvelope(CORRELATION_ID)).toEqual({
      error: {
        code: 'server.internal',
        message: 'An unexpected internal error occurred.',
        correlationId: CORRELATION_ID,
        retryable: false,
      },
    });
  });
});
