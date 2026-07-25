'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

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
 * needs a real `media` record. A working upload flow now exists
 * (`features/media`, P6-WEB-01) and is wired to garden photos, but not yet
 * to a plant — that reuse is a real, separate follow-up, not built in this
 * pass. A disabled or always-failing control would be a silently-broken UI,
 * so this pass still surfaces the gap as a plain, honest notice instead.
 * See `docs/development/deferred-capabilities.md`.
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

  // `isLoadingError`: a failed first load, with no cached data to fall back
  // to — the full failure state is all there is to show. A failed
  // background refetch (`isRefetchError`) instead falls through below,
  // `query.data` still holding the last successful result, per architecture
  // doc section "9. Online-First Behavior" ("Existing loaded data remains
  // visible with a stale indicator").
  if (query.isLoadingError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  const plant = query.data;

  return (
    <div className={styles['page']}>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      <div className={styles['summary']}>
        {/* The plant's own name is this page's `<h1>`: the route renders no
            other top-level heading, so without it the page's `<h2>` sections
            hung off nothing and a screen-reader user landed on a document
            with no title of its own. */}
        <h1 className={styles['name']}>{plant.displayName}</h1>
        <StatusPill tone={statusTone(plant.status)} label={t(statusLabel(plant.status))} />
        <span>{t(lifecycleStageLabel(plant.lifecycleStage))}</span>
        <span>{t(groupingKindLabel(plant.groupingKind))}</span>
        {plant.quantity !== null && (
          <span>{t('plants.quantityDisplay', { quantity: plant.quantity })}</span>
        )}
        {plant.taxonomyReferenceId === null && <span>{t('plants.taxonomyNone')}</span>}
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
