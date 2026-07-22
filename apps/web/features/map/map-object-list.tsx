'use client';

import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { classNames } from '@/shared/ui/public';

import { categoryLabelKey } from './labels';
import styles from './map-object-list.module.css';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

export interface MapObjectListProps {
  readonly actions: MapEditorActions;
  readonly selectedObjectId: string | null;
  readonly onSelect: (objectId: string) => void;
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
 * Source: architecture/map-rendering-and-editing.md, section "19. Accessibility".
 */
export function MapObjectList({ actions, selectedObjectId, onSelect }: MapObjectListProps) {
  const { t } = useLocalization();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
            onSelect={() => onSelect(record.id)}
            onDelete={() => void actions.deleteObject(record.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          />
        ))}
      </ul>
    </div>
  );
}

interface ObjectListRowProps {
  readonly record: MapObjectRecord;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onDelete: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly ref: (node: HTMLButtonElement | null) => void;
}

function ObjectListRow({
  record,
  selected,
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
        className={classNames(styles['itemButton'], selected && styles['itemButtonSelected'])}
        aria-current={selected || undefined}
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
