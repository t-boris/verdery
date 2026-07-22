import { describe, expect, it } from 'vitest';

import {
  buildChangePropertiesCommand,
  buildCreateObjectCommand,
  buildDeleteObjectCommand,
  buildMoveObjectCommand,
  defaultCategoryDetails,
  generateMapId,
} from './commands';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('generateMapId', () => {
  it('produces a UUIDv7, matching the contract Uuid pattern', () => {
    expect(generateMapId()).toMatch(UUID_V7_PATTERN);
  });

  it('produces a different id on every call', () => {
    expect(generateMapId()).not.toBe(generateMapId());
  });
});

describe('defaultCategoryDetails', () => {
  it('gives lot no details, matching its schema having none', () => {
    expect(defaultCategoryDetails('lot')).toBeUndefined();
  });

  it('gives structure and fence a schema-valid "other" kind', () => {
    expect(defaultCategoryDetails('structure')).toEqual({
      category: 'structure',
      details: { structureKind: 'other' },
    });
    expect(defaultCategoryDetails('fence')).toEqual({
      category: 'fence',
      details: { fenceKind: 'other' },
    });
  });

  it('gives plant the required commonName and quantity fields', () => {
    expect(defaultCategoryDetails('plant')).toEqual({
      category: 'plant',
      details: { commonName: '', quantity: 1 },
    });
  });
});

describe('command builders', () => {
  const objectId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

  it('builds a createObject command with the category default details', () => {
    const command = buildCreateObjectCommand(objectId, 'tree', {
      type: 'Point',
      coordinates: [1, 2],
    });

    expect(command).toEqual({
      type: 'createObject',
      objectId,
      category: 'tree',
      geometry: { type: 'Point', coordinates: [1, 2] },
      categoryDetails: { category: 'tree', details: {} },
    });
  });

  it('omits categoryDetails for lot, which has none', () => {
    const command = buildCreateObjectCommand(objectId, 'lot', {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    expect(command.categoryDetails).toBeUndefined();
  });

  it('builds a moveObject command carrying the expected revision and translation', () => {
    expect(buildMoveObjectCommand(objectId, 4, 1.5, -0.5)).toEqual({
      type: 'moveObject',
      objectId,
      expectedRevision: 4,
      translationMetres: { dx: 1.5, dy: -0.5 },
    });
  });

  it('builds a changeProperties command that omits an undefined label', () => {
    const command = buildChangePropertiesCommand(objectId, 2, undefined, {
      category: 'zone',
      details: { zoneKind: 'lawn' },
    });
    expect(command).toEqual({
      type: 'changeProperties',
      objectId,
      expectedRevision: 2,
      categoryDetails: { category: 'zone', details: { zoneKind: 'lawn' } },
    });
    expect('label' in command).toBe(false);
  });

  it('builds a deleteObject command', () => {
    expect(buildDeleteObjectCommand(objectId, 7)).toEqual({
      type: 'deleteObject',
      objectId,
      expectedRevision: 7,
    });
  });
});
