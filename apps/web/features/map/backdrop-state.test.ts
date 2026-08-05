import { describe, expect, it } from 'vitest';

import type { WireGeoreference } from '@/core/api/public';

import { backdropStateFor, initialScaleOverBackdrop, scaleWithinBackdrop } from './backdrop-state';

const GEOREFERENCE: WireGeoreference = {
  localAnchor: [0, 0],
  geographicAnchor: [-93.63, 41.59], // Des Moines, Iowa
  rotationDegrees: 0,
  scaleCorrection: 1,
  provenance: 'manualDrawing',
  method: 'mapPin',
  revision: 1,
};

describe('backdropStateFor', () => {
  it('draws nothing without an anchor to place it against', () => {
    const state = backdropStateFor('imagery', undefined, 24);

    expect(state.visible).toBe(false);
    expect(state.maxCameraScale).toBeNull();
  });

  it('draws nothing when the person asked for nothing', () => {
    const state = backdropStateFor('none', GEOREFERENCE, 24);

    expect(state.visible).toBe(false);
    expect(state.provider).toBeNull();
  });

  /*
   * The reported defect. A garden is drawn at about 24 px/m; the street style
   * stops resolving at roughly 4.5 px/m at this latitude, so choosing it used
   * to paint an empty cream field with no explanation.
   */
  it('knows the street style cannot draw at the scale a garden is drawn at', () => {
    const state = backdropStateFor('streets', GEOREFERENCE, 24);

    expect(state.visible).toBe(true);
    expect(state.beyondProviderDetail).toBe(true);
    expect(state.showsPhotograph).toBe(false);
  });

  it('accepts the street style when the camera is pulled back to it', () => {
    const state = backdropStateFor('streets', GEOREFERENCE, 4);

    expect(state.beyondProviderDetail).toBe(false);
  });

  it('reports how far the imagery is enlarged at the editor’s own default scale', () => {
    const state = backdropStateFor('imagery', GEOREFERENCE, 24);

    expect(state.showsPhotograph).toBe(true);
    expect(state.beyondProviderDetail).toBe(false);
    expect(state.magnification).toBeCloseTo(7.2, 1);
  });

  // Past the cap MapLibre stops following while Konva keeps scaling, so the
  // magnification is reported for the camera actually rendered, not the one
  // requested.
  it('reports magnification at the clamped camera, not beyond it', () => {
    const clamped = backdropStateFor('imagery', GEOREFERENCE, 400);
    const atCap = backdropStateFor('imagery', GEOREFERENCE, 35.8);

    expect(clamped.magnification).toBeCloseTo(atCap.magnification ?? 0, 1);
  });
});

describe('scaleWithinBackdrop', () => {
  it('leaves the camera alone when no backdrop is drawn', () => {
    const none = backdropStateFor('none', GEOREFERENCE, 400);

    expect(scaleWithinBackdrop(400, none)).toBe(400);
  });

  it('holds the camera at the largest scale imagery still follows', () => {
    const imagery = backdropStateFor('imagery', GEOREFERENCE, 24);

    expect(scaleWithinBackdrop(400, imagery)).toBeCloseTo(35.8, 1);
    expect(scaleWithinBackdrop(20, imagery)).toBe(20);
  });
});

describe('initialScaleOverBackdrop', () => {
  /*
   * The editor's default of 24 px/m asks each 0.30 m ground pixel to cover
   * seven screen pixels — a lot traced over mush, which is what "снимок
   * неточный" looked like. Opening at the notice threshold shows ground a
   * person can read; going closer stays available, and says so.
   */
  it('opens a photograph no closer than the point it would need apologising for', () => {
    const imagery = backdropStateFor('imagery', GEOREFERENCE, 24);

    expect(initialScaleOverBackdrop(24, imagery)).toBeCloseTo(13.3, 1);
  });

  it('leaves an already-comfortable scale alone', () => {
    const imagery = backdropStateFor('imagery', GEOREFERENCE, 8);

    expect(initialScaleOverBackdrop(8, imagery)).toBe(8);
  });

  it('does not touch a garden with no photograph behind it', () => {
    expect(initialScaleOverBackdrop(24, backdropStateFor('none', GEOREFERENCE, 24))).toBe(24);
    expect(initialScaleOverBackdrop(24, backdropStateFor('streets', GEOREFERENCE, 24))).toBe(24);
  });
});
