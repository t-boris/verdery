'use client';

import type { GardenObjectDetails } from '@verdery/geometry-contracts';
import { useState, type FormEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, TextField } from '@/shared/ui/public';

import { CategoryDetailFields } from './category-detail-fields';
import { categoryLabelKey } from './labels';
import styles from './map-property-panel.module.css';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

export interface MapPropertyPanelProps {
  readonly actions: MapEditorActions;
  readonly selectedRecord: MapObjectRecord | null;
}

/**
 * Reads and edits the selected object's canonical draft: label (every
 * category) and category-specific details (`category-detail-fields.tsx`).
 *
 * Source: architecture/map-rendering-and-editing.md, section
 * "18. Selection and Properties" ("The property panel reads the canonical
 * object draft and exposes semantic fields").
 */
export function MapPropertyPanel({ actions, selectedRecord }: MapPropertyPanelProps) {
  const { t } = useLocalization();

  if (selectedRecord === null) {
    return (
      <div className={styles['panel']}>
        <h2 className={styles['title']}>{t('map.properties.title')}</h2>
        <p className={styles['empty']}>{t('map.properties.emptyState')}</p>
      </div>
    );
  }

  // `key` remounts the form whenever the selection changes, so its local
  // edit-in-progress state (`label`, `details`) always starts fresh from the
  // newly selected object instead of carrying over the previous one's edits.
  return <PropertyForm key={selectedRecord.id} actions={actions} record={selectedRecord} />;
}

function PropertyForm({
  actions,
  record,
}: {
  readonly actions: MapEditorActions;
  readonly record: MapObjectRecord;
}) {
  const { t } = useLocalization();
  const [label, setLabel] = useState(record.label ?? '');
  const [details, setDetails] = useState<GardenObjectDetails | undefined>(record.categoryDetails);
  const [saving, setSaving] = useState(false);

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    await actions.changeProperties(
      record.id,
      label.trim() === '' ? undefined : label.trim(),
      details,
    );
    setSaving(false);
  };

  const onDelete = () => {
    if (globalThis.confirm(t('map.properties.deleteConfirm'))) {
      void actions.deleteObject(record.id);
    }
  };

  return (
    <div className={styles['panel']}>
      <h2 className={styles['title']}>{t('map.properties.title')}</h2>
      <form className={styles['form']} onSubmit={(event) => void onSave(event)} noValidate>
        <p className={styles['meta']}>
          {t(categoryLabelKey(record.category))} ·{' '}
          {t('map.properties.revision', { revision: record.revision })}
        </p>
        <TextField
          label={t('map.properties.label')}
          maxLength={200}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <CategoryDetailFields category={record.category} details={details} onChange={setDetails} />
        <div className={styles['actions']}>
          <Button type="submit" variant="primary" busy={saving || actions.isSubmitting}>
            {t('map.properties.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onDelete}>
            {t('map.properties.delete')}
          </Button>
        </div>
      </form>
    </div>
  );
}
