import { describe, expect, it } from 'vitest';

import { parseMapViewPreferences } from './use-map-view-persistence';

describe('parseMapViewPreferences', () => {
  it('restores viewport, rotation, backdrop, opacity, and layer states', () => {
    expect(
      parseMapViewPreferences(
        JSON.stringify({
          camera: { centerX: 12, centerY: -4, scale: 48, rotationDegrees: 27 },
          hiddenLayers: [2],
          lockedLayers: [3, 4],
          backgroundOpacity: 0.6,
          backdrop: 'streets',
        }),
      ),
    ).toEqual({
      camera: { centerX: 12, centerY: -4, scale: 48, rotationDegrees: 27 },
      hiddenLayers: [2],
      lockedLayers: [3, 4],
      backgroundOpacity: 0.6,
      backdrop: 'streets',
    });
  });

  it('rejects malformed or unsafe saved state', () => {
    expect(parseMapViewPreferences('not-json')).toBeNull();
    expect(
      parseMapViewPreferences(
        JSON.stringify({
          camera: { centerX: 0, centerY: 0, scale: 0, rotationDegrees: 0 },
          hiddenLayers: [],
          lockedLayers: [99],
          backgroundOpacity: 5,
          backdrop: 'satellite',
        }),
      ),
    ).toBeNull();
  });
});
