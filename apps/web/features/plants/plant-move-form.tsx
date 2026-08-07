'use client';

import type { MovePlantRequest, Plant } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { FailureAlert, MapIcon } from '@/shared/ui/public';

import { useGardenMapObjects } from './map-object-queries';
import styles from './plant-move-form.module.css';
import { useMovePlant } from './queries';

export interface PlantMoveFormProps {
  readonly gardenId: string;
  readonly plant: Plant;
}

/**
 * `MovePlantRequest`'s two placement fields as `Select`s populated by
 * `useGardenMapObjects` — see `add-plant-form.tsx`'s identical doc comment
 * for why that hook is built directly on `core/api` rather than importing
 * `features/map`. Unlike `UpdatePlantDetailsRequest`, neither field here is
 * nullable on the wire, so a blank field is omitted from the request rather
 * than sent as an explicit `null` — there is no "clear the placement"
 * affordance in this command.
 *
 * Submission is additionally disabled while the browser is offline
 * (P5-WEB-01 follow-up), the same `disabled={!isOnline}` pattern
 * `create-manual-task-form.tsx` uses: this is a simple state-transition
 * command over two id fields, not free-text input a user could lose, so a
 * disabled button is sufficient without local-draft persistence — see
 * `map-editor-commit.ts`'s own offline gate for pure state-transition
 * commands for the identical reasoning. The parent `PlantDetail` already
 * renders a `StaleIndicator`, so no second one is needed here.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `movePlant`.
 */
export function PlantMoveForm({ gardenId, plant }: PlantMoveFormProps) {
  const { t } = useLocalization();
  const mutation = useMovePlant(gardenId, plant.id);
  const isOnline = useIsOnline();
  const [gardenAreaMapObjectId, setGardenAreaMapObjectId] = useState(
    plant.gardenAreaMapObjectId ?? '',
  );
  const [placementMapObjectId, setPlacementMapObjectId] = useState(
    plant.placementMapObjectId ?? '',
  );
  const mapObjectsQuery = useGardenMapObjects(gardenId);
  const mapObjectOptions = [
    { value: '', label: t('plants.mapObjectNone') },
    ...(mapObjectsQuery.data ?? []).map((object) => ({
      value: object.id,
      label: object.label ? `${object.label} (${object.category})` : object.category,
    })),
  ];

  useEffect(
    () => setGardenAreaMapObjectId(plant.gardenAreaMapObjectId ?? ''),
    [plant.gardenAreaMapObjectId],
  );
  useEffect(
    () => setPlacementMapObjectId(plant.placementMapObjectId ?? ''),
    [plant.placementMapObjectId],
  );

  const applyMove = (nextAreaId: string, nextPlacementId: string) => {
    if (!isOnline || mutation.isPending) return;
    const input: MovePlantRequest = {
      ...(nextAreaId.trim() === '' ? {} : { gardenAreaMapObjectId: nextAreaId.trim() }),
      ...(nextPlacementId.trim() === '' ? {} : { placementMapObjectId: nextPlacementId.trim() }),
    };
    mutation.mutate({ input, expectedRevision: plant.revision });
  };

  const optionLabel = (value: string) =>
    mapObjectOptions.find((option) => option.value === value)?.label ?? t('plants.mapObjectNone');

  return (
    <div className={styles['board']}>
      <details className={styles['property']}>
        <summary>
          <span className={styles['propertyLabel']}>
            <MapIcon />
            {t('plants.gardenAreaMapObjectIdLabel')}
          </span>
          <strong>{optionLabel(gardenAreaMapObjectId)}</strong>
        </summary>
        <div className={styles['choices']}>
          {mapObjectOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles['choice']}
              aria-pressed={option.value === gardenAreaMapObjectId}
              disabled={!isOnline || mutation.isPending}
              onClick={() => {
                setGardenAreaMapObjectId(option.value);
                applyMove(option.value, placementMapObjectId);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </details>
      <details className={styles['property']}>
        <summary>
          <span className={styles['propertyLabel']}>
            <MapIcon />
            {t('plants.placementMapObjectIdLabel')}
          </span>
          <strong>{optionLabel(placementMapObjectId)}</strong>
        </summary>
        <div className={styles['choices']}>
          {mapObjectOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles['choice']}
              aria-pressed={option.value === placementMapObjectId}
              disabled={!isOnline || mutation.isPending}
              onClick={() => {
                setPlacementMapObjectId(option.value);
                applyMove(gardenAreaMapObjectId, option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </details>
      <p className={styles['hint']}>
        {mutation.isPending ? t('plants.placementSaving') : t('plants.mapObjectIdHint')}
      </p>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {mutation.isSuccess && <p role="status">{t('plants.moved')}</p>}
    </div>
  );
}
