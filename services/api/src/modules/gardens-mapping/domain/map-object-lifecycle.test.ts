import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { MapObject } from './map-object.js';
import { transitionMapObjectLifecycle } from './map-object-lifecycle.js';

const NOW = new Date('2026-07-21T12:00:00Z');

function activeObject(): MapObject {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
    gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
    coordinateSpaceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
    category: 'bed',
    geometry: { type: 'Point', coordinates: [0, 0] },
    label: null,
    provenance: 'manualDrawing',
    confidence: null,
    lifecycleState: 'active',
    currentRevision: 3,
    details: undefined,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('transitionMapObjectLifecycle', () => {
  it('deletes an active object, bumping the revision and lifecycle state', () => {
    const result = transitionMapObjectLifecycle(activeObject(), 'deleted', NOW);
    expect(result.lifecycleState).toBe('deleted');
    expect(result.currentRevision).toBe(4);
    expect(result.updatedAt).toBe(NOW);
  });

  it('rejects deleting an already-deleted object', () => {
    const deleted = { ...activeObject(), lifecycleState: 'deleted' as const };
    expect(() => transitionMapObjectLifecycle(deleted, 'deleted', NOW)).toThrow(
      DomainRuleViolatedError,
    );
  });

  it('restores a deleted object', () => {
    const deleted = { ...activeObject(), lifecycleState: 'deleted' as const };
    const result = transitionMapObjectLifecycle(deleted, 'active', NOW);
    expect(result.lifecycleState).toBe('active');
    expect(result.currentRevision).toBe(4);
  });

  it('rejects restoring an already-active object', () => {
    expect(() => transitionMapObjectLifecycle(activeObject(), 'active', NOW)).toThrow(
      DomainRuleViolatedError,
    );
  });
});
