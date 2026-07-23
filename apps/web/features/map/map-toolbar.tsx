'use client';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import { GateCreationPrompt } from './gate-creation-prompt';
import styles from './map-toolbar.module.css';
import {
  CREATABLE_CATEGORIES,
  CREATABLE_GEOMETRY_KIND,
  createToolMode,
  creatableCategoryOfTool,
} from './types';
import type { CreatableCategory } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

const TOOL_LABEL_KEY: Readonly<Record<CreatableCategory, MessageKey>> = {
  lot: 'map.toolbar.createLot',
  structure: 'map.toolbar.createStructure',
  fence: 'map.toolbar.createFence',
  gate: 'map.toolbar.createGate',
  path: 'map.toolbar.createPath',
  zone: 'map.toolbar.createZone',
  bed: 'map.toolbar.createBed',
  waterFeature: 'map.toolbar.createWaterFeature',
  utilityExclusion: 'map.toolbar.createUtilityExclusion',
  tree: 'map.toolbar.createTree',
  plant: 'map.toolbar.createPlant',
  annotation: 'map.toolbar.createAnnotation',
};

export interface MapToolbarProps {
  readonly actions: MapEditorActions;
}

/**
 * Tool selection, the draft finish/cancel controls, the gate fence-pick
 * prompt, and undo/redo.
 *
 * `aria-pressed` marks the active tool, not colour alone — the `Button`
 * primitive's primary/secondary variants already differ in more than hue,
 * but the pressed state is exposed to assistive technology explicitly here
 * regardless.
 */
export function MapToolbar({ actions }: MapToolbarProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const tool = store.state.tool;
  const creatingCategory = creatableCategoryOfTool(tool);
  const draftKind = creatingCategory === null ? null : CREATABLE_GEOMETRY_KIND[creatingCategory];
  const isDrafting = draftKind === 'polygon' || draftKind === 'line';
  const minimumDraftPoints = draftKind === 'polygon' ? 3 : 2;

  const hasFence = actions.records.some((record) => record.category === 'fence');

  return (
    <div className={styles['toolbar']}>
      <div className={styles['group']} role="group" aria-label={t('map.toolbar.groupLabel')}>
        <Button
          variant={tool === 'select' ? 'primary' : 'secondary'}
          aria-pressed={tool === 'select'}
          onClick={() => store.setTool('select')}
        >
          {t('map.toolbar.select')}
        </Button>
        {CREATABLE_CATEGORIES.map((category) => {
          const categoryTool = createToolMode(category);
          // A gate needs an existing fence to attach to — see
          // `GateDetails.fenceObjectId`'s doc comment in `object-category.ts`.
          const disabled = category === 'gate' && !hasFence;
          // `exactOptionalPropertyTypes` forbids `title={undefined}` — see
          // the same comment in `shapes/polygon-shape.tsx` — so the
          // tooltip prop is omitted entirely rather than set to `undefined`.
          const titleProp = disabled ? { title: t('map.toolbar.gateNeedsFence') } : {};
          return (
            <Button
              key={category}
              variant={tool === categoryTool ? 'primary' : 'secondary'}
              aria-pressed={tool === categoryTool}
              disabled={disabled}
              onClick={() => store.setTool(categoryTool)}
              {...titleProp}
            >
              {t(TOOL_LABEL_KEY[category])}
            </Button>
          );
        })}
      </div>

      {isDrafting && (
        <div className={styles['group']}>
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

      <div className={styles['group']} role="group" aria-label={t('map.history.title')}>
        <Button
          variant="secondary"
          busy={actions.isSubmitting}
          disabled={!actions.canUndo}
          onClick={() => void actions.undo()}
        >
          {t('map.toolbar.undo')}
        </Button>
        <Button
          variant="secondary"
          busy={actions.isSubmitting}
          disabled={!actions.canRedo}
          onClick={() => void actions.redo()}
        >
          {t('map.toolbar.redo')}
        </Button>
      </div>
    </div>
  );
}
