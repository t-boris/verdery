/**
 * Map-provider adapter: everything MapLibre needs to know about the tile
 * source, plus the local-metres ⟷ geographic (WGS84) transform derived from
 * a garden's `Georeference`.
 *
 * This is deliberately a plain interface, not a MapLibre-specific type —
 * `map-basemap.tsx` is the only file that imports `maplibre-gl`. A future
 * provider (a different tile host, or a different rendering library
 * entirely) implements this same interface and nothing else in the map
 * feature changes.
 *
 * Provider tiles never become authoritative garden geometry: the transform
 * here is advisory context for rendering, never written back into an
 * object's `geometryEnvelope`.
 *
 * Source: architecture/map-rendering-and-editing.md, section
 * "15. Provider Independence"; section "3.2 Geographic Space".
 */

import type { Position } from '@verdery/geometry-contracts';

export interface Georeference {
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
}

export interface BasemapProvider {
  readonly name: string;
  /** MapLibre style JSON URL. */
  readonly styleUrl: string;
  /**
   * Required attribution, as HTML. Sourced from https://openfreemap.org's
   * quick-start guide (fetched July 2026): "[OpenFreeMap](https://openfreemap.org)
   * [© OpenMapTiles](https://www.openmaptiles.org/) Data from
   * [OpenStreetMap](https://www.openstreetmap.org/copyright)". OpenFreeMap's
   * own page notes displaying the "OpenFreeMap" credit is optional ("nice if
   * you do") but OpenMapTiles and OpenStreetMap attribution is required; this
   * adapter includes all three rather than relying on that distinction being
   * remembered correctly later.
   */
  readonly attributionHtml: string;
  localToGeographic(local: Position, georeference: Georeference): Position;
  geographicToLocal(geo: Position, georeference: Georeference): Position;
}

const METRES_PER_DEGREE_LATITUDE = 111_320;
const DEGREES_TO_RADIANS = Math.PI / 180;

function metresPerDegreeLongitude(latitudeDegrees: number): number {
  return METRES_PER_DEGREE_LATITUDE * Math.cos(latitudeDegrees * DEGREES_TO_RADIANS);
}

function rotate(x: number, y: number, degrees: number): readonly [number, number] {
  const radians = degrees * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos - y * sin, x * sin + y * cos];
}

/**
 * OpenFreeMap (https://openfreemap.org): a free, open, no-API-key vector tile
 * provider serving OpenMapTiles-schema tiles built from OpenStreetMap data.
 * Chosen as the default provider per this work package's brief.
 */
export const openFreeMapProvider: BasemapProvider = {
  name: 'OpenFreeMap',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  attributionHtml:
    '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
    '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',

  /**
   * Local metres → [longitude, latitude]. An equirectangular approximation
   * around the geographic anchor — adequate for an optional, advisory
   * basemap context over a garden-sized area (tens to low hundreds of
   * metres), not a survey-grade projection. `scaleCorrection` and
   * `rotationDegrees` come from calibration against the anchor, per
   * `Georeference`'s own contract.
   */
  localToGeographic(local, georeference) {
    const dx = (local[0] - georeference.localAnchor[0]) * georeference.scaleCorrection;
    const dy = (local[1] - georeference.localAnchor[1]) * georeference.scaleCorrection;
    const [eastMetres, northMetres] = rotate(dx, dy, georeference.rotationDegrees);

    const [anchorLongitude, anchorLatitude] = georeference.geographicAnchor;
    const longitude = anchorLongitude + eastMetres / metresPerDegreeLongitude(anchorLatitude);
    const latitude = anchorLatitude + northMetres / METRES_PER_DEGREE_LATITUDE;
    return [longitude, latitude];
  },

  geographicToLocal(geo, georeference) {
    const [anchorLongitude, anchorLatitude] = georeference.geographicAnchor;
    const eastMetres = (geo[0] - anchorLongitude) * metresPerDegreeLongitude(anchorLatitude);
    const northMetres = (geo[1] - anchorLatitude) * METRES_PER_DEGREE_LATITUDE;

    const [dx, dy] = rotate(eastMetres, northMetres, -georeference.rotationDegrees);
    return [
      georeference.localAnchor[0] + dx / georeference.scaleCorrection,
      georeference.localAnchor[1] + dy / georeference.scaleCorrection,
    ];
  },
};

/** Standard Web Mercator tile math, used to keep MapLibre's zoom in step with the local camera's scale. */
export function zoomForMetresPerPixel(metresPerPixel: number, latitudeDegrees: number): number {
  const metresPerPixelAtEquatorZoomZero = 156_543.033_92;
  const latitudeCorrection = Math.cos(latitudeDegrees * DEGREES_TO_RADIANS);
  return Math.log2((metresPerPixelAtEquatorZoomZero * latitudeCorrection) / metresPerPixel);
}
