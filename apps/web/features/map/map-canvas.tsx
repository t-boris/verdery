'use client';

import { SNAP_TOLERANCE_SCREEN_PIXELS, type Position } from '@verdery/geometry-contracts';
import type Konva from 'konva';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Layer, Stage } from 'react-konva';

import { useLocalization } from '@/shared/localization/public';

import { useMapEditorStore } from './editor-store';
import { categoryLabelKey } from './labels';
import { DraftPreviewShape } from './shapes/draft-preview-shape';
import { ObjectShape } from './shapes/object-shape';
import { TransformHandles } from './shapes/transform-handles';
import { VertexHandles } from './shapes/vertex-handles';
import styles from './map-canvas.module.css';
import { snapPosition, type SnapContext, type SnapResult } from './snapping';
import { CREATABLE_GEOMETRY_KIND, creatableCategoryOfTool, type CanvasSize } from './types';
import type { MapEditorActions } from './use-map-editor-actions';
import { editableRingOf, isRingClosureVertex, movedRingClosureGeometry } from './vertex-ring';
import { initialCameraFor, isRecordInViewport, panCamera, toLocal, zoomCamera } from './viewport';

const NUDGE_METRES = 0.1;
const NUDGE_METRES_FAST = 1;
const ZOOM_IN_FACTOR = 1.1;
const ZOOM_OUT_FACTOR = 1 / 1.1;

function isEditableElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export interface MapCanvasProps {
  readonly actions: MapEditorActions;
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
export function MapCanvas({ actions }: MapCanvasProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();

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
    store.initCamera(initialCameraFor(actions.records, size));
  }, [actions.records, size, store]);

  const camera = store.state.camera;
  const tool = store.state.tool;
  const creatingCategory = creatableCategoryOfTool(tool);
  const draftKind = creatingCategory === null ? null : CREATABLE_GEOMETRY_KIND[creatingCategory];
  const isDrafting = draftKind === 'polygon' || draftKind === 'line';

  const interactionMode = store.state.interactionMode;
  const selectedRecord = actions.selectedRecord;

  const visibleRecords = actions.records.filter((record) =>
    isRecordInViewport(record, camera, size),
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

  const handleStageDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
    const stage = event.target;
    store.setCamera(panCamera(camera, stage.x(), stage.y()));
    stage.position({ x: 0, y: 0 });
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (pointer === null || pointer === undefined) {
      return;
    }
    const factor = event.evt.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    store.setCamera(zoomCamera(camera, size, pointer, factor));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableElement(event.target)) {
      return;
    }

    if (event.key === 'Escape') {
      if (isDrafting && store.state.draftPoints.length > 0) {
        store.setDraftPoints([]);
      } else {
        store.setTool('select');
        store.select(null);
      }
      return;
    }

    if (isDrafting && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      void actions.finishDraft();
      return;
    }

    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      store.state.selectedObjectId !== null
    ) {
      event.preventDefault();
      void actions.deleteObject(store.state.selectedObjectId);
      return;
    }

    const nudge = event.shiftKey ? NUDGE_METRES_FAST : NUDGE_METRES;
    if (store.state.selectedObjectId === null) {
      return;
    }

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        void actions.moveObject(store.state.selectedObjectId, 0, nudge);
        return;
      case 'ArrowDown':
        event.preventDefault();
        void actions.moveObject(store.state.selectedObjectId, 0, -nudge);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        void actions.moveObject(store.state.selectedObjectId, -nudge, 0);
        return;
      case 'ArrowRight':
        event.preventDefault();
        void actions.moveObject(store.state.selectedObjectId, nudge, 0);
        return;
      default:
        return;
    }
  };

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

  return (
    <div className={styles['canvasArea']}>
      {hintKey !== null && (
        <p className={styles['hint']} role="status">
          {hintKey === 'map.canvas.hintPoint' && creatingCategory !== null
            ? t(hintKey, { category: t(categoryLabelKey(creatingCategory)) })
            : t(hintKey)}
        </p>
      )}
      <div
        ref={containerRef}
        className={styles['stageContainer']}
        tabIndex={0}
        role="application"
        aria-label={t('map.canvas.ariaLabel')}
        onKeyDown={handleKeyDown}
      >
        {size.width > 0 && size.height > 0 && (
          <Stage
            width={size.width}
            height={size.height}
            x={0}
            y={0}
            draggable={tool === 'select'}
            onDragEnd={handleStageDragEnd}
            onClick={handleStageClick}
            onTap={handleStageClick}
            onDblClick={handleStageDblClick}
            onMouseMove={handleStageMouseMove}
            onWheel={handleWheel}
          >
            <Layer>
              {visibleRecords.map((record) => {
                // Vertex-edit and transform handles fully own repositioning
                // the selected object while active — whole-object drag would
                // otherwise fight the handle gestures for the same shape.
                const isEditingThisObject =
                  interactionMode !== 'idle' && record.id === store.state.selectedObjectId;
                return (
                  <ObjectShape
                    key={record.id}
                    record={record}
                    camera={camera}
                    size={size}
                    selected={record.id === store.state.selectedObjectId}
                    draggable={tool === 'select' && !isEditingThisObject}
                    onSelect={store.select}
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
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}
