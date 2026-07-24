/**
 * Which derivatives P6-WORKER-02 builds for a given media class, and the
 * XYZ tile-pyramid geometry for the one class that gets tiles.
 *
 * DERIVATIVE SIZES/QUALITY — reasoned defaults, none of them named anywhere
 * in this repository's docs, documented here the same "no number decided
 * yet, pick one and say so" posture `configuration.ts`'s own
 * `RELAY_POLL_INTERVAL_MS`/`RELAY_BATCH_SIZE` comments and
 * `09-media-storage.sh`'s own export-bucket lifecycle rule already
 * established:
 *
 * - Thumbnail (320px long edge, JPEG q70): a small grid/list thumbnail —
 *   320px is comfortably above every common thumbnail-grid cell size on
 *   both target platforms (iOS/web) while staying tiny.
 * - Screen preview (1600px long edge, JPEG q82): architecture section 9's
 *   "Standard screen preview" — large enough to fill a typical phone or
 *   tablet screen at full width without visible upscaling, small enough to
 *   stay well under the original for ordinary in-app viewing.
 * - High-resolution review image (4096px long edge, JPEG q90): section 9's
 *   "where required" — built ONLY for `imported_plan` (raster plan
 *   documents), never `garden_photo`. A plan document is used as a
 *   zoomable map background for tracing/calibration (garden-capture-and-
 *   scan.md section 8's plan-import flow; map-rendering-and-editing.md
 *   section 16's "Plan Import and Calibration"), where a viewer plausibly
 *   zooms in close enough that a 1600px screen preview would visibly
 *   pixelate. A garden photo has no equivalent close-inspection use case
 *   this codebase's docs describe — nothing zooms into it as a map layer —
 *   so the screen preview (and, for the rare case someone genuinely needs
 *   full detail, the original itself, still privately downloadable via
 *   signed access) is judged sufficient; building a third, redundant size
 *   for every garden photo uniformly would cost real storage/compute for a
 *   use case this stage's own architecture sources never name.
 *
 * All three raster sizes are JPEG: none of `garden_photo`/`imported_plan`'s
 * own accepted raster types need an alpha channel for what these derivatives
 * are used for (in-app photo/plan-background display), and JPEG compresses
 * photographic and scanned-document content far smaller than PNG at a
 * visually equivalent quality — a real, deliberate trade-off against a
 * transparent-background source's alpha channel being flattened, judged
 * acceptable for these three kinds specifically. Never upscaled
 * (`withoutEnlargement` — see `image-derivative-generator.ts`): a source
 * already smaller than a given target size is served at its own native
 * size for that derivative instead of an interpolated, falsely "high-res"
 * one.
 *
 * TILE PYRAMID — architecture section 11's "Tile pyramids" for plan
 * documents, explicitly kept in scope for this stage by the repository
 * owner despite no consumer (P6-PLAN-01/02) existing yet:
 *
 * - Addressing: standard XYZ/slippy-map (`{z}/{x}/{y}`, top-left origin) —
 *   this app's own map rendering (ADR-0005, P3-WEB-02) already uses
 *   MapLibre, which speaks this scheme natively, so this reuses it rather
 *   than inventing a new convention.
 * - Tile size: 256px, the universal default for this scheme (the same
 *   default MapLibre, Leaflet, OpenStreetMap, and virtually every XYZ tile
 *   provider ship with) — no reason exists in this codebase's docs to
 *   deviate from it.
 * - Zoom levels: standard image-pyramid construction. `maxZoomLevel` is the
 *   smallest integer such that the source's native resolution, halved that
 *   many times, fits within one tile on its long edge (equivalently,
 *   `ceil(log2(maxNativeDimension / TILE_SIZE_PX))`, floored at 0 for a
 *   source already smaller than one tile). Level `maxZoomLevel` is the
 *   source's own native resolution, tiled directly (no downscaling); each
 *   level below halves the resolution again, down to level 0, which by
 *   this same construction always fits in exactly one tile — "stopping once
 *   a level fits in one tile" applied literally, not approximated.
 */

