import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../platform/errors/application-error.js';
import {
  OWNERSHIP_ADMINISTRATION_RECENT_AUTHENTICATION_MAX_AGE_MS,
  assertRecentAuthenticationForOwnershipAdministration,
  beginOwnershipTransfer,
  cancelOwnershipTransfer,
  completeOwnershipTransfer,
} from './ownership-transfer.js';

const NOW = new Date('2026-03-10T09:00:00Z');

describe('assertRecentAuthenticationForOwnershipAdministration', () => {
  it('accepts a session authenticated exactly at the 30-minute boundary', () => {
    const edge = new Date(
      NOW.getTime() - OWNERSHIP_ADMINISTRATION_RECENT_AUTHENTICATION_MAX_AGE_MS,
    );
    expect(() => assertRecentAuthenticationForOwnershipAdministration(edge, NOW)).not.toThrow();
  });

  it('rejects a session authenticated a moment past the boundary', () => {
    const beyond = new Date(
      NOW.getTime() - OWNERSHIP_ADMINISTRATION_RECENT_AUTHENTICATION_MAX_AGE_MS - 1,
    );
    expect(() => assertRecentAuthenticationForOwnershipAdministration(beyond, NOW)).toThrow(
      ForbiddenError,
    );
  });

  it('rejects with the collaboration-specific code, distinct from deletion or export', () => {
    const beyond = new Date(NOW.getTime() - 60 * 60 * 1000);
    try {
      assertRecentAuthenticationForOwnershipAdministration(beyond, NOW);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'collaboration.membership.recent_authentication_required',
      });
    }
  });
});

describe('beginOwnershipTransfer / completeOwnershipTransfer / cancelOwnershipTransfer', () => {
  const BASE = {
    id: 'transfer-1',
    gardenId: 'garden-1',
    fromProfileId: 'from-1',
    toProfileId: 'to-1',
    fromResultingRole: 'editor' as const,
    authenticatedAt: new Date('2026-03-10T08:55:00Z'),
    now: NOW,
  };

  it('opens a transfer as pending, with no completion or cancellation instant', () => {
    const transfer = beginOwnershipTransfer(BASE);

    expect(transfer.state).toBe('pending');
    expect(transfer.requestedAt).toEqual(NOW);
    expect(transfer.completedAt).toBeNull();
    expect(transfer.cancelledAt).toBeNull();
    expect(transfer.cancellationReason).toBeNull();
  });

  it('completes a pending transfer, stamping completedAt and leaving every other field untouched', () => {
    const transfer = beginOwnershipTransfer(BASE);
    const later = new Date(NOW.getTime() + 1000);

    const completed = completeOwnershipTransfer(transfer, later);

    expect(completed).toEqual({ ...transfer, state: 'completed', completedAt: later });
  });

  it('cancels a pending transfer, stamping cancelledAt and an optional reason', () => {
    const transfer = beginOwnershipTransfer(BASE);
    const later = new Date(NOW.getTime() + 1000);

    const cancelled = cancelOwnershipTransfer(transfer, later, 'changed their mind');

    expect(cancelled).toEqual({
      ...transfer,
      state: 'cancelled',
      cancelledAt: later,
      cancellationReason: 'changed their mind',
    });
  });
});
