'use client';

import { SNAP_TOLERANCE_SCREEN_PIXELS, type Position } from '@verdery/geometry-contracts';
import type Konva from 'konva';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Layer, Stage } from 'react-konva';

import { useLocalization } from '@/shared/localization/public';
import { VisuallyHidden } from '@/shared/ui/public';

import {
  initialScaleOverBackdrop,
  scaleWithinBackdrop,
  type BackdropState,
} from './backdrop-state';
import { calibrationStateText } from './calibration-labels';
import {
  draftWithLocalPoint,
  draftWithManualTranslation,
  draftWithPlanPoint,
} from './calibration-session';
import { useMapEditorStore } from './editor-store';
import { categoryLabelKey } from './labels';
import { isCategoryHidden, isCategoryLocked } from './map-layers';
import { formatOrdinal, mapObjectOrdinals } from './map-object-ordinals';
import { MapCanvasChrome } from './map-canvas-chrome';
import { BackgroundImageShape } from './shapes/background-image-shape';
import { CalibrationOverlay } from './shapes/calibration-overlay';
import { CanvasGrid } from './shapes/canvas-grid';
import { DraftPreviewShape } from './shapes/draft-preview-shape';
import { ObjectLabelChip } from './shapes/object-label-chip';
import { ObjectShape } from './shapes/object-shape';
import { PlatAlignmentLayer } from './plat-alignment-layer';
import { TransformHandles } from './shapes/transform-handles';
import { VertexHandles } from './shapes/vertex-handles';
import styles from './map-canvas.module.css';
import { snapPosition, type SnapContext, type SnapResult } from './snapping';
import {
  CREATABLE_GEOMETRY_KIND,
  creatableCategoryOfTool,
  existingObjectsAreInteractive,
  type CanvasSize,
} from './types';
import { useCanvasPalette } from './use-canvas-palette';
import { createCanvasKeyDownHandler } from './use-canvas-keyboard';
import type { MapEditorActions } from './use-map-editor-actions';
import { useStagePan } from './use-stage-pan';
import { editableRingOf, isRingClosureVertex, movedRingClosureGeometry } from './vertex-ring';
import { initialCameraFor, isRecordInViewport, toLocal, zoomCamera } from './viewport';

const ZOOM_IN_FACTOR = 1.1;
const ZOOM_OUT_FACTOR = 1 / 1.1;

export interface MapCanvasProps {
  readonly actions: MapEditorActions;
  /** View rotation that makes geographic north point straight up. */
  readonly northUpRotationDegrees?: number | null;
  /**
   * What the chosen backdrop can draw at the current camera. The stage needs
   * it for two decisions: whether the metre grid would be noise over a
   * photograph, and how far the camera may zoom before the backdrop stops
   * following the drawing.
   */
  readonly backdrop: BackdropState;
  /**
   * The backdrop itself, rendered as the bottom layer INSIDE this stage's own
   * container.
   *
   * It has to be this element's child rather than a sibling one level up:
   * the two must occupy exactly the same rectangle, and as a sibling of the
   * canvas area it was aligned to a box that also contained the hint row —
   * so the imagery slid whenever a tool started drawing, which is precisely
   * when someone is trying to trace it.
   */
  readonly backdropView?: ReactNode;
}

/**
 * The Konva stage: renders every object in the current viewport, owns pan and
 * zoom, dispatches selection and drag-to-move, drives the polygon/line/point
 * draft gestures for every creatable category (`types.ts`), and — for the
 * selected object, while its vertex-edit or transform sub-mode is active —
 * renders the reshape and resize/rotate handles (`shapes/vertex-handles.tsx`,
 * `shapes/transform-handles.tsx`).
 *
 * Takes `actions` (from `use-map-editor-actions.ts`) as a prop rather than
 * calling the hook itself — `map-editor.tsx` calls it once and shares the
 * same instance with the toolbar, object list, and property panel, so they
 * all observe the same `isSubmitting` state instead of five independent
 * mutation objects racing each other.
 *
 * Client-only (touches `window`/`document` through Konva) — always loaded via
 * `next/dynamic(..., { ssr: false })` from `map-editor.tsx`.
 */
