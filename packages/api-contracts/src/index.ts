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
export type Garden = Schemas['Garden'];
export type GardenRole = Schemas['GardenRole'];
export type GardenLifecycleState = Schemas['GardenLifecycleState'];
export type GardenListResult = Schemas['GardenListResult'];
export type CreateGardenRequest = Schemas['CreateGardenRequest'];
export type RenameGardenRequest = Schemas['RenameGardenRequest'];

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

/**
 * Error codes the gardens-mapping module raises.
 *
 * Distinct from the generic `SharedErrorCode.StaleRevision` and would-be
 * generic "not found": a module-specific dotted code lets a client localize
 * "this garden was renamed by someone else" differently from an unrelated
 * concurrency conflict elsewhere in the product, matching the worked example
 * in the `Error` schema description (`garden.geometry.stale_revision`).
 */
export const GardenErrorCode = {
  /** No garden exists at this ID, or the caller has no membership on it. */
  NotFound: 'garden.not_found',
  /** The supplied `If-Match` revision no longer matches the stored garden. */
  StaleRevision: 'garden.stale_revision',
  /** The command does not apply to the garden's current lifecycle state. */
  LifecycleConflict: 'garden.lifecycle_conflict',
} as const;

export type GardenErrorCode = (typeof GardenErrorCode)[keyof typeof GardenErrorCode];

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
