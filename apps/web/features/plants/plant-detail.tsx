'use client';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Card, FailureAlert, StatusPill } from '@/shared/ui/public';

import { groupingKindLabel, lifecycleStageLabel, statusLabel, statusTone } from './labels';
import styles from './plant-detail.module.css';
import { PlantDetailsForm } from './plant-details-form';
import { PlantLifecycleControls } from './plant-lifecycle-controls';
import { PlantMoveForm } from './plant-move-form';
import { usePlant } from './queries';

export interface PlantDetailProps {
  readonly gardenId: string;
  readonly plantId: string;
}

/**
 * A single plant: its current facts, and every command this phase wires
 * against it.
 *
 * Photo identification (`AddPlantFromPhoto`), photo attachment
 * (`AttachPlantPhoto`/`SetPrimaryPlantPhoto`), and identification
 * confirmation (`ConfirmPlantIdentification`) are omitted from this UI: each
 * needs a real `media` record, and this codebase has no upload flow yet —
 * `media.media_record` only records that a file reference exists. A
 * disabled or always-failing control would be a silently-broken UI, so this
 * pass surfaces the gap as a plain, honest notice instead. See
 * `docs/development/deferred-capabilities.md`.
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getPlant`.
 */
export function PlantDetail({ gardenId, plantId }: PlantDetailProps) {
  const { t } = useLocalization();
  const query = usePlant(gardenId, plantId);

  if (query.isPending) {
    return <p role="status">{t('plants.loading')}</p>;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  const plant = query.data;

  return (
    <div className={styles['page']}>
      <div className={styles['summary']}>
        <h2 className={styles['name']}>{plant.displayName}</h2>
        <StatusPill tone={statusTone(plant.status)} label={t(statusLabel(plant.status))} />
        <span>{t(lifecycleStageLabel(plant.lifecycleStage))}</span>
        <span>{t(groupingKindLabel(plant.groupingKind))}</span>
        {plant.quantity !== null && (
          <span>{t('plants.quantityDisplay', { quantity: plant.quantity })}</span>
        )}
      </div>

      <Alert tone="info" title={t('plants.mediaGapTitle')}>
        <p>{t('plants.mediaGapDescription')}</p>
      </Alert>

      <Card title={t('plants.editTitle')}>
        <PlantDetailsForm gardenId={gardenId} plant={plant} />
      </Card>

      <Card title={t('plants.lifecycleTitle')}>
        <PlantLifecycleControls gardenId={gardenId} plant={plant} />
      </Card>

      <Card title={t('plants.moveTitle')}>
        <PlantMoveForm gardenId={gardenId} plant={plant} />
      </Card>
    </div>
  );
}
