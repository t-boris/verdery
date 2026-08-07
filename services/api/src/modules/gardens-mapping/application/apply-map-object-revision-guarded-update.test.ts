import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import { describe, expect, it, vi } from 'vitest';

import type { MapObject } from '../domain/map-object.js';
import { applyMapObjectRevisionGuardedUpdate } from './apply-map-object-revision-guarded-update.js';

const LOCKED_OBJECT: MapObject = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  coordinateSpaceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
  category: 'tree',
  geometry: { type: 'Point', coordinates: [0, 0] },
  label: null,
  provenance: 'manualDrawing',
  confidence: null,
  isHidden: false,
  isLocked: true,
  lifecycleState: 'active',
  currentRevision: 2,
  details: undefined,
  createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  createdAt: new Date('2026-08-07T12:00:00.000Z'),
  updatedAt: new Date('2026-08-07T12:00:00.000Z'),
};

function repository() {
  return {
    findByIdWithDetails: vi.fn().mockResolvedValue(LOCKED_OBJECT),
    update: vi.fn().mockResolvedValue(true),
  };
}

describe('applyMapObjectRevisionGuardedUpdate object lock', () => {
  it('rejects content edits to an individually locked object', async () => {
    const mapObjects = repository();

    await expect(
      applyMapObjectRevisionGuardedUpdate(
        mapObjects as never,
        LOCKED_OBJECT.gardenId,
        LOCKED_OBJECT.id,
        LOCKED_OBJECT.currentRevision,
        (object) => ({ ...object, label: 'Changed' }),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    expect(mapObjects.update).not.toHaveBeenCalled();
  });

  it('allows the presentation-only path to unlock the object', async () => {
    const mapObjects = repository();
    const unlocked = await applyMapObjectRevisionGuardedUpdate(
      mapObjects as never,
      LOCKED_OBJECT.gardenId,
      LOCKED_OBJECT.id,
      LOCKED_OBJECT.currentRevision,
      (object) => ({ ...object, isLocked: false, currentRevision: 3 }),
      { allowLocked: true },
    );

    expect(unlocked.isLocked).toBe(false);
    expect(mapObjects.update).toHaveBeenCalledOnce();
  });
});
