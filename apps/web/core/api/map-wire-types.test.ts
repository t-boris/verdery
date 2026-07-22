import type {
  ChangePropertiesPayload,
  CreateObjectPayload,
  MoveObjectPayload,
} from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import {
  fromWireCategoryDetails,
  toWireCommandPayload,
  type WireCategoryDetails,
} from './map-wire-types';

describe('toWireCommandPayload', () => {
  it('flattens createObject.categoryDetails to the shape the live request parser requires', () => {
    const command: CreateObjectPayload = {
      type: 'createObject',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
      category: 'plant',
      geometry: { type: 'Point', coordinates: [0, 0] },
      categoryDetails: {
        category: 'plant',
        details: { commonName: 'Tomato', quantity: 3, spacingMetres: 0.4 },
      },
    };

    expect(toWireCommandPayload(command)).toEqual({
      ...command,
      categoryDetails: { category: 'plant', commonName: 'Tomato', quantity: 3, spacingMetres: 0.4 },
    });
  });

  it('leaves createObject unchanged when it carries no categoryDetails (lot has none)', () => {
    const command: CreateObjectPayload = {
      type: 'createObject',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
      category: 'lot',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    };

    expect(toWireCommandPayload(command)).toEqual(command);
  });

  it('flattens changeProperties.categoryDetails the same way', () => {
    const command: ChangePropertiesPayload = {
      type: 'changeProperties',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
      expectedRevision: 4,
      categoryDetails: { category: 'zone', details: { zoneKind: 'lawn' } },
    };

    expect(toWireCommandPayload(command)).toEqual({
      ...command,
      categoryDetails: { category: 'zone', zoneKind: 'lawn' },
    });
  });

  it('passes through command types with no categoryDetails field unchanged', () => {
    const command: MoveObjectPayload = {
      type: 'moveObject',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
      expectedRevision: 1,
      translationMetres: { dx: 1, dy: 1 },
    };

    expect(toWireCommandPayload(command)).toBe(command);
  });
});

describe('fromWireCategoryDetails', () => {
  it('un-flattens a flat wire response into the nested domain shape', () => {
    const wire: WireCategoryDetails = {
      category: 'plant',
      commonName: 'Tomato',
      quantity: 3,
      spacingMetres: 0.4,
    };

    expect(fromWireCategoryDetails(wire)).toEqual({
      category: 'plant',
      details: { commonName: 'Tomato', quantity: 3, spacingMetres: 0.4 },
    });
  });

  it('round-trips through toWireCommandPayload and back to the original nested shape', () => {
    const original = {
      category: 'zone' as const,
      details: { zoneKind: 'lawn' as const },
    };
    const command: ChangePropertiesPayload = {
      type: 'changeProperties',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
      expectedRevision: 4,
      categoryDetails: original,
    };

    const wire = toWireCommandPayload(command) as { categoryDetails: WireCategoryDetails };

    expect(fromWireCategoryDetails(wire.categoryDetails)).toEqual(original);
  });
});