export function MapCanvas({
  actions,
  backdrop,
  backdropView = null,
  northUpRotationDegrees = null,
}: MapCanvasProps) {
  const { t, locale } = useLocalization();
  const store = useMapEditorStore();

  const keyboardHelpId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [pointerLocal, setPointerLocal] = useState<Position | null>(null);
  const [draftSnap, setDraftSnap] = useState<SnapResult | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Fits the camera to every object's bounds exactly once, as soon as both
  // the map data and a real canvas size are available; a garden with no
  // objects keeps the default camera (`initialCameraFor` falls back to it).
  useEffect(() => {
    if (size.width === 0 || size.height === 0 || store.state.cameraInitialized) {
      return;
    }
    const fitted = initialCameraFor(actions.records, size, camera.rotationDegrees);
    store.initCamera({
      ...fitted,
      scale: scaleWithinBackdrop(initialScaleOverBackdrop(fitted.scale, backdrop), backdrop),
    });
  }, [actions.records, backdrop, size, store]);

  const camera = store.state.camera;
  const tool = store.state.tool;
  const creatingCategory = creatableCategoryOfTool(tool);
  const draftKind = creatingCategory === null ? null : CREATABLE_GEOMETRY_KIND[creatingCategory];
  const isDrafting = draftKind === 'polygon' || draftKind === 'line';

  const interactionMode = store.state.interactionMode;
  const selectedRecord = actions.selectedRecord;
  const stagePan = useStagePan({
    enabled: tool === 'select' && store.state.calibrationDraft === null,
    camera,
    onCameraChange: store.setCamera,
  });

  // Switching from aerial to Streets can lower the provider's usable zoom by
  // several levels. Clamp immediately, not only on the next wheel gesture;
  // otherwise MapLibre shows its empty over-zoomed background while the
  // selected Streets button misleadingly says a map is present.
  useEffect(() => {
    if (backdrop.maxCameraScale !== null && camera.scale > backdrop.maxCameraScale) {
      store.setCamera({ ...camera, scale: backdrop.maxCameraScale });
    }
  }, [backdrop.maxCameraScale, camera, store]);

  // A hidden layer's objects are excluded here the same way `map-object-list.tsx`
  // excludes them from the accessible list — the canvas and the list must
  // always agree on what is currently visible.
  const palette = useCanvasPalette();
  // Numbered from the FULL record set so the chip matches the object index's
  // row even when the viewport or a hidden layer excludes its neighbours.
  const ordinals = mapObjectOrdinals(actions.records);
  const visibleRecords = actions.records.filter(
    (record) =>
      isRecordInViewport(record, camera, size) &&
      !isCategoryHidden(record.category, store.state.hiddenLayers),
  );

  // The in-progress calibration session (P6-PLAN-02), if any: its record
  // renders through `CalibrationOverlay` (live preview + capture surface)
  // instead of the ordinary underlay below.
  const calibrationDraft = store.state.calibrationDraft;
  const calibrationRecord =
    calibrationDraft === null
      ? null
      : (actions.records.find((record) => record.id === calibrationDraft.objectId) ?? null);

  // Imported-background raster underlays (P6-PLAN-01), drawn under every
  // object shape. Two independent visibility controls both apply: the
  // client-local layer-2 toggle (already applied by `visibleRecords`) and
  // the background's own PERSISTED `isBackgroundVisible` flag, which hides
  // only the plan imagery — the object's polygon outline stays visible and
  // selectable as the editing handle for the background object.
  const visibleBackgrounds = visibleRecords.filter(
    (record) =>
      record.categoryDetails?.category === 'importedBackground' &&
      record.categoryDetails.details.isBackgroundVisible &&
      record.id !== calibrationRecord?.id,
  );

  /** Section 16's always-visible state/quality badge — honest ± text, never implied exactness. */
  const backgroundBadgeLabel = (record: (typeof visibleBackgrounds)[number]): string =>
    calibrationStateText(
      t,
      locale,
      record.categoryDetails?.category === 'importedBackground'
        ? record.categoryDetails.details.calibration
        : undefined,
    );

  // Vertex/edge proximity tolerance converted from a constant screen-pixel
  // radius to local metres at the current zoom — the same pattern
  // `isRecordInViewport` (`viewport.ts`) already uses for its own margin.
  // Source: architecture/map-rendering-and-editing.md, section "3.3 Screen
  // Space"; `SNAP_TOLERANCE_SCREEN_PIXELS`'s own doc comment.
  const snapToleranceMetres = SNAP_TOLERANCE_SCREEN_PIXELS / camera.scale;

  /**
   * The snap context for the in-progress draft: every object in the garden
   * is a candidate target, and the reference for the three direction/distance
   * snaps is the previously placed draft point (`null` for the first point,
   * which disables those three and leaves only vertex/edge snapping).
   *
   * `disabled` is driven by the platform Cmd/Meta key (`metaKey`, or
   * `ctrlKey` on non-Mac platforms — the same either/or this feature already
   * uses for the global undo/redo shortcut in `map-editor.tsx`) held while
   * clicking or moving the pointer. Alt and Shift are already claimed by
   * `shapes/vertex-handles.tsx` (remove/split a vertex) for this same
   * gesture family, so reusing either here would collide; Cmd/Meta is the
   * remaining modifier with no existing meaning on this canvas.
   */
  const draftSnapContext = (nativeEvent: { metaKey: boolean; ctrlKey: boolean }): SnapContext => ({
    objects: actions.records,
    referencePoint: store.state.draftPoints[store.state.draftPoints.length - 1] ?? null,
    toleranceMetres: snapToleranceMetres,
    disabled: nativeEvent.metaKey || nativeEvent.ctrlKey,
  });

  const handleStageClick = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (stagePan.consumeClick()) {
      return;
    }
    // While a calibration session is active, every meaningful click goes to
    // `CalibrationOverlay`'s capture surface — a stray stage click must not
    // deselect the background and silently kill the session.
    if (calibrationDraft !== null) {
      return;
    }
    const stage = event.target.getStage();
    if (stage === null || event.target !== stage) {
      // A shape's own onClick already ran and selected it.
      return;
    }

    const pointer = stage.getPointerPosition();
    if (pointer === null) {
      return;
    }
    const local = toLocal(pointer, camera, size);

    if (creatingCategory === null) {
      store.select(null);
      return;
    }

    if (draftKind === 'polygon' || draftKind === 'line') {
      const { position } = snapPosition(local, draftSnapContext(event.evt));
      store.setDraftPoints([...store.state.draftPoints, position]);
    } else {
      void actions.placePoint(creatingCategory, local);
    }
  };

  const handleStageDblClick = () => {
    if (isDrafting) {
      void actions.finishDraft();
    }
  };

  const handleStageMouseMove = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (stagePan.move(event)) {
      return;
    }
    if (!isDrafting) {
      return;
    }
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (pointer === null || pointer === undefined) {
      setPointerLocal(null);
      setDraftSnap(null);
      return;
    }
    const local = toLocal(pointer, camera, size);
    const { position, snap } = snapPosition(local, draftSnapContext(event.evt));
    setPointerLocal(position);
    setDraftSnap(snap);
  };

  /*
   * Zoom, held to what a visible backdrop can still follow.
   *
   * Past its limit MapLibre clamps its own zoom while this camera keeps
   * scaling, so the photograph and the geometry drift apart — up to eleven
   * times at full scale. Refusing to go further, and saying why, is the only
   * honest option: a backdrop that silently stops matching the drawing is
   * worse than no backdrop at all.
   */
  const zoomTo = (pivot: { readonly x: number; readonly y: number }, factor: number) => {
    const next = zoomCamera(camera, size, pivot, factor);
    const held = scaleWithinBackdrop(next.scale, backdrop);
    if (held < next.scale && held <= camera.scale) {
      store.setStatus({ key: 'map.backdrop.zoomLimited', tone: 'status' });
      return;
    }
    store.setCamera(
      held === next.scale ? next : zoomCamera(camera, size, pivot, held / camera.scale),
    );
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (pointer === null || pointer === undefined) {
      return;
    }
    zoomTo(pointer, event.evt.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR);
  };

  const handleKeyDown = createCanvasKeyDownHandler({
    store,
    actions,
    camera,
    size,
    isDrafting,
    zoomBy: zoomTo,
    zoomInFactor: ZOOM_IN_FACTOR,
    zoomOutFactor: ZOOM_OUT_FACTOR,
  });

  const modeHintKey =
    interactionMode === 'vertexEdit'
      ? 'map.canvas.hintVertexEdit'
      : interactionMode === 'transform'
        ? 'map.canvas.hintTransform'
        : null;

  const hintKey =
    modeHintKey ??
    (draftKind === 'polygon' || draftKind === 'line'
      ? 'map.canvas.hintPath'
      : creatingCategory === null
        ? null
        : 'map.canvas.hintPoint');

  /*
   * Zoom lives on the canvas, next to the thing being zoomed — and it lives
   * INSIDE this component because fitting the drawing needs the stage's own
   * measured size, which nothing outside it knows.
   */
  const fitToObjects = () => {
    if (size.width === 0 || size.height === 0) {
      return;
    }
    const fitted = initialCameraFor(actions.records, size);
    store.setCamera({ ...fitted, scale: scaleWithinBackdrop(fitted.scale, backdrop) });
  };

  return (
    <div className={styles['canvasArea']}>
      <MapCanvasChrome
        hint={
          hintKey === null
            ? null
            : hintKey === 'map.canvas.hintPoint' && creatingCategory !== null
              ? t(hintKey, { category: t(categoryLabelKey(creatingCategory)) })
              : t(hintKey)
        }
        camera={camera}
        size={size}
        selectedRecord={selectedRecord}
        interactionMode={interactionMode}
        onSetInteractionMode={store.setInteractionMode}
        onDeleteSelected={() => {
          if (selectedRecord !== null) {
            void actions.deleteObject(selectedRecord.id);
          }
        }}
        onZoomIn={() => zoomTo({ x: size.width / 2, y: size.height / 2 }, ZOOM_IN_FACTOR)}
        onZoomOut={() => zoomTo({ x: size.width / 2, y: size.height / 2 }, ZOOM_OUT_FACTOR)}
        onZoomFit={fitToObjects}
        northUpRotationDegrees={northUpRotationDegrees}
        onRotationChange={(rotationDegrees) => store.setCamera({ ...camera, rotationDegrees })}
      />
      <div
        ref={containerRef}
        className={styles['stageContainer']}
        tabIndex={0}
        role="application"
        aria-label={t('map.canvas.ariaLabel')}
        aria-describedby={keyboardHelpId}
        onKeyDown={handleKeyDown}
      >
        {/* The canvas announces what a keyboard can and cannot do here. The
            second half is deliberately an admission rather than a promise:
            drawing a shape and dragging a vertex are pointer gestures with
            no keyboard equivalent in this pass, and the object list is the
            accessible route to everything that does have one. */}
        <VisuallyHidden>
          <span id={keyboardHelpId}>{t('map.canvas.keyboardHelp')}</span>
        </VisuallyHidden>
        {backdropView !== null && <div className={styles['backdropLayer']}>{backdropView}</div>}
        {size.width > 0 && size.height > 0 && (
          <Stage
            width={size.width}
            height={size.height}
            x={0}
            y={0}
            onMouseDown={stagePan.start}
            onMouseUp={stagePan.end}
            onMouseLeave={stagePan.end}
            onTouchStart={stagePan.start}
            onTouchMove={stagePan.move}
            onTouchEnd={stagePan.end}
            onClick={handleStageClick}
            onTap={handleStageClick}
            onDblClick={handleStageDblClick}
            onMouseMove={handleStageMouseMove}
            onWheel={handleWheel}
          >
            <Layer>
              {/*
                Chrome for an empty canvas, and nothing more: the grid exists
                so a garden with no objects is not a blank rectangle. Over an
                aerial photograph it is a lattice across the very thing being
                traced, so a visible backdrop replaces it — which is also what
                the grid's own note means by "a visible ground".
              */}
              {/* Suppressed over a photograph, where it is noise on the
                  ground; kept over a street map, which carries no sense of
                  scale of its own. */}
              {!backdrop.showsPhotograph && <CanvasGrid size={size} stroke={palette.grid} />}
              {visibleBackgrounds.map((record) => (
                <BackgroundImageShape
                  key={`background-${record.id}`}
                  record={record}
                  gardenId={record.gardenId}
                  camera={camera}
                  size={size}
                  badgeLabel={backgroundBadgeLabel(record)}
                  opacity={store.state.backgroundOpacity}
                />
              ))}
              {visibleRecords.map((record) => {
                // Vertex-edit and transform handles fully own repositioning
                // the selected object while active — whole-object drag would
                // otherwise fight the handle gestures for the same shape.
                const isEditingThisObject =
                  interactionMode !== 'idle' && record.id === store.state.selectedObjectId;
                // A locked layer's objects can be neither selected nor
                // dragged — see `map-layers.ts` and `map-layer-panel.tsx`'s
                // doc comment for the full set of interactions a lock blocks.
                const isLocked = isCategoryLocked(record.category, store.state.lockedLayers);
                return (
                  <ObjectShape
                    key={record.id}
                    record={record}
                    camera={camera}
                    size={size}
                    selected={record.id === store.state.selectedObjectId}
                    interactive={existingObjectsAreInteractive(tool)}
                    draggable={tool === 'select' && !isEditingThisObject && !isLocked}
                    onSelect={(objectId) => {
                      if (isLocked) {
                        store.setStatus({ key: 'map.status.layerLocked', tone: 'alert' });
                        return;
                      }
                      store.select(objectId);
                    }}
                    onMoveEnd={(objectId, dx, dy, resetPosition) => {
                      void actions.moveObject(objectId, dx, dy).then((result) => {
                        if (result === null) {
                          resetPosition();
                        }
                      });
                    }}
                  />
                );
              })}
              <PlatAlignmentLayer camera={camera} size={size} />
              {/* After every shape, so a chip is never painted under a neighbouring object. */}
              {visibleRecords.map((record) => (
                <ObjectLabelChip
                  key={`chip-${record.id}`}
                  record={record}
                  text={formatOrdinal(ordinals.get(record.id))}
                  camera={camera}
                  size={size}
                  fill={palette.chipFill}
                  textColor={palette.chipText}
                />
              ))}
              {isDrafting && draftKind !== null && (
                <DraftPreviewShape
                  points={store.state.draftPoints}
                  pointer={pointerLocal}
                  kind={draftKind}
                  camera={camera}
                  size={size}
                  snap={draftSnap}
                />
              )}
              {interactionMode === 'vertexEdit' && selectedRecord !== null && (
                <VertexHandles
                  record={selectedRecord}
                  records={actions.records}
                  camera={camera}
                  size={size}
                  onMoveVertex={(ringIndex, vertexIndex, position) => {
                    // The closure vertex of a closed ring is stored twice
                    // (first and last position); `editVertex` touches only
                    // one stored slot, so moving this one vertex commits a
                    // full `replaceGeometry` instead, with both copies
                    // updated — see `isRingClosureVertex` in `vertex-ring.ts`.
                    const ring = editableRingOf(selectedRecord.geometry);
                    if (ring !== null && isRingClosureVertex(ring, vertexIndex)) {
                      void actions.replaceGeometry(
                        selectedRecord.id,
                        movedRingClosureGeometry(selectedRecord.geometry, position),
                      );
                      return;
                    }
                    void actions.editVertex(
                      selectedRecord.id,
                      'move',
                      ringIndex,
                      vertexIndex,
                      position,
                    );
                  }}
                  onInsertVertex={(ringIndex, vertexIndex, position) =>
                    void actions.editVertex(
                      selectedRecord.id,
                      'insert',
                      ringIndex,
                      vertexIndex,
                      position,
                    )
                  }
                  onRemoveVertex={(ringIndex, vertexIndex) =>
                    void actions.editVertex(selectedRecord.id, 'remove', ringIndex, vertexIndex)
                  }
                  {...(selectedRecord.category === 'fence' || selectedRecord.category === 'path'
                    ? {
                        onSplitAtVertex: (vertexIndex: number) =>
                          void actions.splitLinework(selectedRecord.id, vertexIndex),
                      }
                    : {})}
                />
              )}
              {interactionMode === 'transform' && selectedRecord !== null && (
                <TransformHandles
                  record={selectedRecord}
                  camera={camera}
                  size={size}
                  onReplaceGeometry={(geometry) =>
                    void actions.replaceGeometry(selectedRecord.id, geometry)
                  }
                />
              )}
              {calibrationDraft !== null && calibrationRecord !== null && (
                <CalibrationOverlay
                  record={calibrationRecord}
                  gardenId={calibrationRecord.gardenId}
                  draft={calibrationDraft}
                  camera={camera}
                  size={size}
                  onPlanPoint={(point) =>
                    store.setCalibrationDraft(draftWithPlanPoint(calibrationDraft, point))
                  }
                  onLocalPoint={(point) =>
                    store.setCalibrationDraft(draftWithLocalPoint(calibrationDraft, point))
                  }
                  onDragDelta={(dx, dy) =>
                    store.setCalibrationDraft(draftWithManualTranslation(calibrationDraft, dx, dy))
                  }
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}
