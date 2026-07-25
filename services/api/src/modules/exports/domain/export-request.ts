/**
 * The export request: identity, scope, requester session context, state
 * machine, consistency boundary, and package facts for one asynchronous
 * data export (P8-EXPORT-01).
 *
 * Mirrors `exports.export_request` exactly, the `media-record.ts` posture.
 * The request IS the durable export job (architecture/data-export-and-
 * deletion.md section 5's field list — see the migration's own header for
 * the column-by-column mapping and for why no `media.processing_job` row
 * exists for this family):
 *
 * ```text
 * requested ──beginExportGeneration──▶ running ──completeExportRequest──▶ completed
 *     │                                  │  ▲
 *     │                                  │  └── beginExportGeneration (a
 *     │                                  │      retried attempt re-begins;
 *     │                                  │      attemptCount counts them)
 *     │                                  └────failExportRequest──▶ failed
 *     └────failExportRequest──▶ failed
 * ```
 *
 * `completed` and `failed` are terminal. A failed export never exposes a
 * partial object (section 16): `outputChecksumSha256`/`expiresAt` are only
 * ever written by the completed transition, and the package media record
 * is registered in the same transaction.
 */

import { ExportErrorCode, EXPORT_FORMAT_VERSION, SharedErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type ExportScope = 'account' | 'garden';

export type ExportRequestState = 'requested' | 'running' | 'completed' | 'failed';

/**
 * How recent the session's underlying sign-in must be for an ACCOUNT-wide
 * export (section 5: "Recent authentication is required for account-wide
 * export"). No document names a figure, so this is a reasoned default in
 * the established "pick one and say so" posture: 30 minutes matches the
 * common step-up-authentication window for sensitive account operations —
 * long enough that a user who just signed in to request their data is
 * never bounced, short enough that a stolen long-lived session cannot
 * quietly package the whole account.
 */
export const RECENT_AUTHENTICATION_MAX_AGE_MS = 30 * 60 * 1000;

export interface ExportRequest {
  readonly id: Uuid;
  readonly requesterProfileId: Uuid;
  readonly scope: ExportScope;
  /** Set exactly when `scope` is `garden` — the migration's `export_request_scope_garden_check`. */
  readonly gardenId: Uuid | null;
  readonly includeMedia: boolean;
  readonly formatVersion: string;
  readonly state: ExportRequestState;
  /** The requesting session's credential kind — section 5's "authenticated session context". */
  readonly sessionCredentialKind: string;
  /** The requesting session's `auth_time` — what the recent-authentication gate evaluated. */
  readonly sessionAuthenticatedAt: Date;
  /** The recorded consistency boundary (section 7) — null until a snapshot has been taken AND checkpointed. */
  readonly boundaryAt: Date | null;
  /** Generation attempts begun (`beginExportGeneration` calls) — the honest visibility into retries. */
  readonly attemptCount: number;
  /** Pre-minted at request time — see the migration's header for why the package object key must embed this id before the media record can exist. */
  readonly outputMediaId: Uuid;
  readonly packageBucketName: string;
  readonly packageObjectKey: string;
  readonly outputChecksumSha256: string | null;
  readonly failureCode: string | null;
  /** The package's 7-day retention deadline, set at completion; null before. */
  readonly expiresAt: Date | null;
  readonly completedAt: Date | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Throws unless the account-wide requirement holds — evaluated against the session's `auth_time`, never a client-supplied instant. */
export function assertRecentAuthenticationForAccountExport(
  sessionAuthenticatedAt: Date,
  now: Date,
): void {
  if (now.getTime() - sessionAuthenticatedAt.getTime() > RECENT_AUTHENTICATION_MAX_AGE_MS) {
    throw new ForbiddenError(
      ExportErrorCode.RecentAuthenticationRequired,
      'Account-wide export requires a recent sign-in. Sign in again and retry.',
    );
  }
}

/** Mirrors the migration's `export_request_scope_garden_check` one level up — the clean-ValidationError-before-CHECK precedent. */
function validateScopeGardenPairing(scope: ExportScope, gardenId: Uuid | null): void {
  if ((scope === 'garden') === (gardenId !== null)) {
    return;
  }
  throw new ValidationError(
    SharedErrorCode.RequestInvalid,
    scope === 'garden' ? "scope 'garden' requires gardenId." : "gardenId requires scope 'garden'.",
    { details: [{ code: 'export.request.scope_garden_pairing', pointer: '/gardenId' }] },
  );
}

export interface CreateExportRequestInput {
  readonly id: Uuid;
  readonly requesterProfileId: Uuid;
  readonly scope: ExportScope;
  readonly gardenId: Uuid | null;
  readonly includeMedia: boolean;
  readonly sessionCredentialKind: string;
  readonly sessionAuthenticatedAt: Date;
  readonly outputMediaId: Uuid;
  readonly packageBucketName: string;
  readonly packageObjectKey: string;
}

/** The `requested` entry point — section 5's recorded request. */
export function createExportRequest(input: CreateExportRequestInput, now: Date): ExportRequest {
  validateScopeGardenPairing(input.scope, input.gardenId);

  return {
    id: input.id,
    requesterProfileId: input.requesterProfileId,
    scope: input.scope,
    gardenId: input.gardenId,
    includeMedia: input.includeMedia,
    formatVersion: EXPORT_FORMAT_VERSION,
    state: 'requested',
    sessionCredentialKind: input.sessionCredentialKind,
    sessionAuthenticatedAt: input.sessionAuthenticatedAt,
    boundaryAt: null,
    attemptCount: 0,
    outputMediaId: input.outputMediaId,
    packageBucketName: input.packageBucketName,
    packageObjectKey: input.packageObjectKey,
    outputChecksumSha256: null,
    failureCode: null,
    expiresAt: null,
    completedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function requireState(
  request: ExportRequest,
  expected: readonly ExportRequestState[],
  action: string,
): void {
  if (!expected.includes(request.state)) {
    throw new DomainRuleViolatedError(
      'export.request.state_conflict',
      `${action} requires export request '${request.id}' to be in one of [${expected.join(', ')}], but it is '${request.state}'.`,
    );
  }
}

/**
 * `requested`/`running` -> `running`, counting the attempt. Accepting
 * `running` as a source is the retry edge: a redelivered generation task
 * re-begins against a request a crashed attempt left running, resuming
 * from recorded checkpoints rather than restarting.
 */
export function beginExportGeneration(request: ExportRequest, now: Date): ExportRequest {
  requireState(request, ['requested', 'running'], 'beginExportGeneration');

  return {
    ...request,
    state: 'running',
    attemptCount: request.attemptCount + 1,
    revision: request.revision + 1,
    updatedAt: now,
  };
}

/**
 * Records the snapshot's boundary once its sections are durably staged —
 * called by the checkpoint write, in the same transaction as the
 * checkpoint rows, so a recorded boundary always has the staged set it
 * describes. Idempotent by construction upstream (a checkpointed request
 * never re-reads its snapshot).
 */
export function recordExportBoundary(
  request: ExportRequest,
  boundaryAt: Date,
  now: Date,
): ExportRequest {
  requireState(request, ['running'], 'recordExportBoundary');

  return { ...request, boundaryAt, revision: request.revision + 1, updatedAt: now };
}

export interface CompleteExportRequestInput {
  readonly outputChecksumSha256: string;
  /** The package media record's own retention deadline — one instant, one rule, both rows. */
  readonly expiresAt: Date;
}

/** `running` -> `completed`. Written in the same transaction as the `export_package` media-record registration and the `export.completed` outbox event. */
export function completeExportRequest(
  request: ExportRequest,
  input: CompleteExportRequestInput,
  now: Date,
): ExportRequest {
  requireState(request, ['running'], 'completeExportRequest');

  return {
    ...request,
    state: 'completed',
    outputChecksumSha256: input.outputChecksumSha256,
    expiresAt: input.expiresAt,
    completedAt: now,
    revision: request.revision + 1,
    updatedAt: now,
  };
}

/** `requested`/`running` -> `failed` with a stable machine reason. */
export function failExportRequest(
  request: ExportRequest,
  failureCode: string,
  now: Date,
): ExportRequest {
  requireState(request, ['requested', 'running'], 'failExportRequest');

  return {
    ...request,
    state: 'failed',
    failureCode,
    revision: request.revision + 1,
    updatedAt: now,
  };
}

/** `true` once the request has reached a state with no outgoing edge. */
export function isExportRequestTerminal(request: ExportRequest): boolean {
  return request.state === 'completed' || request.state === 'failed';
}
