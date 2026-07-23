import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SyncPushOperationResult } from '@verdery/api-contracts';
import { countSyncPushOutcomes } from './sync-push-outcome-counts.js';

function result(outcome: SyncPushOperationResult['outcome']): SyncPushOperationResult {
  const operationId = randomUUID();
  switch (outcome) {
    case 'accepted':
    case 'duplicate':
      return { outcome, operationId, recordRevisions: [] };
    case 'rejected':
      return { outcome, operationId, error: { code: 'x', message: 'x' } };
    case 'conflict':
      return {
        outcome,
        operationId,
        conflictCode: 'x',
        currentRecord: { recordType: 'garden', data: {} as never },
      };
    case 'blockedByDependency':
      return { outcome, operationId, blockingOperationIds: [] };
    case 'retryLater':
      return { outcome, operationId };
  }
}

describe('countSyncPushOutcomes', () => {
  it('returns every count at zero for an empty batch', () => {
    expect(countSyncPushOutcomes([])).toEqual({
      accepted: 0,
      duplicate: 0,
      rejected: 0,
      conflict: 0,
      blockedByDependency: 0,
      retryLater: 0,
    });
  });

  it('tallies each outcome independently, one increment per result', () => {
    const results: SyncPushOperationResult[] = [
      result('accepted'),
      result('accepted'),
      result('duplicate'),
      result('rejected'),
      result('rejected'),
      result('rejected'),
      result('conflict'),
      result('blockedByDependency'),
      result('retryLater'),
    ];

    expect(countSyncPushOutcomes(results)).toEqual({
      accepted: 2,
      duplicate: 1,
      rejected: 3,
      conflict: 1,
      blockedByDependency: 1,
      retryLater: 1,
    });
  });
});
