'use client';

import type { ChangeEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Select } from '@/shared/ui/public';

import { categoryLabelKey } from './labels';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

export interface PlantAssignmentFieldProps {
  readonly actions: MapEditorActions;
  readonly record: MapObjectRecord;
}

/** Sentinel `<select>` value for "no zone or bed assignment", since a native select cannot carry `null`. */
const NONE_VALUE = '';

/**
 * A plant's current zone/bed assignment
 * (`PlantPlacementDetails.assignedToObjectId`). Committed immediately
 * through the dedicated `assignPlant` command on change — not staged into
 * the property panel's Save button — because `assignPlant` is a distinct
 * command from `changeProperties` even though it changes a field that also
 * appears in `PlantPlacementDetails`. See `command.ts`'s `AssignPlantPayload`
 * and `category-detail-fields.tsx`'s `PlantFields` doc comment.
 */
export function PlantAssignmentField({ actions, record }: PlantAssignmentFieldProps) {
  const { t } = useLocalization();

  const currentTarget =
    record.categoryDetails?.category === 'plant'
      ? (record.categoryDetails.details.assignedToObjectId ?? NONE_VALUE)
      : NONE_VALUE;

  const targets = actions.records.filter(
    (candidate) => candidate.category === 'zone' || candidate.category === 'bed',
  );

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    void actions.assignPlant(record.id, value === NONE_VALUE ? null : value);
  };

  return (
    <Select
      label={t('map.properties.assignedToObjectId')}
      value={currentTarget}
      onChange={onChange}
      options={[
        { value: NONE_VALUE, label: t('map.properties.assignedToNone') },
        ...targets.map((target) => ({
          value: target.id,
          label: `${t(categoryLabelKey(target.category))}: ${target.label ?? target.id}`,
        })),
      ]}
    />
  );
}
