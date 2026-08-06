'use client';

import type { Media } from '@verdery/api-contracts';
import { useState } from 'react';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { calibrationStateText } from './calibration-labels';
import { useMapEditorStore } from './editor-store';
import styles from './imported-background-panel.module.css';
import { useDeleteGardenPlan, useGardenPlanMediaList } from './media-queries';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

export interface ImportedBackgroundPanelProps {
  readonly gardenId: string;
  readonly actions: MapEditorActions;
}

const PDF_CONTENT_TYPE = 'application/pdf';

function isPdf(media: Media): boolean {
  return (media.verifiedContentType ?? media.declaredContentType) === PDF_CONTENT_TYPE;
}

/** A plan the map can place: fully uploaded and validated — the same gate the server's own `planMediaId` validation enforces. */
function isPlaceable(media: Media): boolean {
  return media.uploadState === 'available' && media.processingState === 'processed';
}

function backgroundsOf(records: readonly MapObjectRecord[]): readonly MapObjectRecord[] {
  return records.filter((record) => record.category === 'importedBackground');
}

/**
 * Plan-background management (P6-PLAN-01): lists the garden's uploaded
 * `imported_plan` documents (`ListGardenMedia`), places one on the map as
 * an `importedBackground` object (uncalibrated, at its placeholder
 * placement — see `commands.ts#placeholderBackgroundGeometry`), and manages
 * existing backgrounds: the per-background persisted visibility toggle
 * ("independently hideable") and removal. Page selection appears for a PDF
 * source only, with the honest note that PDF pages cannot render yet
 * (P6-WORKER-02's documented deferral).
 *
 * Offline behavior follows this feature's own convention: commands flow
 * through `useCommandCommit`'s central offline gate rather than each button
 * disabling itself (see `map-editor-commit.ts`); the media LIST — a query,
 * not a command — layers `StaleIndicator` over the last-loaded data the
 * same way `map-editor.tsx` does for the map document itself.
 */
export function ImportedBackgroundPanel({ gardenId, actions }: ImportedBackgroundPanelProps) {
  const { t, locale } = useLocalization();
  const store = useMapEditorStore();
  const listQuery = useGardenPlanMediaList(gardenId);
  const deletePlan = useDeleteGardenPlan(gardenId);
  const [pageByMediaId, setPageByMediaId] = useState<Record<string, string>>({});

  const backgrounds = backgroundsOf(actions.records);
  const plans = (listQuery.data?.items ?? []).filter(isPlaceable);

  /** Section 16's honest state/quality text — mirrors the canvas badge. */
  const stateLabel = (record: MapObjectRecord): string =>
    calibrationStateText(
      t,
      locale,
      record.categoryDetails?.category === 'importedBackground'
        ? record.categoryDetails.details.calibration
        : undefined,
    );

  const addBackground = (plan: Media) => {
    const rawPage = pageByMediaId[plan.id]?.trim() ?? '';
    const parsedPage = Number(rawPage);
    const sourcePageNumber =
      isPdf(plan) && rawPage !== '' && Number.isInteger(parsedPage) && parsedPage >= 1
        ? parsedPage
        : undefined;
    void actions.createImportedBackground(plan.id, plan.displayFilename, sourcePageNumber);
  };

  const removePlan = (plan: Media) => {
    if (
      !globalThis.confirm(t('map.background.deletePlanConfirm', { name: plan.displayFilename }))
    ) {
      return;
    }
    deletePlan.mutate({ mediaId: plan.id, revision: plan.revision });
  };

  const removeBackground = (record: MapObjectRecord) => {
    if (globalThis.confirm(t('map.background.removeConfirm'))) {
      void actions.deleteObject(record.id);
    }
  };

  return (
    <div className={styles['panel']}>
      <h2 className={styles['title']}>{t('map.background.title')}</h2>

      <h3 className={styles['sectionTitle']}>{t('map.background.onMapTitle')}</h3>
      {backgrounds.length === 0 ? (
        <p className={styles['empty']}>{t('map.background.noneOnMap')}</p>
      ) : (
        <ul className={styles['list']}>
          {backgrounds.map((record) => {
            const details =
              record.categoryDetails?.category === 'importedBackground'
                ? record.categoryDetails.details
                : null;
            const visible = details?.isBackgroundVisible ?? true;
            return (
              <li key={record.id} className={styles['row']}>
                <div className={styles['rowHeader']}>
                  <span className={styles['name']}>
                    {record.label ?? t('map.background.unnamed')}
                  </span>
                  <span className={styles['badge']}>{stateLabel(record)}</span>
                </div>
                <div className={styles['actions']}>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-pressed={visible}
                    onClick={() => void actions.setBackgroundVisibility(record.id, !visible)}
                  >
                    {visible ? t('map.background.hide') : t('map.background.show')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeBackground(record)}
                  >
                    {t('map.background.remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {backgrounds.length > 0 && (
        <label className={styles['pageField']}>
          {t('map.background.opacity')}
          <input
            type="range"
            min={0.15}
            max={1}
            step={0.05}
            value={store.state.backgroundOpacity}
            onChange={(event) => store.setBackgroundOpacity(Number(event.target.value))}
          />
        </label>
      )}

      <h3 className={styles['sectionTitle']}>{t('map.background.plansTitle')}</h3>
      <StaleIndicator failure={listQuery.isError ? listQuery.error.failure : null} />
      {listQuery.isError && !isConnectivityFailure(listQuery.error.failure) && (
        <FailureAlert failure={listQuery.error.failure} />
      )}
      {listQuery.isPending ? (
        <p role="status" className={styles['empty']}>
          {t('map.background.plansLoading')}
        </p>
      ) : plans.length === 0 ? (
        <p className={styles['empty']}>{t('map.background.noPlans')}</p>
      ) : (
        <ul className={styles['list']}>
          {plans.map((plan) => (
            <li key={plan.id} className={styles['row']}>
              <div className={styles['rowHeader']}>
                <span className={styles['name']}>{plan.displayFilename}</span>
              </div>
              {isPdf(plan) && (
                <>
                  {/* The worker renders page one (ADR-0016); any other page
                      still has no image behind it, so the notice appears only
                      when one is actually chosen. */}
                  {(pageByMediaId[plan.id] ?? '1').trim() !== '1' && (
                    <p className={styles['notice']}>{t('map.background.pdfPageNotRendered')}</p>
                  )}
                  <label className={styles['pageField']}>
                    {t('map.background.pageNumber')}
                    <input
                      className={styles['pageInput']}
                      type="number"
                      min={1}
                      step={1}
                      value={pageByMediaId[plan.id] ?? '1'}
                      onChange={(event) =>
                        setPageByMediaId((previous) => ({
                          ...previous,
                          [plan.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              )}
              <div className={styles['actions']}>
                <Button type="button" variant="secondary" onClick={() => addBackground(plan)}>
                  {t('map.background.addToMap')}
                </Button>
                {/* Deleting the upload itself, not the background it may have
                    become. A plan still on the map answers `409
                    media.referenced`, which `FailureAlert` shows verbatim —
                    remove the background first, then the file. */}
                <Button
                  type="button"
                  variant="secondary"
                  busy={deletePlan.isPending}
                  onClick={() => removePlan(plan)}
                >
                  {t('map.background.deletePlan')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
