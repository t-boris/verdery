import { describe, expect, it } from 'vitest';

import { openFreeMapProvider, zoomForMetresPerPixel, type Georeference } from './basemap-provider';

const GEOREFERENCE: Georeference = {
  localAnchor: [0, 0],
  geographicAnchor: [-122.4194, 37.7749], // San Francisco
  rotationDegrees: 0,
  scaleCorrection: 1,
};

describe('openFreeMapProvider transform', () => {
  it('maps the local anchor exactly to the geographic anchor', () => {
    const geo = openFreeMapProvider.localToGeographic([0, 0], GEOREFERENCE);
    expect(geo[0]).toBeCloseTo(GEOREFERENCE.geographicAnchor[0]);
    expect(geo[1]).toBeCloseTo(GEOREFERENCE.geographicAnchor[1]);
  });

  it('round-trips an arbitrary local point with no rotation', () => {
    const local: readonly [number, number] = [12.5, -8.2];
    const geo = openFreeMapProvider.localToGeographic(local, GEOREFERENCE);
    const roundTripped = openFreeMapProvider.geographicToLocal(geo, GEOREFERENCE);
    expect(roundTripped[0]).toBeCloseTo(local[0], 6);
    expect(roundTripped[1]).toBeCloseTo(local[1], 6);
  });

  it('round-trips with rotation and scale correction applied', () => {
    const rotated: Georeference = { ...GEOREFERENCE, rotationDegrees: 37, scaleCorrection: 1.02 };
    const local: readonly [number, number] = [40, 15];
    const geo = openFreeMapProvider.localToGeographic(local, rotated);
    const roundTripped = openFreeMapProvider.geographicToLocal(geo, rotated);
    expect(roundTripped[0]).toBeCloseTo(local[0], 6);
    expect(roundTripped[1]).toBeCloseTo(local[1], 6);
  });

  it('moves north for increasing local Y (right-handed, Y-north local space)', () => {
    const north = openFreeMapProvider.localToGeographic([0, 10], GEOREFERENCE);
    expect(north[1]).toBeGreaterThan(GEOREFERENCE.geographicAnchor[1]);
  });

  it('includes required OpenStreetMap and OpenMapTiles attribution', () => {
    expect(openFreeMapProvider.attributionHtml).toContain('OpenStreetMap');
    expect(openFreeMapProvider.attributionHtml).toContain('OpenMapTiles');
  });
});

describe('zoomForMetresPerPixel', () => {
  it('increases zoom as metres-per-pixel decreases (zooming in)', () => {
    const farZoom = zoomForMetresPerPixel(50, 0);
    const closeZoom = zoomForMetresPerPixel(0.5, 0);
    expect(closeZoom).toBeGreaterThan(farZoom);
  });
});
