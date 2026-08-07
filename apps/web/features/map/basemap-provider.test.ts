import { describe, expect, it } from 'vitest';

import {
  basemapViewForLocalCamera,
  imageryMagnificationAt,
  maxCameraScaleFor,
  metresPerPixelForZoom,
  osmStreetMapProvider,
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

describe('osmStreetMapProvider transform', () => {
  it('maps the local anchor exactly to the geographic anchor', () => {
    const geo = osmStreetMapProvider.localToGeographic([0, 0], GEOREFERENCE);
    expect(geo[0]).toBeCloseTo(GEOREFERENCE.geographicAnchor[0]);
    expect(geo[1]).toBeCloseTo(GEOREFERENCE.geographicAnchor[1]);
  });

  it('round-trips an arbitrary local point with no rotation', () => {
    const local: readonly [number, number] = [12.5, -8.2];
    const geo = osmStreetMapProvider.localToGeographic(local, GEOREFERENCE);
    const roundTripped = osmStreetMapProvider.geographicToLocal(geo, GEOREFERENCE);
    expect(roundTripped[0]).toBeCloseTo(local[0], 6);
    expect(roundTripped[1]).toBeCloseTo(local[1], 6);
  });

  it('round-trips with rotation and scale correction applied', () => {
    const rotated: Georeference = { ...GEOREFERENCE, rotationDegrees: 37, scaleCorrection: 1.02 };
    const local: readonly [number, number] = [40, 15];
    const geo = osmStreetMapProvider.localToGeographic(local, rotated);
    const roundTripped = osmStreetMapProvider.geographicToLocal(geo, rotated);
    expect(roundTripped[0]).toBeCloseTo(local[0], 6);
    expect(roundTripped[1]).toBeCloseTo(local[1], 6);
  });

  it('moves north for increasing local Y (right-handed, Y-north local space)', () => {
    const north = osmStreetMapProvider.localToGeographic([0, 10], GEOREFERENCE);
    expect(north[1]).toBeGreaterThan(GEOREFERENCE.geographicAnchor[1]);
  });

  it('includes required OpenStreetMap attribution', () => {
    expect(osmStreetMapProvider.attributionHtml).toContain('OpenStreetMap');
  });
});

describe('zoomForMetresPerPixel', () => {
  it('increases zoom as metres-per-pixel decreases (zooming in)', () => {
    const farZoom = zoomForMetresPerPixel(50, 0);
    const closeZoom = zoomForMetresPerPixel(0.5, 0);
    expect(closeZoom).toBeGreaterThan(farZoom);
  });

  it('uses MapLibre camera scale rather than the 256-pixel tile convention', () => {
    expect(zoomForMetresPerPixel(78_271.516_96, 0)).toBeCloseTo(0, 9);
  });
});

describe('basemapViewForLocalCamera', () => {
  it('applies rotation and scale correction to the same view as the drawing', () => {
    const view = basemapViewForLocalCamera(
      osmStreetMapProvider,
      { ...GEOREFERENCE, rotationDegrees: 60, scaleCorrection: 1.02 },
      { centerX: 12, centerY: -8, scale: 20, rotationDegrees: 15 },
    );

    expect(view.center).toEqual(
      osmStreetMapProvider.localToGeographic([12, -8], {
        ...GEOREFERENCE,
        rotationDegrees: 60,
        scaleCorrection: 1.02,
      }),
    );
    expect(view.bearing).toBe(-75);
    expect(view.zoom).toBeCloseTo(zoomForMetresPerPixel(1.02 / 20, view.center[1]), 9);
  });
});

describe('usgsNaipImageryProvider', () => {
  // The projection belongs to the garden's georeference, not to whoever draws
  // the tiles, so switching backdrop must not move a single traced point.
  it('projects a point identically to the street provider', () => {
    const local: [number, number] = [17, -23];

    expect(usgsNaipImageryProvider.localToGeographic(local, GEOREFERENCE)).toEqual(
      osmStreetMapProvider.localToGeographic(local, GEOREFERENCE),
    );
    expect(usgsNaipImageryProvider.geographicToLocal([-122.418, 37.776], GEOREFERENCE)).toEqual(
      osmStreetMapProvider.geographicToLocal([-122.418, 37.776], GEOREFERENCE),
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
   * The previous vector style disappeared at the editor's garden-scale zoom.
   * Raster z19 tiles remain visible when MapLibre enlarges them through z22.
   */
  it('keeps the street raster visible at the zoom a garden is drawn at', () => {
    expect(osmStreetMapProvider.maxRenderableZoom).toBe(22);
    expect(zoomForMetresPerPixel(1 / 24, 41.59)).toBeLessThan(
      osmStreetMapProvider.maxRenderableZoom,
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
    const streetsCap = maxCameraScaleFor(osmStreetMapProvider, 41.59);
    const imageryCap = maxCameraScaleFor(usgsNaipImageryProvider, 41.59);

    expect(streetsCap).toBeCloseTo(71.6, 1);
    expect(imageryCap).toBeCloseTo(71.6, 1);
    expect(imageryCap).toBeCloseTo(streetsCap, 9);
  });

  it('reports how far a photograph is being enlarged, and only for photographs', () => {
    // 24 px/m over 0.30 m ground pixels: each one covers about seven.
    expect(imageryMagnificationAt(usgsNaipImageryProvider, 24)).toBeCloseTo(7.2, 1);
    expect(imageryMagnificationAt(osmStreetMapProvider, 24)).toBeNull();
  });
});
