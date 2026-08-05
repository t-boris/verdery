/**
 * What the chosen backdrop can and cannot do at the camera the person is
 * currently looking through.
 *
 * Three facts decide everything the editor shows about a backdrop, and all
 * three were measured rather than assumed (see `basemap-provider.ts`):
 *
 * - a provider draws nothing past its own `maxRenderableZoom`, and for the
 *   street style that limit sits BELOW the scale a garden is drawn at;
 * - past that zoom MapLibre clamps itself while the Konva camera keeps
 *   scaling, so the backdrop stops matching the drawing instead of merely
 *   blurring — which is why the camera is clamped here;
 * - imagery keeps drawing but enlarges its own pixels, and a person deserves
 *   to be told by how much.
 *
 * Pure, so the arithmetic is testable without a canvas, a network, or a
 * browser that happens to be visible.
 *
 * Source: architecture/map-rendering-and-editing.md, section "3.2 Geographic
 * Space".
 */

import type { WireGeoreference } from '@/core/api/public';

import {
  imageryMagnificationAt,
  maxCameraScaleFor,
  openFreeMapProvider,
  usgsNaipImageryProvider,
  type BasemapProvider,
} from './basemap-provider';
import type { BackdropKind } from './editor-store';

/**
 * Enlargement past which the editor says so. Below it a photograph still
 * reads as a photograph; a lot outline traced at four times the imagery's own
 * detail is still tracing something real.
 */
export const IMAGERY_MAGNIFICATION_NOTICE = 4;

export interface BackdropState {
  /** What the person chose, even when it cannot be drawn. */
  readonly kind: BackdropKind;
  /** The provider behind that choice, or `null` for `none`. */
  readonly provider: BasemapProvider | null;
  /** Whether a backdrop is actually rendered: something chosen, and an anchor to place it against. */
  readonly visible: boolean;
  /** True only for a photograph — the case where the metre grid is noise over the ground. */
  readonly showsPhotograph: boolean;
  /** The largest camera scale the backdrop still follows, or `null` when nothing is drawn. */
  readonly maxCameraScale: number | null;
  /** How many times the imagery is enlarged at this camera, or `null` for a vector style. */
  readonly magnification: number | null;
  /** The chosen provider cannot draw at this camera at all — the street style, at garden scale. */
  readonly beyondProviderDetail: boolean;
}

function providerFor(kind: BackdropKind): BasemapProvider | null {
  if (kind === 'imagery') {
    return usgsNaipImageryProvider;
  }
  return kind === 'streets' ? openFreeMapProvider : null;
}

export function backdropStateFor(
  kind: BackdropKind,
  georeference: WireGeoreference | undefined,
  cameraScale: number,
): BackdropState {
  const provider = providerFor(kind);

  if (provider === null || georeference === undefined) {
    return {
      kind,
      provider,
      visible: false,
      showsPhotograph: false,
      maxCameraScale: null,
      magnification: null,
      beyondProviderDetail: false,
    };
  }

  const latitude = georeference.geographicAnchor[1];
  const maxCameraScale = maxCameraScaleFor(provider, latitude);

  return {
    kind,
    provider,
    visible: true,
    showsPhotograph: provider.nativeMetresPerPixel !== null,
    maxCameraScale,
    magnification: imageryMagnificationAt(provider, Math.min(cameraScale, maxCameraScale)),
    // A hair of tolerance: the clamp holds the camera AT the limit, and a
    // camera sitting exactly on it is inside what the provider can draw.
    beyondProviderDetail: cameraScale > maxCameraScale * 1.001,
  };
}

/** The camera scale to actually use: never past what a visible backdrop can follow. */
export function scaleWithinBackdrop(scale: number, backdrop: BackdropState): number {
  return backdrop.maxCameraScale === null ? scale : Math.min(scale, backdrop.maxCameraScale);
}

/**
 * The scale a map opens at over a photograph.
 *
 * The editor's own default is 24 px/m, which asks 0.30 m imagery to cover
 * seven screen pixels each — a lot outline traced over mush. Opening no
 * closer than the notice threshold means the first thing a person sees is
 * ground they can actually read; zooming in further is theirs to choose, and
 * the badge then says how far the photograph has been stretched.
 *
 * Applies to photographs only: a vector street map has no pixels to enlarge,
 * and a garden with no backdrop keeps the scale it always had.
 */
export function initialScaleOverBackdrop(scale: number, backdrop: BackdropState): number {
  const nativeMetresPerPixel = backdrop.provider?.nativeMetresPerPixel;
  if (!backdrop.visible || nativeMetresPerPixel === null || nativeMetresPerPixel === undefined) {
    return scale;
  }
  return Math.min(scale, IMAGERY_MAGNIFICATION_NOTICE / nativeMetresPerPixel);
}
