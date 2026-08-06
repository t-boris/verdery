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

import {
  geographicToLocalMetres,
  localMetresToGeographic,
  type Position,
} from '@verdery/geometry-contracts';

export { geographicToLocalMetres, localMetresToGeographic };

export interface Georeference {
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
}

/**
 * What a provider serves, in terms no rendering library owns.
 *
 * A vector provider hands over a style document by URL; a raster one hands
 * over a tile-URL template. `map-basemap.tsx` is the only file that knows how
 * to turn either into a MapLibre style, which is what keeps this interface
 * free of that library.
 */
export type BasemapSource =
  | { readonly kind: 'vectorStyle'; readonly styleUrl: string }
  | {
      readonly kind: 'rasterTiles';
      /** Tile URL templates. `{bbox-epsg-3857}` and `{z}/{x}/{y}` are both understood by the renderer. */
      readonly tiles: readonly string[];
      readonly tileSize: number;
      /** Beyond this the source is upsampled rather than refetched — a limit of the imagery, not of the map. */
      readonly maxZoom: number;
    };

export interface BasemapProvider {
  readonly name: string;
  readonly source: BasemapSource;
  /**
   * The largest map zoom at which this provider still draws anything.
   *
   * Not a preference — a measurement. A vector style stops resolving roughly
   * six levels past its own source zoom, because a tile's geometry is stored
   * in integer tile units and overzooming runs them out of range: the street
   * style below renders 110 features at zoom 16, six at 19, and nothing at 20,
   * identically on MapLibre 5.6 and 6.0 (measured 2026-08-05). Raster imagery
   * has no such limit — its pixels simply enlarge — and stops at MapLibre's
   * own ceiling instead.
   *
   * The editor reads this rather than discovering it: a backdrop that cannot
   * draw at the current camera is announced, never shown as an empty field.
   */
  readonly maxRenderableZoom: number;
  /**
   * Ground resolution of the imagery, in metres per pixel, or `null` for a
   * vector style, which has no pixels of its own. What the editor divides by
   * to tell a person how far a photograph is being enlarged.
   */
  readonly nativeMetresPerPixel: number | null;
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

/**
 * OpenFreeMap (https://openfreemap.org): a free, open, no-API-key vector tile
 * provider serving OpenMapTiles-schema tiles built from OpenStreetMap data.
 * Chosen as the default provider per this work package's brief.
 */
/**
 * Local metres → [longitude, latitude]. An equirectangular approximation
 * around the geographic anchor — adequate for an advisory backdrop over a
 * garden-sized area (tens to low hundreds of metres), not a survey-grade
 * projection. `scaleCorrection` and `rotationDegrees` come from the garden's
 * own georeference.
 *
 * A standalone function rather than a method, because the projection belongs
 * to the GARDEN, not to whoever draws the tiles: every provider shares it,
 * and sharing it as a method would make each provider's copy a `this`-bound
 * reference to another object's function.
 */
export const openFreeMapProvider: BasemapProvider = {
  name: 'OpenFreeMap',
  source: { kind: 'vectorStyle', styleUrl: 'https://tiles.openfreemap.org/styles/liberty' },
  // Measured, not assumed: 110 rendered features at zoom 16, six at 19, none
  // at 20 — see `maxRenderableZoom`'s own comment. A garden fills the canvas
  // at around zoom 21, so this backdrop is neighbourhood context, never a
  // surface to trace a lot from.
  maxRenderableZoom: 19,
  nativeMetresPerPixel: null,
  attributionHtml:
    '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
    '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  localToGeographic: localMetresToGeographic,
  geographicToLocal: geographicToLocalMetres,
};

const METRES_PER_PIXEL_AT_EQUATOR_ZOOM_ZERO = 156_543.033_92;
const DEGREES_TO_RADIANS = Math.PI / 180;

/** Standard Web Mercator tile math, used to keep MapLibre's zoom in step with the local camera's scale. */
export function zoomForMetresPerPixel(metresPerPixel: number, latitudeDegrees: number): number {
  const latitudeCorrection = Math.cos(latitudeDegrees * DEGREES_TO_RADIANS);
  return Math.log2((METRES_PER_PIXEL_AT_EQUATOR_ZOOM_ZERO * latitudeCorrection) / metresPerPixel);
}

/** The inverse of {@link zoomForMetresPerPixel}. */
export function metresPerPixelForZoom(zoom: number, latitudeDegrees: number): number {
  const latitudeCorrection = Math.cos(latitudeDegrees * DEGREES_TO_RADIANS);
  return (METRES_PER_PIXEL_AT_EQUATOR_ZOOM_ZERO * latitudeCorrection) / Math.pow(2, zoom);
}

/**
 * The largest camera scale, in pixels per metre, at which this provider's
 * backdrop still follows the drawing.
 *
 * Past it the backdrop does not merely blur — MapLibre clamps its own zoom
 * while the Konva camera keeps scaling, so the photograph and the geometry
 * drift apart, by up to eleven times at the editor's maximum scale. The
 * editor clamps the camera here instead, because a backdrop that quietly
 * stops matching is worse than one a person chose to turn off.
 */
export function maxCameraScaleFor(provider: BasemapProvider, latitudeDegrees: number): number {
  return 1 / metresPerPixelForZoom(provider.maxRenderableZoom, latitudeDegrees);
}

/**
 * How many times the imagery is being enlarged past its own detail at
 * `scale` pixels per metre, or `null` for a provider that has no pixels.
 *
 * The imagery resolves 0.30 m; a garden drawn at 24 px/m asks each of those
 * pixels to cover seven screen pixels. That is the imagery's limit rather
 * than a defect, and this is what lets the editor say so.
 */
export function imageryMagnificationAt(provider: BasemapProvider, scale: number): number | null {
  return provider.nativeMetresPerPixel === null ? null : scale * provider.nativeMetresPerPixel;
}

/**
 * United States aerial imagery, from the USGS National Map's NAIP service.
 *
 * WHY THIS ONE (owner decision, 2026-08-04): tracing a lot needs to see the
 * lot, and the vector provider above draws streets, not ground. NAIP is
 * public-domain federal imagery — no key, no account, no cost, and no terms
 * restricting what may be traced from it or how long the result is kept,
 * which is the whole difficulty with every commercial alternative.
 *
 * ITS LIMITS, stated because the interface has to state them:
 *
 * - United States only. That is the imagery's coverage and the product's
 *   first market (ADR-0007). Elsewhere the service returns nothing and the
 *   editor says so rather than showing an unexplained grey field.
 * - 0.30 m per pixel, which is the service's own `pixelSizeX` (read from
 *   `?f=json` on 2026-08-05, not estimated: an earlier 0.6 m figure here was
 *   a guess and it was wrong by a factor of two). NAIP Plus mixes NAIP with
 *   high-resolution orthoimagery, so some counties are finer still. A house,
 *   a driveway, a fence line and mature trees are legible; an individual bed
 *   is not. A garden that needs finer detail has the property-plan import
 *   path.
 *
 * `exportImage` renders on demand, so unlike the National Map's own cached
 * tile service — which stops at zoom 16, far too coarse for a garden — it
 * answers at whatever zoom the editor asks for. `{bbox-epsg-3857}` is the
 * renderer's own placeholder for the tile's bounds.
 */
export const usgsNaipImageryProvider: BasemapProvider = {
  name: 'USGS NAIP imagery',
  // MapLibre's own ceiling; the imagery itself keeps enlarging past its
  // detail, which `nativeMetresPerPixel` is what lets the editor admit.
  maxRenderableZoom: 22,
  nativeMetresPerPixel: 0.3,
  source: {
    kind: 'rasterTiles',
    tiles: [
      'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image',
    ],
    tileSize: 256,
    /*
     * Zoom 19 is where a 256-pixel tile covers about 76 m — 0.30 m per pixel,
     * exactly the resolution the service reports holding. Asking for more
     * returns the same ground enlarged by the server, in hard blocks, at four
     * times the requests; stopping here lets the renderer enlarge it smoothly
     * instead, and the enlargement is stated outright rather than implied —
     * see `nativeMetresPerPixel`.
     */
    maxZoom: 19,
  },
  attributionHtml:
    'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" ' +
    'target="_blank" rel="noopener noreferrer">USGS The National Map</a> (NAIP, public domain)',
  localToGeographic: localMetresToGeographic,
  geographicToLocal: geographicToLocalMetres,
};
