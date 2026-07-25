/**
 * Pure domain tests for the export request's state machine, scope
 * pairing, and the account-wide recent-authentication gate (P8-EXPORT-01).
 */

import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import {
  assertRecentAuthenticationForAccountExport,
  beginExportGeneration,
  completeExportRequest,
  createExportRequest,
  failExportRequest,
  isExportRequestTerminal,
  RECENT_AUTHENTICATION_MAX_AGE_MS,
  recordExportBoundary,
  type CreateExportRequestInput,
} from './export-request.js';

const NOW = new Date('2026-07-25T09:00:00Z');
const LATER = new Date('2026-07-25T09:05:00Z');

function input(overrides: Partial<CreateExportRequestInput> = {}): CreateExportRequestInput {
  return {
    id: '01890000-0000-7000-8000-000000000001',
    requesterProfileId: '01890000-0000-7000-8000-000000000002',
    scope: 'account',
    gardenId: null,
    includeMedia: true,
    sessionCredentialKind: 'sessionCookie',
    sessionAuthenticatedAt: NOW,
    outputMediaId: '01890000-0000-7000-8000-000000000003',
    packageBucketName: 'test-exports',
    packageObjectKey: 'ab/output-media/object',
    ...overrides,
  };
}

describe('createExportRequest', () => {
  it('starts at requested with no boundary, no expiry, and attempt count zero', () => {
    const request = createExportRequest(input(), NOW);

    expect(request.state).toBe('requested');
    expect(request.boundaryAt).toBeNull();
    expect(request.expiresAt).toBeNull();
    expect(request.attemptCount).toBe(0);
    expect(request.revision).toBe(1);
    expect(isExportRequestTerminal(request)).toBe(false);
  });

  it('rejects a garden scope without a gardenId, and a gardenId without garden scope', () => {
    expect(() => createExportRequest(input({ scope: 'garden', gardenId: null }), NOW)).toThrow(
      ValidationError,
    );
    expect(() =>
      createExportRequest(
        input({ scope: 'account', gardenId: '01890000-0000-7000-8000-000000000009' }),
        NOW,
      ),
    ).toThrow(ValidationError);
  });
});

describe('assertRecentAuthenticationForAccountExport', () => {
  it('accepts a sign-in exactly at the window edge and rejects one beyond it', () => {
    const edge = new Date(NOW.getTime() - RECENT_AUTHENTICATION_MAX_AGE_MS);
    expect(() => assertRecentAuthenticationForAccountExport(edge, NOW)).not.toThrow();

    const beyond = new Date(edge.getTime() - 1);
    expect(() => assertRecentAuthenticationForAccountExport(beyond, NOW)).toThrow(ForbiddenError);
  });
});

describe('the generation state machine', () => {
  it('requested -> running counts the attempt; a re-begin on running counts again (the retry edge)', () => {
    const requested = createExportRequest(input(), NOW);
    const first = beginExportGeneration(requested, NOW);
    expect(first.state).toBe('running');
    expect(first.attemptCount).toBe(1);

    const second = beginExportGeneration(first, LATER);
    expect(second.state).toBe('running');
    expect(second.attemptCount).toBe(2);
  });

  it('records the boundary only while running', () => {
    const requested = createExportRequest(input(), NOW);
    expect(() => recordExportBoundary(requested, NOW, NOW)).toThrow(DomainRuleViolatedError);

    const running = beginExportGeneration(requested, NOW);
    const bounded = recordExportBoundary(running, NOW, LATER);
    expect(bounded.boundaryAt).toEqual(NOW);
  });

  it('completes only from running, stamping checksum, expiry, and completion time', () => {
    const running = beginExportGeneration(createExportRequest(input(), NOW), NOW);
    const expiresAt = new Date('2026-08-01T09:00:00Z');
    const completed = completeExportRequest(
      running,
      { outputChecksumSha256: 'a'.repeat(64), expiresAt },
      LATER,
    );

    expect(completed.state).toBe('completed');
    expect(completed.outputChecksumSha256).toBe('a'.repeat(64));
    expect(completed.expiresAt).toEqual(expiresAt);
    expect(completed.completedAt).toEqual(LATER);
    expect(isExportRequestTerminal(completed)).toBe(true);

    expect(() =>
      completeExportRequest(completed, { outputChecksumSha256: 'b'.repeat(64), expiresAt }, LATER),
    ).toThrow(DomainRuleViolatedError);
  });

  it('fails from requested or running with a machine reason; terminal states refuse further transitions', () => {
    const requested = createExportRequest(input(), NOW);
    const failed = failExportRequest(requested, 'staged_section_corrupt', NOW);
    expect(failed.state).toBe('failed');
    expect(failed.failureCode).toBe('staged_section_corrupt');
    expect(isExportRequestTerminal(failed)).toBe(true);

    expect(() => beginExportGeneration(failed, NOW)).toThrow(DomainRuleViolatedError);
    expect(() => failExportRequest(failed, 'again', NOW)).toThrow(DomainRuleViolatedError);
  });
});
