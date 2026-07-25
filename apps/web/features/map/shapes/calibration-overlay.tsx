'use client';

import type { PlanTransform, Position } from '@verdery/geometry-contracts';
import { applyPlanTransform } from '@verdery/geometry-contracts';
import type Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Line, Rect } from 'react-konva';

import { containFitRect, geometryScreenRect, type ScreenRect } from '../background-fit';
import {
  calibratedImagePlacement,
  isPlanPointOnPage,
  planPointAtScreenViaContainFit,
  planPointAtScreenViaTransform,
} from '../background-placement';
import { draftPreview, type CalibrationDraft } from '../calibration-session';
import type { CanvasSize, MapCamera, MapObjectRecord } from '../types';
import { useBackgroundImage } from '../use-background-image';
import { screenDeltaToLocalDelta, toLocal, toScreen } from '../viewport';

export interface CalibrationOverlayProps {
  readonly record: MapObjectRecord;
  readonly gardenId: string;
  readonly draft: CalibrationDraft;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly onPlanPoint: (point: Position) => void;
  readonly onLocalPoint: (point: Position) => void;
  readonly onDragDelta: (dxMetres: number, dyMetres: number) => void;
}

/** Where the plan currently draws during the session, with both directions of the screen⟷plan mapping. */
interface SessionPlacement {
  readonly transform: PlanTransform | null;
  readonly fit: ScreenRect | null;
}

function planToScreen(
  placement: SessionPlacement,
  camera: MapCamera,
  size: CanvasSize,
  point: Position,
): { x: number; y: number } | null {
  if (placement.transform !== null) {
    return toScreen(applyPlanTransform(placement.transform, point), camera, size);
  }
  if (placement.fit !== null) {
    return {
      x: placement.fit.x + point[0] * placement.fit.width,
      y: placement.fit.y + point[1] * placement.fit.width,
    };
  }
  return null;
}

const SEGMENT_COLOR = '#b3261e';
const CONTROL_COLOR = '#1d5c2e';

/**
 * The calibration session's canvas surface (P6-PLAN-02): draws the plan
 * image at its LIVE preview placement (derived with the same shared math
 * the server runs), captures the session's clicks, and renders the
 * known-distance segment and control-point markers.
 *
 * Rendered last in the layer, so its full-canvas capture rectangle sits
 * above every garden shape: while a capture mode is armed, a click can
 * never accidentally select or edit an object. The rectangle is not
 * draggable, so stage panning and wheel zoom keep working mid-session.
 *
 * While no capture mode is armed and a preview transform exists, the
 * preview image itself is draggable — the drag delta is recorded as a
 * manual-adjustment translation (section 16's "manual origin
 * adjustment"), not a geometry move.
 */
export function CalibrationOverlay({
  record,
  gardenId,
  draft,
  camera,
  size,
  onPlanPoint,
  onLocalPoint,
  onDragDelta,
}: CalibrationOverlayProps) {
  const details =
    record.categoryDetails?.category === 'importedBackground'
      ? record.categoryDetails.details
      : null;
  const imageState = useBackgroundImage(gardenId, details?.planMediaId ?? '');
  if (imageState.kind !== 'ready') {
    // The panel refuses to start a session without a displayable image, so
    // this only bridges the initial load.
    return null;
  }
  return (
    <LoadedCalibrationOverlay
      record={record}
      draft={draft}
      image={imageState.image}
      camera={camera}
      size={size}
      onPlanPoint={onPlanPoint}
      onLocalPoint={onLocalPoint}
      onDragDelta={onDragDelta}
    />
  );
}

