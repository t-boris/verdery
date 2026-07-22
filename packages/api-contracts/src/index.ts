/**
 * Public surface of the API contract package.
 *
 * The OpenAPI document is the source of truth; `src/generated/schema.ts` is
 * derived from it and is never edited by hand. This module re-exports the
 * generated types under stable names and adds the small amount of hand-written
 * material that OpenAPI cannot express, such as the error-code catalogue.
 *
 * Source: architecture/api-design.md, section "3. Contract Ownership".
 */

import type { components, paths } from './generated/schema.js';

export type { components, paths };

export type Schemas = components['schemas'];

export type ApiError = Schemas['Error'];
export type ErrorDetail = Schemas['ErrorDetail'];
export type LivenessResult = Schemas['LivenessResult'];
export type ReadinessResult = Schemas['ReadinessResult'];
export type DependencyStatus = Schemas['DependencyStatus'];
export type GeometryEnvelope = Schemas['GeometryEnvelope'];
export type Geometry = Schemas['Geometry'];
export type Position = Schemas['Position'];
export type CoordinateSpaceKind = Schemas['CoordinateSpaceKind'];
export type ProvenanceKind = Schemas['ProvenanceKind'];
export type CurveMetadata = Schemas['CurveMetadata'];

/** The API base path. Breaking changes require a new major path. */
export const API_BASE_PATH = '/v1';

/** Header carrying the client-generated idempotency key on retryable mutations. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Header carrying the expected revision on revision-sensitive operations. */
export const IF_MATCH_HEADER = 'if-match';

/**
 * Error codes shared across modules.
 *
 * Module-specific codes live with their module. These are the ones the request
 * pipeline itself can produce, so every client must handle them regardless of
 * which endpoint it called.
 */
export const SharedErrorCode = {
  /** The request body or parameters failed contract validation. */
  RequestInvalid: 'request.invalid',
  /** Request or declared upload exceeds the permitted size. */
  RequestTooLarge: 'request.too_large',
  /** An idempotency key was reused with a different command. */
  IdempotencyKeyReused: 'request.idempotency.key_reused',
  /** Authentication credentials are missing or could not be verified. */
  Unauthenticated: 'auth.unauthenticated',
  /** The actor is authenticated but lacks the required capability. */
  Forbidden: 'auth.forbidden',
  /** The supplied revision precondition did not match the current revision. */
  StaleRevision: 'concurrency.stale_revision',
  /** A quota or rate limit was exceeded. */
  RateLimited: 'quota.rate_limited',
  /** An unexpected internal failure occurred. */
  Internal: 'server.internal',
  /** A required dependency is temporarily unavailable. */
  DependencyUnavailable: 'server.dependency_unavailable',
} as const;

export type SharedErrorCode = (typeof SharedErrorCode)[keyof typeof SharedErrorCode];

/** Narrows an unknown response body to the shared error envelope. */
export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }

  const candidate = value.error;

  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'code' in candidate &&
    typeof candidate.code === 'string'
  );
}
