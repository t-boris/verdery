'use client';

import { Image as KonvaImage, Rect, Text } from 'react-konva';

import { containFitRect, geometryScreenRect } from '../background-fit';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { useBackgroundImage } from '../use-background-image';

export interface BackgroundImageShapeProps {
  readonly record: MapObjectRecord;
  readonly gardenId: string;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  /** Localized "not calibrated" badge text — localization stays outside the canvas layer. */
  readonly notCalibratedLabel: string;
}

const BADGE_FONT_SIZE = 11;
const BADGE_PADDING = 4;

/**
 * One imported background's raster underlay (P6-PLAN-01): the plan's
 * screen-preview derivative, "contain"-fit inside the object polygon's own
 * bounding box (`background-fit.ts` — a placeholder placement, since an
 * uncalibrated background HAS no plan-to-map transform), plus the explicit
 * "not calibrated" badge section 16 requires ("displays calibration quality
 * and prevents false precision"). A plan with no displayable derivative
 * (every PDF today) renders only its badge — the object's own polygon
 * outline is already drawn by `ObjectShape` above this layer, so there is
 * no broken-image state.
 *
 * `listening={false}` throughout: the underlay must never steal clicks from
 * the polygon shape that owns selection.
 */
export function BackgroundImageShape({
  record,
  gardenId,
  camera,
  size,
  notCalibratedLabel,
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

  const showBadge = details.calibrationState === 'uncalibrated';
  const badgeWidth = notCalibratedLabel.length * BADGE_FONT_SIZE * 0.62 + BADGE_PADDING * 2;
  const badgeHeight = BADGE_FONT_SIZE + BADGE_PADDING * 2;

  const fit =
    state.kind === 'ready'
      ? containFitRect(bounds, state.image.naturalWidth / state.image.naturalHeight)
      : null;

  return (
    <>
      {state.kind === 'ready' && fit !== null && (
        <KonvaImage
          image={state.image}
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
          opacity={0.85}
          listening={false}
        />
      )}
      {showBadge && (
        <>
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
            text={notCalibratedLabel}
            x={bounds.x + BADGE_PADDING}
            y={bounds.y + BADGE_PADDING}
            fontSize={BADGE_FONT_SIZE}
            fill="#8a6d1a"
            listening={false}
          />
        </>
      )}
    </>
  );
}
