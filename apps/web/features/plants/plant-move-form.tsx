'use client';

import type { MovePlantRequest, Plant } from '@verdery/api-contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextField } from '@/shared/ui/public';

import styles from './plant-move-form.module.css';
import { useMovePlant } from './queries';

export interface PlantMoveFormProps {
  readonly gardenId: string;
  readonly plant: Plant;
}

/**
 * `MovePlantRequest`'s two placement fields as plain map-object-id text
 * fields — the same documented picker fallback `add-plant-form.tsx` uses,
 * for the same dependency-rule reason (see that file's doc comment). Unlike
 * `UpdatePlantDetailsRequest`, neither field here is nullable on the wire,
 * so a blank field is omitted from the request rather than sent as an
 * explicit `null` — there is no "clear the placement" affordance in this
 * command.
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

  useEffect(
    () => setGardenAreaMapObjectId(plant.gardenAreaMapObjectId ?? ''),
    [plant.gardenAreaMapObjectId],
  );
  useEffect(
    () => setPlacementMapObjectId(plant.placementMapObjectId ?? ''),
    [plant.placementMapObjectId],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input: MovePlantRequest = {
      ...(gardenAreaMapObjectId.trim() === ''
        ? {}
        : { gardenAreaMapObjectId: gardenAreaMapObjectId.trim() }),
      ...(placementMapObjectId.trim() === ''
        ? {}
        : { placementMapObjectId: placementMapObjectId.trim() }),
    };
    mutation.mutate({ input, expectedRevision: plant.revision });
  };

  return (
    <form className={styles['form']} onSubmit={onSubmit} noValidate>
      <TextField
        label={t('plants.gardenAreaMapObjectIdLabel')}
        value={gardenAreaMapObjectId}
        onChange={(event) => setGardenAreaMapObjectId(event.target.value)}
      />
      <TextField
        label={t('plants.placementMapObjectIdLabel')}
        value={placementMapObjectId}
        onChange={(event) => setPlacementMapObjectId(event.target.value)}
      />
      <p className={styles['hint']}>{t('plants.mapObjectIdHint')}</p>
      <Button type="submit" variant="secondary" busy={mutation.isPending} disabled={!isOnline}>
        {t('plants.move')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      {mutation.isSuccess && <p role="status">{t('plants.moved')}</p>}
    </form>
  );
}
