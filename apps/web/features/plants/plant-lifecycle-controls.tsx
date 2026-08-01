'use client';

import type { Plant, PlantLifecycleStage, PlantStatus } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';
import { CheckIcon } from '@/shared/ui/public';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, StatusPill } from '@/shared/ui/public';

import {
  PLANT_LIFECYCLE_STAGES,
  PLANT_STATUSES,
  lifecycleStageLabel,
  statusLabel,
  statusTone,
} from './labels';
import styles from './plant-lifecycle-controls.module.css';
import { useSetPlantStatus, useTransitionPlantLifecycleStage } from './queries';

export interface PlantLifecycleControlsProps {
  readonly gardenId: string;
  readonly plant: Plant;
}

/**
 * The plant's two independent axes: `lifecycleStage` (biological progress,
 * no enforced ordering between the eight stages) and `status`
 * (active/dormant/archived/removed/dead). Deleting is `PlantDeleteSection`'s
 * own concern now — see that component's doc comment for why it moved out
 * of this panel.
 *
 * The save-stage/save-status actions are additionally disabled while the
 * browser is offline (P5-WEB-01 follow-up), the same `disabled={!isOnline}`
 * pattern `create-manual-task-form.tsx` uses: each is a simple
 * state-transition command, not free-text input a user could lose, so a
 * disabled button is sufficient without local-draft persistence — see
 * `map-editor-commit.ts`'s own offline gate for pure state-transition
 * commands for the identical reasoning. The parent `PlantDetail` already
 * renders a `StaleIndicator`, so no second one is needed here.
 *
 * Source: packages/api-contracts/openapi.yaml, operations
 * `transitionPlantLifecycleStage`, `setPlantStatus`.
 */
export function PlantLifecycleControls({ gardenId, plant }: PlantLifecycleControlsProps) {
  const { t } = useLocalization();
  const stageMutation = useTransitionPlantLifecycleStage(gardenId, plant.id);
  const statusMutation = useSetPlantStatus(gardenId, plant.id);
  const [stage, setStage] = useState<PlantLifecycleStage>(plant.lifecycleStage);
  const [status, setStatus] = useState<PlantStatus>(plant.status);
  const isOnline = useIsOnline();

  useEffect(() => setStage(plant.lifecycleStage), [plant.lifecycleStage]);
  useEffect(() => setStatus(plant.status), [plant.status]);

  const onSaveStage = () => {
    if (stage === plant.lifecycleStage) {
      return;
    }
    stageMutation.mutate({ stage, expectedRevision: plant.revision });
  };

  const onSaveStatus = () => {
    if (status === plant.status) {
      return;
    }
    statusMutation.mutate({ status, expectedRevision: plant.revision });
  };

  return (
    <div className={styles['panel']}>
      <div className={styles['row']}>
        <Select
          label={t('plants.lifecycleStageLabel')}
          value={stage}
          onChange={(event) => setStage(event.target.value as PlantLifecycleStage)}
          options={PLANT_LIFECYCLE_STAGES.map((value) => ({
            value,
            label: t(lifecycleStageLabel(value)),
          }))}
        />
        <Button
          variant="secondary"
          busy={stageMutation.isPending}
          disabled={!isOnline}
          onClick={onSaveStage}

          iconOnly
          aria-label={t('plants.saveStage')}
          title={t('plants.saveStage')}
        >
          <CheckIcon />
        </Button>
      </div>
      {stageMutation.isError && <FailureAlert failure={stageMutation.error.failure} />}

      <div className={styles['row']}>
        <Select
          label={t('plants.statusLabel')}
          value={status}
          onChange={(event) => setStatus(event.target.value as PlantStatus)}
          options={PLANT_STATUSES.map((value) => ({ value, label: t(statusLabel(value)) }))}
        />
        <Button
          variant="secondary"
          busy={statusMutation.isPending}
          disabled={!isOnline}
          onClick={onSaveStatus}

          iconOnly
          aria-label={t('plants.saveStatus')}
          title={t('plants.saveStatus')}
        >
          <CheckIcon />
        </Button>
        <StatusPill tone={statusTone(plant.status)} label={t(statusLabel(plant.status))} />
      </div>
      {statusMutation.isError && <FailureAlert failure={statusMutation.error.failure} />}
    </div>
  );
}
