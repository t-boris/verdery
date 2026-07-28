'use client';

import type { CSSProperties } from 'react';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Button, CursorIcon, RedoIcon, UndoIcon } from '@/shared/ui/public';

import { styleForCategory } from './category-style';
import { useMapEditorStore } from './editor-store';
import { GateCreationPrompt } from './gate-creation-prompt';
import { categoryLabelKey } from './labels';
import { MapCategoryIcon } from './map-category-icon';
import { MapSaveStatus } from './map-save-status';
import styles from './map-toolbar.module.css';
import { CREATABLE_GEOMETRY_KIND, createToolMode, creatableCategoryOfTool } from './types';
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

const TOOL_GROUPS: readonly {
  readonly labelKey: MessageKey;
  readonly categories: readonly CreatableCategory[];
}[] = [
  {
    labelKey: 'map.toolbar.groupBoundaries',
    categories: ['lot', 'structure', 'fence', 'gate', 'path'],
  },
  {
    labelKey: 'map.toolbar.groupGarden',
    categories: ['zone', 'bed', 'waterFeature', 'utilityExclusion'],
  },
  {
    labelKey: 'map.toolbar.groupLiving',
    categories: ['tree', 'plant', 'annotation'],
  },
];

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
      <div className={styles['commandRow']}>
        <Button
          variant={tool === 'select' ? 'primary' : 'secondary'}
          aria-pressed={tool === 'select'}
          onClick={() => store.setTool('select')}
        >
          <CursorIcon />
          {t('map.toolbar.select')}
        </Button>
        <div className={styles['history']} role="group" aria-label={t('map.history.title')}>
          <Button
            variant="secondary"
            busy={actions.isSubmitting}
            disabled={!actions.canUndo}
            aria-label={t('map.toolbar.undo')}
            title={t('map.toolbar.undo')}
            onClick={() => void actions.undo()}
          >
            <UndoIcon />
          </Button>
          <Button
            variant="secondary"
            busy={actions.isSubmitting}
            disabled={!actions.canRedo}
            aria-label={t('map.toolbar.redo')}
            title={t('map.toolbar.redo')}
            onClick={() => void actions.redo()}
          >
            <RedoIcon />
          </Button>
        </div>
        <MapSaveStatus status={actions.saveStatus} />
      </div>

      <div className={styles['palette']} aria-label={t('map.toolbar.groupLabel')}>
        {TOOL_GROUPS.map((group) => (
          <div
            key={group.labelKey}
            className={styles['toolGroup']}
            role="group"
            aria-label={t(group.labelKey)}
          >
            <span className={styles['groupLabel']}>{t(group.labelKey)}</span>
            <div className={styles['tools']}>
              {group.categories.map((category) => {
                const categoryTool = createToolMode(category);
                const disabled = category === 'gate' && !hasFence;
                const title = disabled
                  ? t('map.toolbar.gateNeedsFence')
                  : t(TOOL_LABEL_KEY[category]);
                return (
                  <span
                    key={category}
                    className={styles['toolButton']}
                    style={
                      {
                        '--tool-color': styleForCategory(category).stroke,
                      } as CSSProperties
                    }
                  >
                    <Button
                      variant={tool === categoryTool ? 'primary' : 'secondary'}
                      aria-pressed={tool === categoryTool}
                      aria-label={t(TOOL_LABEL_KEY[category])}
                      title={title}
                      disabled={disabled}
                      onClick={() => store.setTool(categoryTool)}
                    >
                      <MapCategoryIcon category={category} />
                      <span>{t(categoryLabelKey(category))}</span>
                    </Button>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {isDrafting && (
        <div className={styles['draftActions']}>
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
