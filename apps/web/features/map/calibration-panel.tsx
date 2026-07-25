'use client';

import { positionsOf } from '@verdery/geometry-contracts';
import { useEffect, type ChangeEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import { calibrationStateText, formatErrorMetres } from './calibration-labels';
import styles from './calibration-panel.module.css';
import {
  draftBeginControlPoint,
  draftInput,
  draftPreview,
  draftRemoveReferencePoint,
  draftRestartSegment,
  draftWithDistanceText,
  draftWithManualRotation,
  draftWithSeededPlacement,
  startCalibrationDraft,
} from './calibration-session';
import { useMapEditorStore } from './editor-store';
import type { MapEditorActions } from './use-map-editor-actions';
import { useBackgroundImage } from './use-background-image';
import { boundingBoxOfPositions } from './viewport';

export interface CalibrationPanelProps {
  readonly gardenId: string;
  readonly actions: MapEditorActions;
}

/**
 * The calibration flow's control surface (P6-PLAN-02), shown for a
 * selected imported background: start/cancel a session, enter the known
 * distance, manage control points with their per-point residuals, adjust
 * orientation, and apply — with the quality display section 16 requires
 * ("displays calibration quality and prevents false precision"): the RMS
 * error is shown as an honest ± estimate, and its absence below two
 * control points is stated instead of implied to be zero.
 *
 * The canvas half of the session (picking points, dragging the preview)
 * lives in `shapes/calibration-overlay.tsx`; both halves share one draft
 * in the editor store and the pure transitions in
 * `calibration-session.ts`.
 */
export function CalibrationPanel({ gardenId, actions }: CalibrationPanelProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();

  const record = actions.selectedRecord;
  const details =
    record?.categoryDetails?.category === 'importedBackground'
      ? record.categoryDetails.details
      : null;
  const imageState = useBackgroundImage(gardenId, details?.planMediaId ?? '');
  const pageAspectRatio =
    imageState.kind === 'ready'
      ? imageState.image.naturalHeight / imageState.image.naturalWidth
      : null;

  const draft = store.state.calibrationDraft;
  const activeDraft = record !== null && draft?.objectId === record.id ? draft : null;
  const preview =
    activeDraft !== null && pageAspectRatio !== null
      ? draftPreview(activeDraft, pageAspectRatio)
      : null;

  // With scale known but nothing pinning translation yet, seed a manual
  // placement centered on the background's current box, so the preview
  // never teleports to the local origin — see `draftWithSeededPlacement`.
  useEffect(() => {
    if (
      activeDraft === null ||
      pageAspectRatio === null ||
      record === null ||
      preview?.kind !== 'ready' ||
      activeDraft.manualAdjustment !== null ||
      activeDraft.referencePoints.length > 0
    ) {
      return;
    }
    const box = boundingBoxOfPositions(positionsOf(record.geometry));
    if (box === null) {
      return;
    }
    store.setCalibrationDraft(
      draftWithSeededPlacement(activeDraft, pageAspectRatio, [
        (box.minX + box.maxX) / 2,
        (box.minY + box.maxY) / 2,
      ]),
    );
  }, [activeDraft, pageAspectRatio, preview, record, store]);

  if (record === null || details === null) {
    return null;
  }

  const calibration = details.calibration;

  if (activeDraft === null) {
    return (
      <div className={styles['panel']}>
        <h2 className={styles['title']}>{t('map.calibration.title')}</h2>
        {calibration === undefined ? (
          <p className={styles['quality']}>{t('map.background.notCalibrated')}</p>
        ) : (
          <>
            <p className={styles['quality']}>{calibrationStateText(t, calibration)}</p>
            <p className={styles['summary']}>
              {t('map.calibration.scaleSummary', {
                metres: calibration.transform.metresPerPlanUnit.toFixed(1),
              })}{' '}
              ·{' '}
              {t('map.calibration.transformRevision', { revision: calibration.transformRevision })}
            </p>
          </>
        )}
        {imageState.kind === 'unavailable' && (
          <p className={styles['notice']}>{t('map.calibration.imageUnavailable')}</p>
        )}
        <div className={styles['actions']}>
          <Button
            type="button"
            variant="secondary"
            disabled={imageState.kind !== 'ready'}
            onClick={() => store.setCalibrationDraft(startCalibrationDraft(record.id, calibration))}
          >
            {calibration === undefined ? t('map.calibration.start') : t('map.calibration.restart')}
          </Button>
        </div>
      </div>
    );
  }

  const stepKey =
    activeDraft.capture === 'segment'
      ? 'map.calibration.stepSegment'
      : activeDraft.capture === 'controlPlan'
        ? 'map.calibration.stepControlPlan'
        : activeDraft.capture === 'controlLocal'
          ? 'map.calibration.stepControlLocal'
          : preview?.kind === 'ready'
            ? 'map.calibration.stepReady'
            : 'map.calibration.stepDistance';

  const manualRotationDegrees =
    ((activeDraft.manualAdjustment?.rotationRadians ?? 0) * 180) / Math.PI;

  const apply = () => {
    if (pageAspectRatio === null) {
      return;
    }
    const input = draftInput(activeDraft, pageAspectRatio);
    if (input !== null) {
      void actions.applyCalibration(record.id, input);
    }
  };

  return (
    <div className={styles['panel']}>
      <h2 className={styles['title']}>{t('map.calibration.title')}</h2>
      <p className={styles['step']} role="status">
        {t(stepKey)}
      </p>

      <label className={styles['field']}>
        {t('map.calibration.distanceLabel')}
        <input
          className={styles['numberInput']}
          type="number"
          min={0}
          step="any"
          value={activeDraft.distanceText}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            store.setCalibrationDraft(draftWithDistanceText(activeDraft, event.target.value))
          }
        />
      </label>

      <div className={styles['actions']}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => store.setCalibrationDraft(draftRestartSegment(activeDraft))}
        >
          {t('map.calibration.repickSegment')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={activeDraft.capture === 'controlPlan' || activeDraft.capture === 'controlLocal'}
          onClick={() => store.setCalibrationDraft(draftBeginControlPoint(activeDraft))}
        >
          {t('map.calibration.addControlPoint')}
        </Button>
      </div>

      <h3 className={styles['title']}>{t('map.calibration.controlPointsTitle')}</h3>
      {activeDraft.referencePoints.length === 0 ? (
        <p className={styles['notice']}>{t('map.calibration.noControlPoints')}</p>
      ) : (
        <ul className={styles['list']}>
          {activeDraft.referencePoints.map((point, index) => {
            const residual =
              preview?.kind === 'ready'
                ? preview.derivation.pointResidualsMetres[index]
                : undefined;
            return (
              <li key={`${String(point.planPoint[0])}-${String(index)}`} className={styles['row']}>
                <span>
                  {t('map.calibration.pointResidual', {
                    index: index + 1,
                    value: residual === undefined ? '—' : `±${formatErrorMetres(residual)}`,
                  })}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    store.setCalibrationDraft(draftRemoveReferencePoint(activeDraft, index))
                  }
                >
                  {t('map.calibration.removePoint')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <label className={styles['field']}>
        {t('map.calibration.rotationLabel')}
        <input
          className={styles['numberInput']}
          type="number"
          step="any"
          value={Number(manualRotationDegrees.toFixed(1))}
          disabled={preview?.kind !== 'ready' || pageAspectRatio === null}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const degrees = Number(event.target.value);
            if (Number.isFinite(degrees) && pageAspectRatio !== null) {
              store.setCalibrationDraft(
                draftWithManualRotation(activeDraft, pageAspectRatio, (degrees * Math.PI) / 180),
              );
            }
          }}
        />
      </label>

      {preview?.kind === 'ready' && (
        <p className={styles['quality']}>
          {preview.derivation.rmsErrorMetres === null
            ? t('map.calibration.rmsUnavailable')
            : t('map.calibration.rms', {
                value: formatErrorMetres(preview.derivation.rmsErrorMetres),
              })}
        </p>
      )}
      {preview?.kind === 'invalid' && (
        <p className={styles['notice']}>{t('map.calibration.invalidInput')}</p>
      )}

      <div className={styles['actions']}>
        <Button
          type="button"
          variant="primary"
          disabled={preview?.kind !== 'ready' || actions.isSubmitting}
          onClick={apply}
        >
          {t('map.calibration.apply')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => store.setCalibrationDraft(null)}>
          {t('map.calibration.cancel')}
        </Button>
      </div>
    </div>
  );
}
