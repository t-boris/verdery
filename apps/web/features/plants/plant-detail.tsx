'use client';

import type { PlantIdentificationSuggestion } from '@verdery/api-contracts';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import { groupingKindLabel, lifecycleStageLabel, statusLabel, statusTone } from './labels';
import styles from './plant-detail.module.css';
import { PlantDetailsForm } from './plant-details-form';
import { PlantLifecycleControls } from './plant-lifecycle-controls';
import { PlantMoveForm } from './plant-move-form';
import { useConfirmPlantIdentification, usePlant, usePlantIdentification } from './queries';

export interface PlantDetailProps {
  readonly gardenId: string;
  readonly plantId: string;
}

/** Scientific name, with the common name parenthesized when known — mirrors `add-plant-from-photo-panel.tsx`'s own (unexported) identical helper. */
function suggestionLabel(suggestion: PlantIdentificationSuggestion): string {
  return suggestion.commonName === null
    ? suggestion.scientificName
    : `${suggestion.scientificName} (${suggestion.commonName})`;
}

/** The AI's own raw name guess, when it was confident but the catalog had no match for it — mirrors `suggestionLabel`'s own "scientific name, common name parenthesized" convention, and `add-plant-from-photo-panel.tsx`'s own identical (unexported) helper. */
function rawSuggestionLabel(commonName: string, scientificName: string | null): string {
  return scientificName === null ? commonName : `${scientificName} (${commonName})`;
}

/**
 * A single plant: its current facts, and every command this phase wires
 * against it.
 *
 * Photo attachment (`AttachPlantPhoto`/`SetPrimaryPlantPhoto`) is still
 * omitted from this UI — each needs a real `media` record wired to a plant,
 * a separate follow-up not built in this pass, see
 * `docs/development/deferred-capabilities.md`. Photo identification
 * (`AddPlantFromPhoto`) and its confirmation (`ConfirmPlantIdentification`)
 * are no longer part of that gap: `add-plant-from-photo-panel.tsx`
 * (ADR-0015) creates a plant from a photo, and this screen's own pending-
 * identification banner below lets a suggestion left unconfirmed there be
 * reviewed and accepted later.
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getPlant`; ADR-0015.
 */
export function PlantDetail({ gardenId, plantId }: PlantDetailProps) {
  const { t } = useLocalization();
  const query = usePlant(gardenId, plantId);
  const identification = usePlantIdentification(gardenId, plantId);
  const confirmIdentification = useConfirmPlantIdentification(gardenId);

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
  const pendingSuggestion = identification.data?.suggestedTaxonomy ?? null;
  const rawSuggestedCommonName = identification.data?.suggestedCommonName ?? null;
  const hasConfirmableSuggestion = pendingSuggestion !== null || rawSuggestedCommonName !== null;

  const onConfirmPending = () => {
    if (identification.data === null || identification.data === undefined || !hasConfirmableSuggestion) {
      return;
    }
    confirmIdentification.mutate({
      plantId: plant.id,
      identificationId: identification.data.id,
      expectedRevision: plant.revision,
    });
  };

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

      {hasConfirmableSuggestion && identification.data !== null && identification.data !== undefined && (
        <Alert tone="info" title={t('plants.identificationPendingBanner')}>
          <p>
            {pendingSuggestion !== null
              ? suggestionLabel(pendingSuggestion)
              : rawSuggestionLabel(rawSuggestedCommonName as string, identification.data.suggestedScientificName)}
          </p>
          {pendingSuggestion === null && <p>{t('plants.identificationUnlistedNote')}</p>}
          <p>
            {`${t('plants.identificationConfidenceLabel')}: ${t('plants.identificationConfidenceValue', { percent: Math.round(identification.data.confidenceScore * 100) })}`}
          </p>
          <Button variant="primary" busy={confirmIdentification.isPending} onClick={onConfirmPending}>
            {t('plants.identificationConfirm')}
          </Button>
          {confirmIdentification.isError && (
            <FailureAlert failure={confirmIdentification.error.failure} />
          )}
        </Alert>
      )}

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
