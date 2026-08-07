'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button, EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import {
  LAYER_IDS,
  LAYER_LABEL_KEY,
  isLayerHidden,
  isLayerLocked,
  layerForCategory,
  type LayerId,
} from './map-layers';
import styles from './map-layer-panel.module.css';
import type { MapEditorActions } from './use-map-editor-actions';
import { creatableCategoryOfTool } from './types';

export interface MapLayerPanelProps {
  readonly actions: MapEditorActions;
}

/**
 * Visibility and lock toggles for layers 2–5 of the layer model
 * (`map-layers.ts`; architecture doc section "12. Layer Model"). Hiding a
 * layer filters it out of both the canvas (`map-canvas.tsx`) and the
 * accessible object list (`map-object-list.tsx`) — the two must always agree
 * on what is visible, or a screen-reader user and a sighted user see
 * different content. Locking a layer blocks selecting, dragging,
 * vertex-editing, resizing/rotating, and deleting any object in it —
 * enforced centrally in `map-editor-commit.ts`'s `useCommandCommit` for every
 * command that targets an existing object, plus at the canvas and object-list
 * selection entry points so a locked object is never even offered as
 * selectable in the first place.
 *
 * `aria-pressed` plus a text label that itself changes ("Show"/"Hide",
 * "Lock"/"Unlock") carries each toggle's state, not color alone — the same
 * pattern `map-toolbar.tsx`'s tool buttons already use.
 *
 * State lives in `editor-store.tsx`'s `EditorState` as a client-only
 * preference — no command, no server round trip, resets to
 * all-visible/all-unlocked on reload — see that file's doc comment on
 * `hiddenLayers`/`lockedLayers`.
 */
export function MapLayerPanel({ actions }: MapLayerPanelProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const { hiddenLayers, lockedLayers, selectedObjectId, multiSelectedObjectIds } = store.state;

  /**
   * Locking a layer that currently has selected objects immediately clears
   * them out of selection — otherwise the property panel, and its Delete /
   * Edit Vertices / Transform controls, would keep operating on an object
   * this same action just declared off-limits until the user happened to
   * deselect it another way.
   */
  const handleToggleLock = (layer: LayerId) => {
    const aboutToLock = !isLayerLocked(layer, lockedLayers);
    if (aboutToLock) {
      const creatingCategory = creatableCategoryOfTool(store.state.tool);
      if (creatingCategory !== null && layerForCategory(creatingCategory) === layer) {
        store.setTool('select');
      }
      if (selectedObjectId !== null) {
        const selected = actions.findRecord(selectedObjectId);
        if (selected !== null && layerForCategory(selected.category) === layer) {
          store.select(null);
        }
      }
      for (const objectId of multiSelectedObjectIds) {
        const record = actions.findRecord(objectId);
        if (record !== null && layerForCategory(record.category) === layer) {
          store.toggleMultiSelect(objectId);
        }
      }
    }
    store.toggleLayerLock(layer);
  };

  return (
    <div className={styles['panel']}>
      <h2 className={styles['title']}>{t('map.layers.title')}</h2>
      <ul className={styles['list']}>
        {LAYER_IDS.map((layer) => {
          const hidden = isLayerHidden(layer, hiddenLayers);
          const locked = isLayerLocked(layer, lockedLayers);
          const label = t(LAYER_LABEL_KEY[layer]);
          return (
            <li key={layer} className={styles['row']}>
              <span className={styles['label']}>{label}</span>
              <div className={styles['actions']}>
                <Button
                  type="button"
                  variant="secondary"
                  aria-pressed={!hidden}
                  aria-label={t(hidden ? 'map.layers.showAriaLabel' : 'map.layers.hideAriaLabel', {
                    layer: label,
                  })}
                  title={t(hidden ? 'map.layers.show' : 'map.layers.hide')}
                  onClick={() => store.toggleLayerVisibility(layer)}
                >
                  {hidden ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  aria-pressed={locked}
                  aria-label={t(
                    locked ? 'map.layers.unlockAriaLabel' : 'map.layers.lockAriaLabel',
                    {
                      layer: label,
                    },
                  )}
                  title={t(locked ? 'map.layers.unlock' : 'map.layers.lock')}
                  onClick={() => handleToggleLock(layer)}
                >
                  {locked ? <LockIcon /> : <UnlockIcon />}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
