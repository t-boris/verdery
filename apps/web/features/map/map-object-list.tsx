'use client';

import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, classNames } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import { categoryLabelKey } from './labels';
import styles from './map-object-list.module.css';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

export interface MapObjectListProps {
  readonly actions: MapEditorActions;
  readonly selectedObjectId: string | null;
  readonly onSelect: (objectId: string) => void;
}

/** True for the two categories `joinLinework` accepts — see `use-map-editor-linework-actions.ts`. */
function isJoinable(category: MapObjectRecord['category']): boolean {
  return category === 'fence' || category === 'path';
}

/**
 * A structured HTML list of every object — the accessible alternative to
 * clicking a shape on the canvas, not a decorative sidebar. Every object is
 * listed regardless of category, matching the canvas's own "every category
 * renders" scope.
 *
 * Keyboard: Tab reaches the list; ArrowUp/ArrowDown move focus *and*
 * selection together (a roving-focus listbox-like pattern, not plain tab
 * order, so "arrow-key selection" is literal); Enter/Space activate the
 * focused row's own button, which selects it — the property panel is always
 * mounted and simply starts reflecting the new selection; Delete/Backspace
 * deletes the row that has focus.
 *
 * Shift-click toggles a row into a separate multi-select set (independent
 * of the single `selectedObjectId` the property panel and canvas track),
 * used only for the fence/path "Join" action below the list — the
 * lightest-weight multi-select affordance that satisfies `joinLinework`
 * needing exactly two same-category objects, not a general multi-select
 * feature.
 *
 * Source: architecture/map-rendering-and-editing.md, section "19. Accessibility".
 */
export function MapObjectList({ actions, selectedObjectId, onSelect }: MapObjectListProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const multiSelected = store.state.multiSelectedObjectIds;

  if (actions.records.length === 0) {
    return (
      <div className={styles['panel']}>
        <h2 className={styles['title']}>{t('map.objectList.title')}</h2>
        <p className={styles['empty']}>{t('map.objectList.empty')}</p>
      </div>
    );
  }

  const focusAndSelect = (index: number) => {
    const record = actions.records[index];
    const button = itemRefs.current[index];
    if (record === undefined || button === undefined || button === null) {
      return;
    }
    button.focus();
    onSelect(record.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAndSelect(Math.min(index + 1, actions.records.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAndSelect(Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const record = actions.records[index];
      if (record !== undefined) {
        void actions.deleteObject(record.id);
      }
    }
  };

  const [firstId, secondId] = multiSelected;
  const first = firstId === undefined ? null : actions.findRecord(firstId);
  const second = secondId === undefined ? null : actions.findRecord(secondId);
  const canJoin =
    multiSelected.length === 2 &&
    first !== null &&
    second !== null &&
    isJoinable(first.category) &&
    first.category === second.category;

  return (
    <div className={styles['panel']}>
      <h2 className={styles['title']}>{t('map.objectList.title')}</h2>
      <ul className={styles['list']}>
        {actions.records.map((record, index) => (
          <ObjectListRow
            key={record.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            record={record}
            selected={record.id === selectedObjectId}
            multiSelected={multiSelected.includes(record.id)}
            onSelect={(event) => {
              if (event.shiftKey) {
                store.toggleMultiSelect(record.id);
                return;
              }
              onSelect(record.id);
            }}
            onDelete={() => void actions.deleteObject(record.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          />
        ))}
      </ul>
      {multiSelected.length > 0 && (
        <div className={styles['joinBar']}>
          <span className={styles['empty']}>
            {t('map.objectList.multiSelectedCount', { count: multiSelected.length })}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={!canJoin}
            busy={actions.isSubmitting}
            onClick={() => {
              if (firstId !== undefined && secondId !== undefined) {
                void actions.joinLinework(firstId, secondId);
              }
            }}
          >
            {t('map.objectList.join')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => store.clearMultiSelect()}>
            {t('map.objectList.clearSelection')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface ObjectListRowProps {
  readonly record: MapObjectRecord;
  readonly selected: boolean;
  readonly multiSelected: boolean;
  readonly onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onDelete: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly ref: (node: HTMLButtonElement | null) => void;
}

function ObjectListRow({
  record,
  selected,
  multiSelected,
  onSelect,
  onDelete,
  onKeyDown,
  ref,
}: ObjectListRowProps) {
  const { t } = useLocalization();
  const categoryLabel = t(categoryLabelKey(record.category));
  const label = record.label ?? t('map.objectList.untitled', { category: categoryLabel });

  return (
    <li className={styles['item']}>
      <button
        ref={ref}
        type="button"
        className={classNames(
          styles['itemButton'],
          selected && styles['itemButtonSelected'],
          multiSelected && styles['itemButtonMultiSelected'],
        )}
        aria-current={selected || undefined}
        aria-pressed={multiSelected}
        aria-label={t('map.objectList.selectAriaLabel', { label, category: categoryLabel })}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span className={styles['marker']} aria-hidden="true">
          {selected ? '▸' : ''}
        </span>
        <span className={styles['label']}>{label}</span>
        <span className={styles['category']}>{categoryLabel}</span>
      </button>
      <button
        type="button"
        className={styles['deleteButton']}
        aria-label={t('map.objectList.deleteAriaLabel', { label })}
        onClick={onDelete}
      >
        {t('map.objectList.delete')}
      </button>
    </li>
  );
}
