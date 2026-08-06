'use client';

import type { PlatReading, ProposedPlatObject } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import styles from './plat-reading-panel.module.css';
import type { MapEditorActions } from './use-map-editor-actions';

export interface PlatReadingPanelProps {
  readonly reading: PlatReading;
  readonly actions: MapEditorActions;
  readonly onDismiss: () => void;
}

const SQUARE_FEET_PER_SQUARE_METRE = 10.7639;

/**
 * What the plat said, next to what will be put on the map if it is accepted
 * (ADR-0018).
 *
 * Everything a person needs in order to disbelieve it is on the screen: the
 * closure error the survey checks itself with, the area the sheet states
 * beside the area the walk produced, how closely the drawing's own lot
 * outline matched that walk, and each object's own confidence. Nothing is
 * pre-accepted silently — the boundary and every object are individually
 * checkable, and an unchecked one is simply never created.
 *
 * A reading with no boundary proposes nothing: without the surveyed lot
 * there is no scale, and an object placed by a guess at scale is worse than
 * no object.
 */
export function PlatReadingPanel({ reading, actions, onDismiss }: PlatReadingPanelProps) {
  const { t, locale } = useLocalization();
  const walkedSquareFeet =
    reading.boundary === null
      ? null
      : reading.boundary.areaSquareMetres * SQUARE_FEET_PER_SQUARE_METRE;
  const areaAgrees =
    walkedSquareFeet === null ||
    reading.statedAreaSquareFeet === null ||
    Math.abs(walkedSquareFeet - reading.statedAreaSquareFeet) / reading.statedAreaSquareFeet <=
      0.15;
  const [acceptBoundary, setAcceptBoundary] = useState(
    reading.boundary !== null && reading.boundary.closes && areaAgrees,
  );
  const [rejected, setRejected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const number = (value: number, digits = 1): string =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  if (!reading.isPlat) {
    return (
      <div className={styles['panel']}>
        <p className={styles['notice']}>{t('map.plat.notAPlat')}</p>
        <Button type="button" variant="secondary" onClick={onDismiss}>
          {t('map.plat.dismiss')}
        </Button>
      </div>
    );
  }

  const accepted = reading.objects
    .map((_object, index) => index)
    .filter((index) => !rejected.has(index));

  const toggle = (index: number) => {
    setRejected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const accept = async () => {
    setBusy(true);
    try {
      await actions.acceptPlatProposals(reading, accepted, acceptBoundary);
    } finally {
      setBusy(false);
    }
    onDismiss();
  };

  return (
    <div className={styles['panel']}>
      <h3 className={styles['title']}>{t('map.plat.reviewTitle')}</h3>

      <dl className={styles['facts']}>
        {reading.address !== null && (
          <div className={styles['fact']}>
            <dt>{t('map.plat.address')}</dt>
            <dd>{reading.address}</dd>
          </div>
        )}
        {reading.northRotationDegrees !== null && (
          <div className={styles['fact']}>
            <dt>{t('map.plat.north')}</dt>
            <dd>
              {t('map.plat.northValue', { degrees: number(reading.northRotationDegrees, 0) })}
            </dd>
          </div>
        )}
        {reading.boundary !== null && (
          <>
            <div className={styles['fact']}>
              <dt>{t('map.plat.closure')}</dt>
              <dd>
                {reading.boundary.closes
                  ? t('map.plat.closes', { error: number(reading.boundary.closureErrorMetres, 2) })
                  : t('map.plat.doesNotClose', {
                      error: number(reading.boundary.closureErrorMetres, 2),
                    })}
              </dd>
            </div>
            <div className={styles['fact']}>
              <dt>{t('map.plat.area')}</dt>
              <dd>
                {t('map.plat.areaValue', {
                  metres: number(reading.boundary.areaSquareMetres, 0),
                  feet: number(walkedSquareFeet ?? 0, 0),
                })}
                {reading.statedAreaSquareFeet !== null &&
                  ` · ${t('map.plat.statedArea', {
                    feet: number(reading.statedAreaSquareFeet, 0),
                  })}`}
              </dd>
            </div>
          </>
        )}
        {reading.boundary?.recoveredBearing !== undefined &&
          reading.boundary.recoveredBearing !== null && (
            <div className={styles['fact']}>
              <dt>{t('map.plat.recoveredBearing')}</dt>
              <dd>
                {t('map.plat.recoveredBearingValue', {
                  call: String(reading.boundary.recoveredBearing.callNumber),
                  metres: number(reading.boundary.recoveredBearing.lengthDisagreementMetres, 2),
                })}
              </dd>
            </div>
          )}
        {reading.pageFitResidualMetres !== null && (
          <div className={styles['fact']}>
            <dt>{t('map.plat.fit')}</dt>
            <dd>{t('map.plat.fitValue', { metres: number(reading.pageFitResidualMetres, 2) })}</dd>
          </div>
        )}
      </dl>

      {reading.boundary === null ? (
        <p className={styles['notice']}>{t('map.plat.noBoundary')}</p>
      ) : (
        <label className={styles['choice']}>
          <input
            type="checkbox"
            checked={acceptBoundary}
            onChange={(event) => setAcceptBoundary(event.target.checked)}
          />
          <span>
            {t('map.plat.acceptBoundary')}
            {!reading.boundary.closes && ` — ${t('map.plat.closureWarning')}`}
            {!areaAgrees && ` — ${t('map.plat.areaMismatchWarning')}`}
          </span>
        </label>
      )}

      {reading.objects.length === 0 ? (
        <p className={styles['notice']}>{t('map.plat.noObjects')}</p>
      ) : (
        <ul className={styles['list']}>
          {reading.objects.map((object, index) => (
            <li key={`${object.category}-${object.label}-${String(index)}`}>
              <label className={styles['choice']}>
                <input
                  type="checkbox"
                  checked={!rejected.has(index)}
                  onChange={() => toggle(index)}
                />
                <span>
                  <span className={styles['objectLabel']}>
                    {object.label === '' ? t('map.plat.unlabelled') : object.label}
                  </span>
                  <span className={styles['objectMeta']}>
                    {t(`map.category.${object.category}` as 'map.category.structure')} ·{' '}
                    {describeSize(object, number, t)} ·{' '}
                    {t('map.plat.confidence', {
                      percent: String(Math.round(object.confidence * 100)),
                    })}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className={styles['actions']}>
        <Button
          type="button"
          busy={busy}
          disabled={!acceptBoundary && accepted.length === 0}
          onClick={() => void accept()}
        >
          {t('map.plat.accept', {
            count: String(accepted.length + (acceptBoundary ? 1 : 0)),
          })}
        </Button>
        <Button type="button" variant="secondary" onClick={onDismiss}>
          {t('map.plat.dismiss')}
        </Button>
      </div>
    </div>
  );
}

/** Area for a shape that has one, length for a line, and nothing pretended for a point. */
function describeSize(
  object: ProposedPlatObject,
  number: (value: number, digits?: number) => string,
  t: (
    key: 'map.plat.sizeArea' | 'map.plat.sizeLength' | 'map.plat.sizePoint',
    args?: Record<string, string>,
  ) => string,
): string {
  if (object.geometry.type === 'Polygon') {
    return t('map.plat.sizeArea', { metres: number(object.areaSquareMetres, 0) });
  }
  if (object.geometry.type === 'LineString') {
    return t('map.plat.sizeLength', { metres: number(lengthOf(object.geometry.coordinates), 1) });
  }
  return t('map.plat.sizePoint');
}

function lengthOf(coordinates: readonly (readonly number[])[]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    total += Math.hypot(
      (current[0] ?? 0) - (previous[0] ?? 0),
      (current[1] ?? 0) - (previous[1] ?? 0),
    );
  }
  return total;
}
