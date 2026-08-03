'use client';

import type {
  ObservationMeasurementInput,
  ObservationMeasurementKind,
} from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { Button, CloseIcon, PlusIcon, Select, TextField } from '@/shared/ui/public';

import { measurementKindLabel, OBSERVATION_MEASUREMENT_KINDS } from './labels';
import styles from './observation-measurements-field.module.css';

export interface ObservationMeasurementsFieldProps {
  readonly value: readonly ObservationMeasurementInput[];
  readonly onChange: (value: readonly ObservationMeasurementInput[]) => void;
}

/** A row starts as a height in centimetres because that is the measurement a gardener records most often; every part of it is editable. */
const NEW_ROW: ObservationMeasurementInput = { kind: 'height', value: 0, unit: 'cm' };

/**
 * The typed measurements an observation may carry — height, width, or count
 * (P11-MEDIA-01; design doc §8.1, "Height, width, count, or other typed
 * measurements").
 *
 * A controlled list owned by the form, not a `react-hook-form` field array:
 * the surrounding form persists its own values as a recoverable draft by
 * watching them, and a field array would put a growing structure into that
 * draft for no gain here. Rows are plain state and are submitted as they
 * stand.
 *
 * `unit` is a free string in the contract, with no vocabulary fixed anywhere
 * in this repository — so this field does not invent one. The placeholder
 * shows examples; a new row starts at `cm`, which the reader can replace with
 * whatever they actually measured in.
 *
 * Source: packages/api-contracts/openapi.yaml, schema
 * `ObservationMeasurementInput`.
 */
export function ObservationMeasurementsField({
  value,
  onChange,
}: ObservationMeasurementsFieldProps) {
  const { t } = useLocalization();

  const replace = (index: number, row: ObservationMeasurementInput) => {
    onChange(value.map((existing, position) => (position === index ? row : existing)));
  };

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t('observations.measurementsLegend')}</legend>

      {value.map((measurement, index) => (
        // The index is the identity here: rows carry no id of their own until
        // the server assigns one, and two rows can legitimately be identical
        // (two counts of different things, both still unnamed).
        <div className={styles['row']} key={index}>
          <Select
            label={t('observations.measurementKindLabel')}
            value={measurement.kind}
            onChange={(event) =>
              replace(index, {
                ...measurement,
                kind: event.target.value as ObservationMeasurementKind,
              })
            }
            options={OBSERVATION_MEASUREMENT_KINDS.map((kind) => ({
              value: kind,
              label: t(measurementKindLabel(kind)),
            }))}
          />
          <TextField
            label={t('observations.measurementValueLabel')}
            type="number"
            min={0}
            step="any"
            value={String(measurement.value)}
            onChange={(event) =>
              // An unparseable entry becomes 0 rather than NaN: the schema's
              // own minimum is 0, and NaN would serialise to `null` and be
              // refused by the server with nothing on screen explaining why.
              replace(index, { ...measurement, value: Number(event.target.value) || 0 })
            }
          />
          <TextField
            label={t('observations.measurementUnitLabel')}
            placeholder={t('observations.measurementUnitPlaceholder')}
            value={measurement.unit}
            onChange={(event) => replace(index, { ...measurement, unit: event.target.value })}
          />
          <Button
            variant="secondary"
            iconOnly
            aria-label={t('observations.measurementRemove')}
            title={t('observations.measurementRemove')}
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            <CloseIcon />
          </Button>
        </div>
      ))}

      <Button variant="secondary" onClick={() => onChange([...value, NEW_ROW])}>
        <PlusIcon />
        {t('observations.measurementAdd')}
      </Button>
    </fieldset>
  );
}