function LoadedCalibrationOverlay({
  record,
  draft,
  image,
  camera,
  size,
  onPlanPoint,
  onLocalPoint,
  onDragDelta,
}: Omit<CalibrationOverlayProps, 'gardenId'> & { readonly image: HTMLImageElement }) {
  const pageAspectRatio = image.naturalHeight / image.naturalWidth;
  const preview = draftPreview(draft, pageAspectRatio);
  const storedCalibration =
    record.categoryDetails?.category === 'importedBackground'
      ? record.categoryDetails.details.calibration
      : undefined;

  // Preview transform if derivable; else the stored transform while
  // recalibrating; else the uncalibrated contain-fit placeholder.
  const transform =
    preview.kind === 'ready'
      ? preview.derivation.transform
      : (storedCalibration?.transform ?? null);
  const bounds = geometryScreenRect(record.geometry, camera, size);
  const fit =
    transform === null && bounds !== null
      ? containFitRect(bounds, image.naturalWidth / image.naturalHeight)
      : null;
  const placement: SessionPlacement = { transform, fit };

  const screenToPlan = (screen: { x: number; y: number }): Position | null => {
    const point =
      placement.transform !== null
        ? planPointAtScreenViaTransform(placement.transform, camera, size, screen)
        : placement.fit !== null
          ? planPointAtScreenViaContainFit(placement.fit, screen)
          : null;
    return point !== null && isPlanPointOnPage(point, pageAspectRatio) ? point : null;
  };

  const handleCaptureClick = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (pointer === null || pointer === undefined || draft.capture === null) {
      return;
    }
    if (draft.capture === 'controlLocal') {
      onLocalPoint(toLocal(pointer, camera, size));
      return;
    }
    const planPoint = screenToPlan(pointer);
    if (planPoint !== null) {
      onPlanPoint(planPoint);
    }
  };

  const imagePlacement =
    placement.transform !== null
      ? calibratedImagePlacement(placement.transform, pageAspectRatio, camera, size)
      : null;
  const draggable = draft.capture === null && placement.transform !== null;

  const handleDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
    if (imagePlacement === null) {
      return;
    }
    const node = event.target;
    const { dx, dy } = screenDeltaToLocalDelta(
      node.x() - imagePlacement.x,
      node.y() - imagePlacement.y,
      camera,
    );
    node.position({ x: imagePlacement.x, y: imagePlacement.y });
    onDragDelta(dx, dy);
  };

  const markers: { key: string; screen: { x: number; y: number }; color: string }[] = [];
  draft.segmentPoints.forEach((point, index) => {
    const screen = planToScreen(placement, camera, size, point);
    if (screen !== null) {
      markers.push({ key: `segment-${String(index)}`, screen, color: SEGMENT_COLOR });
    }
  });
  if (draft.pendingPlanPoint !== null) {
    const screen = planToScreen(placement, camera, size, draft.pendingPlanPoint);
    if (screen !== null) {
      markers.push({ key: 'pending', screen, color: CONTROL_COLOR });
    }
  }

  const segmentScreens = draft.segmentPoints
    .map((point) => planToScreen(placement, camera, size, point))
    .filter((point): point is { x: number; y: number } => point !== null);

  return (
    <Group>
      {/* Capture surface — above every garden shape, below the session's own visuals. */}
      <Rect
        x={0}
        y={0}
        width={size.width}
        height={size.height}
        fill="rgba(0, 0, 0, 0.001)"
        listening={draft.capture !== null}
        onClick={handleCaptureClick}
        onTap={handleCaptureClick}
      />
      {imagePlacement !== null && (
        <KonvaImage
          image={image}
          x={imagePlacement.x}
          y={imagePlacement.y}
          width={imagePlacement.width}
          height={imagePlacement.height}
          rotation={imagePlacement.rotationDeg}
          opacity={0.75}
          draggable={draggable}
          listening={draggable}
          onDragEnd={handleDragEnd}
        />
      )}
      {imagePlacement === null && fit !== null && (
        <KonvaImage
          image={image}
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
          opacity={0.75}
          listening={false}
        />
      )}
      {segmentScreens.length === 2 && (
        <Line
          points={[
            segmentScreens[0]?.x ?? 0,
            segmentScreens[0]?.y ?? 0,
            segmentScreens[1]?.x ?? 0,
            segmentScreens[1]?.y ?? 0,
          ]}
          stroke={SEGMENT_COLOR}
          strokeWidth={2}
          dash={[6, 4]}
          listening={false}
        />
      )}
      {draft.referencePoints.map((point, index) => {
        const planScreen = planToScreen(placement, camera, size, point.planPoint);
        const localScreen = toScreen(point.localMetres, camera, size);
        return (
          <Group key={`control-${String(index)}`}>
            {planScreen !== null && (
              <Line
                points={[planScreen.x, planScreen.y, localScreen.x, localScreen.y]}
                stroke={CONTROL_COLOR}
                strokeWidth={1}
                dash={[3, 3]}
                listening={false}
              />
            )}
            {planScreen !== null && (
              <Circle
                x={planScreen.x}
                y={planScreen.y}
                radius={5}
                stroke={CONTROL_COLOR}
                strokeWidth={2}
                listening={false}
              />
            )}
            <Circle
              x={localScreen.x}
              y={localScreen.y}
              radius={5}
              fill={CONTROL_COLOR}
              listening={false}
            />
          </Group>
        );
      })}
      {markers.map((marker) => (
        <Circle
          key={marker.key}
          x={marker.screen.x}
          y={marker.screen.y}
          radius={6}
          stroke={marker.color}
          strokeWidth={2}
          fill="rgba(255, 255, 255, 0.7)"
          listening={false}
        />
      ))}
    </Group>
  );
}
