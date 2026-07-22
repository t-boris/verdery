import { describe, expect, it } from 'vitest';

import type { WireGardenObject } from '@/core/api/public';

import { toMapObjectRecord, toObjectSnapshot } from './object-mapper';

const WIRE_STRUCTURE: WireGardenObject = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  category: 'structure',
  geometryEnvelope: {
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    },
    coordinateSpaceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
    coordinateSpaceKind: 'localPlanarMetres',
    provenance: 'manualDrawing',
  },
  label: 'Shed',
  // Flat on the wire, matching openapi.yaml — see map-wire-types.ts's
  // module doc comment for the confirmed request/response contract.
  details: { category: 'structure', structureKind: 'shed' },
  lifecycleState: 'active',
  revision: 3,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:05:00Z',
};

describe('toMapObjectRecord', () => {
  it('flattens the geometry envelope and un-flattens category details into the nested domain shape', () => {
    const record = toMapObjectRecord(WIRE_STRUCTURE);

    expect(record).toEqual({
      id: WIRE_STRUCTURE.id,
      gardenId: WIRE_STRUCTURE.gardenId,
      category: 'structure',
      geometry: WIRE_STRUCTURE.geometryEnvelope.geometry,
      label: 'Shed',
      categoryDetails: { category: 'structure', details: { structureKind: 'shed' } },
      lifecycleState: 'active',
      revision: 3,
      createdAt: '2026-07-21T09:00:00Z',
      updatedAt: '2026-07-21T09:05:00Z',
    });
  });

  it('omits label and categoryDetails when the wire object omits them', () => {
    const { label: _label, details: _details, ...withoutOptional } = WIRE_STRUCTURE;
    const record = toMapObjectRecord(withoutOptional);

    expect(record.label).toBeUndefined();
    expect(record.categoryDetails).toBeUndefined();
  });
});

describe('toObjectSnapshot', () => {
  it('carries every field `deriveInverseCommand` needs', () => {
    const record = toMapObjectRecord(WIRE_STRUCTURE);
    const snapshot = toObjectSnapshot(record);

    expect(snapshot).toEqual({
      objectId: WIRE_STRUCTURE.id,
      category: 'structure',
      geometry: WIRE_STRUCTURE.geometryEnvelope.geometry,
      label: 'Shed',
      categoryDetails: { category: 'structure', details: { structureKind: 'shed' } },
      lifecycleState: 'active',
    });
  });
});
