import { describe, expect, it } from 'vitest';

import {
  imageryMagnificationAt,
  maxCameraScaleFor,
  metresPerPixelForZoom,
  openFreeMapProvider,
  usgsNaipImageryProvider,
  zoomForMetresPerPixel,
  type Georeference,
} from './basemap-provider';

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

describe('usgsNaipImageryProvider', () => {
  // The projection belongs to the garden's georeference, not to whoever draws
  // the tiles, so switching backdrop must not move a single traced point.
  it('projects a point identically to the street provider', () => {
    const local: [number, number] = [17, -23];

    expect(usgsNaipImageryProvider.localToGeographic(local, GEOREFERENCE)).toEqual(
      openFreeMapProvider.localToGeographic(local, GEOREFERENCE),
    );
    expect(usgsNaipImageryProvider.geographicToLocal([-122.418, 37.776], GEOREFERENCE)).toEqual(
      openFreeMapProvider.geographicToLocal([-122.418, 37.776], GEOREFERENCE),
    );
  });

  it('is a raster source, since the imagery is rendered on demand rather than served as a style', () => {
    expect(usgsNaipImageryProvider.source.kind).toBe('rasterTiles');
  });

  // `exportImage` renders whatever bounds it is given, which is the reason
  // this service is usable at all: the National Map's cached tiles stop at
  // zoom 16, far too coarse for a garden.
  it('asks for each tile by its own bounds, in Web Mercator', () => {
    const source = usgsNaipImageryProvider.source;
    if (source.kind !== 'rasterTiles') {
      throw new Error('expected a raster source');
    }

    const template = source.tiles[0] ?? '';
    expect(template).toContain('{bbox-epsg-3857}');
    expect(template).toContain('bboxSR=3857');
    expect(template).toContain('imageSR=3857');
    expect(template).toContain(`size=${String(source.tileSize)},${String(source.tileSize)}`);
    expect(template).toContain('f=image');
  });

  it('stops requesting detail the imagery does not hold', () => {
    const source = usgsNaipImageryProvider.source;
    if (source.kind !== 'rasterTiles') {
      throw new Error('expected a raster source');
    }

    /*
     * The service reports `pixelSizeX` 0.30 m (`?f=json`, read 2026-08-05).
     * A 256-pixel tile reaches exactly that at zoom 19; past it the server
     * returns the same ground enlarged in hard blocks, at four times the
     * requests, where the renderer's own filtering is both smoother and free.
     */
    expect(source.maxZoom).toBe(19);
    expect(usgsNaipImageryProvider.nativeMetresPerPixel).toBe(0.3);
  });

  it('needs no key, which is half the reason this provider was chosen', () => {
    const source = usgsNaipImageryProvider.source;
    if (source.kind !== 'rasterTiles') {
      throw new Error('expected a raster source');
    }

    expect(source.tiles.join(' ')).not.toMatch(/key=|token=|apikey/iu);
  });

  it('credits USGS, which is the condition of using it', () => {
    expect(usgsNaipImageryProvider.attributionHtml).toContain('USGS');
  });
});

describe('what each provider can actually draw', () => {
  /*
   * Measured in a visible browser on 2026-08-05, against both MapLibre 5.6
   * and the 6.0 this app ships: the street style renders 110 features at zoom
   * 16, six at 19, and nothing at 20 — six levels past its zoom-14 source is
   * where a vector tile's integer geometry stops resolving. The editor opens
   * at about zoom 21, which is why the street backdrop was always blank.
   */
  it('stops the street style below the zoom a garden is drawn at', () => {
    expect(openFreeMapProvider.maxRenderableZoom).toBe(19);
    expect(zoomForMetresPerPixel(1 / 24, 41.59)).toBeGreaterThan(
      openFreeMapProvider.maxRenderableZoom,
    );
  });

  it('lets imagery run to MapLibre’s own ceiling, because pixels only enlarge', () => {
    expect(usgsNaipImageryProvider.maxRenderableZoom).toBe(22);
  });

  it('round-trips zoom and ground resolution', () => {
    const metresPerPixel = metresPerPixelForZoom(19, 41.59);
    expect(zoomForMetresPerPixel(metresPerPixel, 41.59)).toBeCloseTo(19, 9);
  });

  // Past this scale MapLibre clamps its own zoom while the Konva camera keeps
  // going, and the two drift apart — the reason the camera is clamped at all.
  it('caps the camera at the scale the backdrop can still follow', () => {
    const streetsCap = maxCameraScaleFor(openFreeMapProvider, 41.59);
    const imageryCap = maxCameraScaleFor(usgsNaipImageryProvider, 41.59);

    expect(streetsCap).toBeCloseTo(4.5, 1);
    expect(imageryCap).toBeCloseTo(35.8, 1);
    expect(imageryCap).toBeGreaterThan(streetsCap);
  });

  it('reports how far a photograph is being enlarged, and only for photographs', () => {
    // 24 px/m over 0.30 m ground pixels: each one covers about seven.
    expect(imageryMagnificationAt(usgsNaipImageryProvider, 24)).toBeCloseTo(7.2, 1);
    expect(imageryMagnificationAt(openFreeMapProvider, 24)).toBeNull();
  });
});
