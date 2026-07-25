'use client';

import { Image as KonvaImage, Rect, Text } from 'react-konva';

import { containFitRect, geometryScreenRect } from '../background-fit';
import { calibratedImagePlacement } from '../background-placement';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { useBackgroundImage } from '../use-background-image';

export interface BackgroundImageShapeProps {
  readonly record: MapObjectRecord;
  readonly gardenId: string;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  /** Localized state/quality badge text — localization stays outside the canvas layer. Section 16: quality is always displayed, never implied. */
  readonly badgeLabel: string;
  /** Client-local underlay opacity (`editor-store.ts#backgroundOpacity`) — dimmable for tracing. */
  readonly opacity: number;
}

const BADGE_FONT_SIZE = 11;
const BADGE_PADDING = 4;

/**
 * One imported background's raster underlay: the plan's screen-preview
 * derivative, drawn under all garden geometry with the calibration badge
 * section 16 requires ("displays calibration quality and prevents false
 * precision").
 *
 * - CALIBRATED (P6-PLAN-02): the image draws exactly at its plan-to-map
 *   transform (`background-placement.ts`) — scale, rotation, and
 *   translation — so traced geometry aligns with the plan's ink. The
 *   object's own polygon is the server-derived page footprint and
 *   coincides with the image by construction.
 * - UNCALIBRATED (P6-PLAN-01): "contain"-fit inside the placeholder
 *   polygon's bounding box (`background-fit.ts`), never stretched, with
 *   the explicit "not calibrated" badge.
 *
 * A plan with no displayable derivative (every PDF today) renders only its
 * badge — the object's own polygon outline is already drawn by
 * `ObjectShape` above this layer, so there is no broken-image state.
 *
 * `listening={false}` throughout: the underlay must never steal clicks
 * from the polygon shape that owns selection.
 */
export function BackgroundImageShape({
  record,
  gardenId,
  camera,
  size,
  badgeLabel,
  opacity,
}: BackgroundImageShapeProps) {
  const details =
    record.categoryDetails?.category === 'importedBackground'
      ? record.categoryDetails.details
      : null;
  const state = useBackgroundImage(gardenId, details?.planMediaId ?? '');

  const bounds = geometryScreenRect(record.geometry, camera, size);
  if (details === null || bounds === null) {
    return null;
  }

  const badgeWidth = badgeLabel.length * BADGE_FONT_SIZE * 0.62 + BADGE_PADDING * 2;
  const badgeHeight = BADGE_FONT_SIZE + BADGE_PADDING * 2;

  const calibration = details.calibration;

  let imageNode = null;
  if (state.kind === 'ready') {
    if (calibration !== undefined) {
      const placement = calibratedImagePlacement(
        calibration.transform,
        calibration.pageAspectRatio,
        camera,
        size,
      );
      imageNode = (
        <KonvaImage
          image={state.image}
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          rotation={placement.rotationDeg}
          opacity={opacity}
          listening={false}
        />
      );
    } else {
      const fit = containFitRect(bounds, state.image.naturalWidth / state.image.naturalHeight);
      imageNode = (
        <KonvaImage
          image={state.image}
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
          opacity={opacity}
          listening={false}
        />
      );
    }
  }

  return (
    <>
      {imageNode}
      <Rect
        x={bounds.x}
        y={bounds.y}
        width={badgeWidth}
        height={badgeHeight}
        fill="rgba(255, 249, 219, 0.92)"
        stroke="#8a6d1a"
        strokeWidth={1}
        cornerRadius={3}
        listening={false}
      />
      <Text
        text={badgeLabel}
        x={bounds.x + BADGE_PADDING}
        y={bounds.y + BADGE_PADDING}
        fontSize={BADGE_FONT_SIZE}
        fill="#8a6d1a"
        listening={false}
      />
    </>
  );
}
