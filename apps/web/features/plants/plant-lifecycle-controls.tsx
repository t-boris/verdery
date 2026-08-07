'use client';

import type { Plant, PlantLifecycleStage, PlantStatus } from '@verdery/api-contracts';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, PulseIcon, SproutIcon } from '@/shared/ui/public';

import { PLANT_LIFECYCLE_STAGES, PLANT_STATUSES, lifecycleStageLabel, statusLabel } from './labels';
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
  const isOnline = useIsOnline();

  const setStage = (stage: PlantLifecycleStage) => {
    if (stage === plant.lifecycleStage || stageMutation.isPending) return;
    stageMutation.mutate({ stage, expectedRevision: plant.revision });
  };

  const setStatus = (status: PlantStatus) => {
    if (status === plant.status || statusMutation.isPending) return;
    statusMutation.mutate({ status, expectedRevision: plant.revision });
  };

  return (
    <div className={styles['board']}>
      <details className={styles['property']}>
        <summary>
          <span className={styles['propertyLabel']}>
            <SproutIcon size={16} />
            {t('plants.lifecycleStageLabel')}
          </span>
          <strong>{t(lifecycleStageLabel(plant.lifecycleStage))}</strong>
        </summary>
        <div className={styles['choices']}>
          {PLANT_LIFECYCLE_STAGES.map((value) => (
            <Button
              key={value}
              variant={value === plant.lifecycleStage ? 'primary' : 'secondary'}
              busy={stageMutation.isPending && stageMutation.variables?.stage === value}
              disabled={!isOnline || stageMutation.isPending}
              aria-pressed={value === plant.lifecycleStage}
              onClick={() => setStage(value)}
            >
              {t(lifecycleStageLabel(value))}
            </Button>
          ))}
        </div>
      </details>
      {stageMutation.isError && <FailureAlert failure={stageMutation.error.failure} />}

      <details className={styles['property']}>
        <summary>
          <span className={styles['propertyLabel']}>
            <PulseIcon size={16} />
            {t('plants.statusLabel')}
          </span>
          <strong>{t(statusLabel(plant.status))}</strong>
        </summary>
        <div className={styles['choices']}>
          {PLANT_STATUSES.map((value) => (
            <Button
              key={value}
              variant={value === plant.status ? 'primary' : 'secondary'}
              busy={statusMutation.isPending && statusMutation.variables?.status === value}
              disabled={!isOnline || statusMutation.isPending}
              aria-pressed={value === plant.status}
              onClick={() => setStatus(value)}
            >
              {t(statusLabel(value))}
            </Button>
          ))}
        </div>
      </details>
      {statusMutation.isError && <FailureAlert failure={statusMutation.error.failure} />}
    </div>
  );
}
