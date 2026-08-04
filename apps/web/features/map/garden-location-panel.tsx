'use client';

import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import type { WireSetGeoreferenceRequest } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert, FieldGrid, TextField } from '@/shared/ui/public';

import { useGardenMap, useSetGardenGeoreference } from './queries';
import styles from './garden-location-panel.module.css';

export interface GardenLocationPanelProps {
  readonly gardenId: string;
}

/**
 * Where the garden is, and which way it faces.
 *
 * This is the input weather refresh, hemisphere, and the seasonal plan have
 * always read and, until P12-GEO-01, no one could write: the record existed
 * in the schema from the Phase 3 map baseline, but only tests ever inserted
 * one. A garden reaching this panel for the first time is not configuring an
 * extra; it is switching on every location-derived fact the product has.
 *
 * Two ways in, and no more this pass:
 *
 * - the browser's own positioning, which carries its accuracy with it;
 * - typed longitude and latitude, for someone who knows the address or is
 *   setting up a garden they are not standing in.
 *
 * Picking the point on the basemap (`mapPin`) belongs to the map editor, not
 * to a settings panel, and is deliberately left to that surface rather than
 * half-built here.
 *
 * Source: implementation-plan.md work package P12-GEO-01;
 * architecture/data-and-geospatial-design.md, section "9. Georeferencing".
 */
export function GardenLocationPanel({ gardenId }: GardenLocationPanelProps) {
  const { t, locale } = useLocalization();
  const isOnline = useIsOnline();
  const map = useGardenMap(gardenId);
  const save = useSetGardenGeoreference(gardenId);

  const current = map.data?.georeference;

  const [longitude, setLongitude] = useState('');
  const [latitude, setLatitude] = useState('');
  const [rotation, setRotation] = useState('0');
  const [accuracyMetres, setAccuracyMetres] = useState<number | null>(null);
  const [method, setMethod] = useState<WireSetGeoreferenceRequest['method']>('manualCoordinates');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const useMyLocation = () => {
    setLocationError(null);

    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setLocationError(t('gardenLocation.geolocationUnavailable'));
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Six decimal places is about 0.1 m at the equator — far finer than
        // any garden needs and finer than any browser reports honestly.
        setLongitude(position.coords.longitude.toFixed(6));
        setLatitude(position.coords.latitude.toFixed(6));
        setAccuracyMetres(position.coords.accuracy);
        setMethod('deviceLocation');
        setLocating(false);
      },
      () => {
        // Every failure reads the same to the person: the browser would not
        // say where they are. Denied, unavailable, and timed out are the
        // browser's categories, not something they can act on differently.
        setLocationError(t('gardenLocation.geolocationRefused'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const onSubmit = () => {
    const longitudeValue = Number(longitude);
    const latitudeValue = Number(latitude);
    const rotationValue = rotation.trim() === '' ? 0 : Number(rotation);

    if (
      !Number.isFinite(longitudeValue) ||
      longitudeValue < -180 ||
      longitudeValue > 180 ||
      !Number.isFinite(latitudeValue) ||
      latitudeValue < -90 ||
      latitudeValue > 90
    ) {
      setFieldError(t('gardenLocation.coordinatesInvalid'));
      return;
    }

    if (!Number.isFinite(rotationValue) || rotationValue < 0 || rotationValue >= 360) {
      setFieldError(t('gardenLocation.rotationInvalid'));
      return;
    }

    setFieldError(null);

    save.mutate({
      // The anchor is the coordinate space's own origin. A different local
      // anchor only matters once someone can pick one on the map, which is
      // the editor's job, not this panel's.
      localAnchor: [0, 0],
      geographicAnchor: [longitudeValue, latitudeValue],
      rotationDegrees: rotationValue,
      ...(accuracyMetres === null ? {} : { accuracyMetres }),
      method,
    });
  };

  const formatCoordinate = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);

  return (
    <section className={styles['panel']} aria-labelledby="garden-location-heading">
      <h2 id="garden-location-heading" className={styles['title']}>
        {t('gardenLocation.title')}
      </h2>
      <p className={styles['description']}>{t('gardenLocation.description')}</p>

      {map.isPending && <p role="status">{t('gardenLocation.loading')}</p>}

      {map.isLoadingError && <FailureAlert failure={map.error.failure} />}

      {!map.isPending &&
        !map.isLoadingError &&
        (current === undefined ? (
          <p className={styles['empty']}>{t('gardenLocation.empty')}</p>
        ) : (
          <dl className={styles['current']}>
            <div className={styles['row']}>
              <dt>{t('gardenLocation.currentCoordinates')}</dt>
              <dd>
                {formatCoordinate(current.geographicAnchor[1])},{' '}
                {formatCoordinate(current.geographicAnchor[0])}
              </dd>
            </div>
            <div className={styles['row']}>
              <dt>{t('gardenLocation.currentRotation')}</dt>
              <dd>{t('gardenLocation.degrees', { degrees: current.rotationDegrees })}</dd>
            </div>
            <div className={styles['row']}>
              <dt>{t('gardenLocation.currentAccuracy')}</dt>
              <dd>
                {current.accuracyMetres === undefined
                  ? t('gardenLocation.accuracyUnknown')
                  : t('gardenLocation.metres', {
                      metres: Math.round(current.accuracyMetres),
                    })}
              </dd>
            </div>
          </dl>
        ))}

      <div className={styles['form']}>
        <Button variant="secondary" busy={locating} onClick={useMyLocation} disabled={!isOnline}>
          {t('gardenLocation.useMyLocation')}
        </Button>

        {locationError !== null && <Alert tone="danger" title={locationError} />}

        {/* Three short numbers, read together, on one row. */}
        <FieldGrid>
          <TextField
            label={t('gardenLocation.latitudeLabel')}
            inputMode="decimal"
            value={latitude}
            onChange={(event) => {
              setLatitude(event.target.value);
              setMethod('manualCoordinates');
              setAccuracyMetres(null);
            }}
          />
          <TextField
            label={t('gardenLocation.longitudeLabel')}
            inputMode="decimal"
            value={longitude}
            onChange={(event) => {
              setLongitude(event.target.value);
              setMethod('manualCoordinates');
              setAccuracyMetres(null);
            }}
          />
          <TextField
            label={t('gardenLocation.rotationLabel')}
            inputMode="decimal"
            value={rotation}
            onChange={(event) => setRotation(event.target.value)}
          />
        </FieldGrid>
        <p className={styles['hint']}>{t('gardenLocation.rotationHint')}</p>

        {fieldError !== null && <Alert tone="danger" title={fieldError} />}
        {save.isError && <FailureAlert failure={save.error.failure} />}
        {save.isSuccess && <Alert tone="info" title={t('gardenLocation.saved')} />}

        <Button
          variant="primary"
          busy={save.isPending}
          onClick={onSubmit}
          disabled={!isOnline || map.isPending}
        >
          {t('gardenLocation.submit')}
        </Button>
      </div>
    </section>
  );
}
