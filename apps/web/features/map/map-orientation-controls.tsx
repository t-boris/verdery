'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import styles from './map-orientation-controls.module.css';

export interface MapOrientationControlsProps {
  readonly rotationDegrees: number;
  readonly northUpRotationDegrees: number | null;
  readonly onChange: (rotationDegrees: number) => void;
}

const ROTATION_STEP_DEGREES = 15;

export function normalizeViewRotation(degrees: number): number {
  const normalized = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function MapOrientationControls({
  rotationDegrees,
  northUpRotationDegrees,
  onChange,
}: MapOrientationControlsProps) {
  const { t } = useLocalization();
  const setRotation = (degrees: number) => onChange(normalizeViewRotation(degrees));

  return (
    <div
      className={styles['controls']}
      role="group"
      aria-label={t('map.orientation.controlsLabel')}
    >
      <Button
        variant="secondary"
        iconOnly
        aria-label={t('map.orientation.counterClockwise')}
        title={t('map.orientation.counterClockwise')}
        onClick={() => setRotation(rotationDegrees - ROTATION_STEP_DEGREES)}
      >
        ↺
      </Button>
      <label className={styles['angle']}>
        <span className={styles['angleLabel']}>{t('map.orientation.angle')}</span>
        <input
          type="number"
          min={-180}
          max={180}
          step={1}
          value={Math.round(normalizeViewRotation(rotationDegrees) * 10) / 10}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) setRotation(value);
          }}
        />
        <span aria-hidden="true">°</span>
      </label>
      <Button
        variant="secondary"
        iconOnly
        aria-label={t('map.orientation.clockwise')}
        title={t('map.orientation.clockwise')}
        onClick={() => setRotation(rotationDegrees + ROTATION_STEP_DEGREES)}
      >
        ↻
      </Button>
      <Button
        variant="secondary"
        aria-label={t('map.orientation.northUp')}
        title={t('map.orientation.northUp')}
        disabled={northUpRotationDegrees === null}
        onClick={() => {
          if (northUpRotationDegrees !== null) setRotation(northUpRotationDegrees);
        }}
      >
        N↑
      </Button>
    </div>
  );
}
