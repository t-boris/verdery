'use client';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Button, FitIcon, MapIcon, MinusIcon, PlusIcon } from '@/shared/ui/public';

import type { InteractionMode } from './editor-store';
import styles from './map-canvas.module.css';
import { MapSelectionToolbar } from './map-selection-toolbar';
import type { CanvasSize, MapCamera, MapObjectRecord } from './types';

export interface MapCanvasChromeProps {
  /** The drawing hint, already resolved to a message, or `null` when no tool is asking for one. */
  readonly hint: string | null;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly selectedRecord: MapObjectRecord | null;
  readonly interactionMode: InteractionMode;
  readonly onSetInteractionMode: (mode: InteractionMode) => void;
  readonly onDeleteSelected: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomFit: () => void;
  readonly onResetToAddress: (() => void) | null;
}

/**
 * Everything drawn OVER the Konva stage in ordinary DOM: the drawing hint, the
 * zoom cluster, and the selected object's own controls.
 *
 * Split out of `map-canvas.tsx` because that file passed the repository's
 * 600-line limit once the canvas became the workspace. The division is by
 * substance rather than by line count: this is the chrome a person points at,
 * and the stage is the surface they draw on.
 *
 * Placed here rather than in `map-editor.tsx` with the other floating clusters
 * because every control in it needs the stage's own measured size and camera,
 * which nothing outside the canvas knows.
 */
export function MapCanvasChrome({
  hint,
  camera,
  size,
  selectedRecord,
  interactionMode,
  onSetInteractionMode,
  onDeleteSelected,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onResetToAddress,
}: MapCanvasChromeProps) {
  const { t } = useLocalization();

  return (
    <>
      {hint !== null && (
        <p className={styles['hint']} role="status">
          {hint}
        </p>
      )}
      {/* The selected object's own controls, at the object. See
          `map-selection-toolbar.tsx` for why they are not only in the panel. */}
      {selectedRecord !== null && (
        <MapSelectionToolbar
          record={selectedRecord}
          camera={camera}
          size={size}
          interactionMode={interactionMode}
          onSetMode={onSetInteractionMode}
          onDelete={onDeleteSelected}
        />
      )}
      <div
        className={styles['zoomControls']}
        role="group"
        aria-label={t('map.canvas.zoomControlsLabel')}
      >
        {(
          [
            { key: 'map.canvas.zoomIn', icon: <PlusIcon />, onClick: onZoomIn },
            { key: 'map.canvas.zoomOut', icon: <MinusIcon />, onClick: onZoomOut },
            { key: 'map.canvas.zoomFit', icon: <FitIcon />, onClick: onZoomFit },
            ...(onResetToAddress === null
              ? []
              : [
                  {
                    key: 'map.canvas.resetToAddress' as const,
                    icon: <MapIcon />,
                    onClick: onResetToAddress,
                  },
                ]),
          ] as const satisfies readonly {
            key: MessageKey;
            icon: React.ReactNode;
            onClick: () => void;
          }[]
        ).map((control) => (
          <Button
            key={control.key}
            variant="secondary"
            iconOnly
            aria-label={t(control.key)}
            title={t(control.key)}
            onClick={control.onClick}
          >
            {control.icon}
          </Button>
        ))}
      </div>
    </>
  );
}
