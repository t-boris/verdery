'use client';

import { positionsOf } from '@verdery/geometry-contracts';

import { useLocalization } from '@/shared/localization/public';
import { Button, CursorIcon, RulerIcon, TrashIcon, TypeIcon } from '@/shared/ui/public';

import type { InteractionMode } from './editor-store';
import { categoryLabelKey } from './labels';
import styles from './map-selection-toolbar.module.css';
import type { CanvasSize, MapCamera, MapObjectRecord } from './types';
import { editableRingOf } from './vertex-ring';
import { boundingBoxOfPositions, toScreen } from './viewport';

/** Distance above the object's own box, in screen pixels, so the panel never covers what it acts on. */
const OFFSET_ABOVE_PX = 12;

export interface MapSelectionToolbarProps {
  readonly record: MapObjectRecord;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly interactionMode: InteractionMode;
  readonly onSetMode: (mode: InteractionMode) => void;
  readonly onDelete: () => void;
}

/**
 * What can be done to the selected object, at the object.
 *
 * Movement is deliberately armed here before a shape becomes draggable, so
 * ordinary map panning can never silently move the lot relative to imagery.
 * Rotation and resize run through `TransformHandles`, and
 * and both were unreachable in practice: the handles lived behind a toggle in
 * the right-hand inspector, three panels down, and nothing on the canvas said
 * so. "Нет возможности вертеть лот" was a discoverability failure, not a
 * missing capability.
 *
 * The same four actions remain in the Properties tab, which is the keyboard
 * and screen-reader route; this panel is a shortcut placed where the eye
 * already is, not the only way in.
 *
 * Source: architecture/map-rendering-and-editing.md, section "13. Web
 * Rendering".
 */
export function MapSelectionToolbar({
  record,
  camera,
  size,
  interactionMode,
  onSetMode,
  onDelete,
}: MapSelectionToolbarProps) {
  const { t } = useLocalization();
  const box = boundingBoxOfPositions(positionsOf(record.geometry));
  // The same gates the Properties tab applies, for the same reason: a point
  // has no ring to reshape and no box to rotate.
  const canEditVertices = editableRingOf(record.geometry) !== null;
  const canTransform = record.geometry.type === 'Polygon';

  if (box === null || size.width === 0) {
    return null;
  }

  // Local metres grow upward, screen pixels downward, so the box's MAXIMUM y
  // is its top edge on screen.
  const anchor = toScreen([(box.minX + box.maxX) / 2, box.maxY], camera, size);
  // Kept inside the canvas: an object dragged to the edge must not take its
  // own controls out of reach with it.
  const left = Math.min(Math.max(anchor.x, 0), size.width);
  const top = Math.min(Math.max(anchor.y - OFFSET_ABOVE_PX, 0), size.height);

  const toggle = (mode: InteractionMode) => {
    onSetMode(interactionMode === mode ? 'idle' : mode);
  };

  return (
    <div
      className={styles['toolbar']}
      style={{ insetInlineStart: `${String(left)}px`, insetBlockStart: `${String(top)}px` }}
      role="toolbar"
      aria-label={t('map.selection.ariaLabel')}
    >
      <span className={styles['name']}>
        {record.label ??
          t('map.objectList.untitled', { category: t(categoryLabelKey(record.category)) })}
      </span>
      <Button
        variant="secondary"
        iconOnly
        aria-pressed={interactionMode === 'move'}
        aria-label={t('map.selection.move')}
        title={t('map.selection.move')}
        onClick={() => toggle('move')}
      >
        <CursorIcon />
      </Button>
      {canTransform && (
        <Button
          variant="secondary"
          iconOnly
          aria-pressed={interactionMode === 'transform'}
          aria-label={t('map.properties.transform')}
          title={t('map.properties.transform')}
          onClick={() => toggle('transform')}
        >
          <RulerIcon />
        </Button>
      )}
      {canEditVertices && (
        <Button
          variant="secondary"
          iconOnly
          aria-pressed={interactionMode === 'vertexEdit'}
          aria-label={t('map.properties.editVertices')}
          title={t('map.properties.editVertices')}
          onClick={() => toggle('vertexEdit')}
        >
          <TypeIcon />
        </Button>
      )}
      <Button
        variant="secondary"
        iconOnly
        aria-label={t('map.properties.delete')}
        title={t('map.properties.delete')}
        onClick={onDelete}
      >
        <TrashIcon />
      </Button>
    </div>
  );
}