export type MediaDerivativeKind = 'thumbnail' | 'screen_preview' | 'high_resolution' | 'tile';

/** The derivative-generation pipeline's own version number — bumped whenever a size/quality/encoding parameter below changes in a way that should produce a fresh derivative rather than being treated as identical to a previous version's output. Starts at 1, the same "no prior number to increment" starting point `PROCESSOR_VERSION`-style tags across this codebase already use. */
export const DERIVATIVE_TRANSFORMATION_VERSION = 1;

export const TILE_SIZE_PX = 256;

export interface RasterDerivativeSpec {
  readonly kind: 'thumbnail' | 'screen_preview' | 'high_resolution';
  readonly maxDimensionPx: number;
  readonly jpegQuality: number;
}

const THUMBNAIL: RasterDerivativeSpec = { kind: 'thumbnail', maxDimensionPx: 320, jpegQuality: 70 };
const SCREEN_PREVIEW: RasterDerivativeSpec = {
  kind: 'screen_preview',
  maxDimensionPx: 1_600,
  jpegQuality: 82,
};
const HIGH_RESOLUTION: RasterDerivativeSpec = {
  kind: 'high_resolution',
  maxDimensionPx: 4_096,
  jpegQuality: 90,
};

export interface DerivativeProfile {
  readonly rasterSpecs: readonly RasterDerivativeSpec[];
  readonly includeTilePyramid: boolean;
}

/**
 * `null` for every media class this stage does not build derivatives for —
 * `raw_capture` (video, out of scope, matching P6-WORKER-01's own video
 * boundary) and every already-derived/diagnostic/export class
 * (`derived_preview`, `processing_output`, `export_package` — a derivative
 * of a derivative is not a concept any architecture section describes).
 * Mirrors `services/api`'s own `application/derivative-eligibility.ts`
 * media-class list — see that file's own doc comment for why it is
 * duplicated rather than shared.
 */
export function derivativeProfileFor(mediaClass: string): DerivativeProfile | null {
  switch (mediaClass) {
    case 'garden_photo':
      return { rasterSpecs: [THUMBNAIL, SCREEN_PREVIEW], includeTilePyramid: false };
    case 'imported_plan':
      return {
        rasterSpecs: [THUMBNAIL, SCREEN_PREVIEW, HIGH_RESOLUTION],
        includeTilePyramid: true,
      };
    default:
      return null;
  }
}

export interface TileLevelPlan {
  readonly zoomLevel: number;
  readonly scaledWidth: number;
  readonly scaledHeight: number;
  readonly tilesX: number;
  readonly tilesY: number;
}

/** See this file's own header comment for the construction this implements. Returned ordered from `maxZoomLevel` (full native resolution) down to `0` (always exactly one tile). */
export function planTilePyramid(
  nativeWidth: number,
  nativeHeight: number,
): readonly TileLevelPlan[] {
  const maxNativeDimension = Math.max(nativeWidth, nativeHeight);
  const maxZoomLevel = Math.max(0, Math.ceil(Math.log2(maxNativeDimension / TILE_SIZE_PX)));

  const levels: TileLevelPlan[] = [];
  for (let zoomLevel = maxZoomLevel; zoomLevel >= 0; zoomLevel -= 1) {
    const scale = 2 ** (zoomLevel - maxZoomLevel);
    const scaledWidth = Math.max(1, Math.round(nativeWidth * scale));
    const scaledHeight = Math.max(1, Math.round(nativeHeight * scale));
    levels.push({
      zoomLevel,
      scaledWidth,
      scaledHeight,
      tilesX: Math.ceil(scaledWidth / TILE_SIZE_PX),
      tilesY: Math.ceil(scaledHeight / TILE_SIZE_PX),
    });
  }
  return levels;
}
