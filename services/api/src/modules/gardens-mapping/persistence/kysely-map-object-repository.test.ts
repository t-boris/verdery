import type { Geometry } from '@verdery/geometry-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { MapObject } from '../domain/map-object.js';
import { KyselyMapObjectRepository } from './kysely-map-object-repository.js';

const OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const COORDINATE_SPACE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

const geometry: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};

function deletedObject(): MapObject {
  const now = new Date('2026-08-07T11:00:00Z');
  return {
    id: OBJECT_ID,
    gardenId: GARDEN_ID,
    coordinateSpaceId: COORDINATE_SPACE_ID,
    category: 'zone',
    geometry,
    label: null,
    provenance: 'manualDrawing',
    confidence: null,
    lifecycleState: 'deleted',
    currentRevision: 2,
    details: { category: 'zone', details: { zoneKind: 'other' } },
    createdByProfileId: PROFILE_ID,
    createdAt: now,
    updatedAt: now,
  };
}

describe('KyselyMapObjectRepository.updateLifecycle', () => {
  it('updates only lifecycle metadata and never rewrites geometry or details', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ numUpdatedRows: 1n });
    const query = { where: vi.fn(), executeTakeFirst };
    query.where.mockReturnValue(query);
    const set = vi.fn(() => query);
    const updateTable = vi.fn(() => ({ set }));
    const repository = new KyselyMapObjectRepository({ updateTable } as never);
    const object = deletedObject();

    await expect(repository.updateLifecycle(object, 1)).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      lifecycle_state: 'deleted',
      current_revision: 2,
      updated_at: object.updatedAt,
    });
    expect(query.where).toHaveBeenNthCalledWith(1, 'id', '=', OBJECT_ID);
    expect(query.where).toHaveBeenNthCalledWith(2, 'garden_id', '=', GARDEN_ID);
    expect(query.where).toHaveBeenNthCalledWith(3, 'current_revision', '=', 1);
  });
});
