'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import { GateCreationPrompt } from './gate-creation-prompt';
import styles from './map-draft-controls.module.css';
import { CREATABLE_GEOMETRY_KIND, creatableCategoryOfTool } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

export interface MapDraftControlsProps {
  readonly actions: MapEditorActions;
}

/**
 * The draft finish/cancel pair and the gate fence-pick prompt, floated over
 * the canvas.
 *
 * Split out of `map-toolbar.tsx` when that became Kern's 44px icon rail: both
 * of these need a real text label, and both are transient — they exist only
 * while a shape is being drawn or a gate is waiting for its fence. Rendering
 * them over the canvas keeps them next to the work instead of in chrome the
 * user is not looking at.
 *
 * The behaviour is unchanged from the toolbar version, including the minimum
 * point count that gates `finishDraft` (3 for a polygon, 2 for a line).
 */
export function MapDraftControls({ actions }: MapDraftControlsProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const creatingCategory = creatableCategoryOfTool(store.state.tool);
  const draftKind = creatingCategory === null ? null : CREATABLE_GEOMETRY_KIND[creatingCategory];
  const isDrafting = draftKind === 'polygon' || draftKind === 'line';
  const minimumDraftPoints = draftKind === 'polygon' ? 3 : 2;

  return (
    <div className={styles['overlay']}>
      {isDrafting && (
        <div className={styles['actions']}>
          <Button
            variant="primary"
            disabled={store.state.draftPoints.length < minimumDraftPoints}
            onClick={() => void actions.finishDraft()}
          >
            {t('map.toolbar.finish')}
          </Button>
          <Button variant="secondary" onClick={actions.cancelDraft}>
            {t('map.toolbar.cancel')}
          </Button>
        </div>
      )}

      <GateCreationPrompt actions={actions} />
    </div>
  );
}
