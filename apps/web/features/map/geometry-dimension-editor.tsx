'use client';

import { useState, type FormEvent } from 'react';

import { formatFixed, useLocalization } from '@/shared/localization/public';
import { Button, RulerIcon, TextField } from '@/shared/ui/public';

import {
  dimensionsOfGeometry,
  resizeAreaGeometry,
  resizeLineGeometry,
} from './geometry-dimensions';
import styles from './geometry-dimension-editor.module.css';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

function editableNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function GeometryDimensionEditor({
  actions,
  record,
}: {
  readonly actions: MapEditorActions;
  readonly record: MapObjectRecord;
}) {
  const { t, locale } = useLocalization();
  const dimensions = dimensionsOfGeometry(record.geometry);
  const [width, setWidth] = useState(
    dimensions.kind === 'area' ? editableNumber(dimensions.widthMetres) : '',
  );
  const [depth, setDepth] = useState(
    dimensions.kind === 'area' ? editableNumber(dimensions.depthMetres) : '',
  );
  const [length, setLength] = useState(
    dimensions.kind === 'line' ? editableNumber(dimensions.lengthMetres) : '',
  );
  const [error, setError] = useState<string | null>(null);

  if (dimensions.kind === 'point' || record.category === 'importedBackground') {
    return null;
  }

  const applyDimensions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextGeometry =
      dimensions.kind === 'area'
        ? resizeAreaGeometry(record.geometry, Number(width), Number(depth))
        : resizeLineGeometry(record.geometry, Number(length));
    if (nextGeometry === null) {
      setError(t('map.properties.dimensionsInvalid'));
      return;
    }
    setError(null);
    await actions.replaceGeometry(record.id, nextGeometry);
  };

  return (
    <section className={styles['section']} aria-labelledby={`dimensions-${record.id}`}>
      <div className={styles['heading']}>
        <h3 id={`dimensions-${record.id}`} className={styles['title']}>
          <RulerIcon />
          {t('map.properties.dimensionsTitle')}
        </h3>
        <span className={styles['badge']}>{t('map.properties.approximateBadge')}</span>
      </div>
      <p className={styles['description']}>{t('map.properties.dimensionsDescription')}</p>

      <form className={styles['form']} onSubmit={(event) => void applyDimensions(event)} noValidate>
        <div className={styles['fieldGrid']}>
          {dimensions.kind === 'area' ? (
            <>
              <TextField
                label={t('map.properties.overallWidthMetres')}
                type="number"
                min="0.01"
                step="any"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
              <TextField
                label={t('map.properties.overallDepthMetres')}
                type="number"
                min="0.01"
                step="any"
                value={depth}
                onChange={(event) => setDepth(event.target.value)}
              />
            </>
          ) : (
            <TextField
              label={t('map.properties.totalLengthMetres')}
              type="number"
              min="0.05"
              step="any"
              value={length}
              onChange={(event) => setLength(event.target.value)}
            />
          )}
        </div>

        {dimensions.kind === 'area' && (
          <dl className={styles['metrics']}>
            <div>
              <dt>{t('map.properties.area')}</dt>
              <dd>
                {t('map.units.squareMetres', {
                  value: formatFixed(dimensions.areaSquareMetres, 2, locale),
                })}
              </dd>
            </div>
            <div>
              <dt>{t('map.properties.perimeter')}</dt>
              <dd>
                {t('map.units.metres', {
                  value: formatFixed(dimensions.perimeterMetres, 2, locale),
                })}
              </dd>
            </div>
          </dl>
        )}

        {error !== null && (
          <p className={styles['error']} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={actions.isSubmitting}>
          {t('map.properties.applyDimensions')}
        </Button>
      </form>
    </section>
  );
}
