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

/** A new row starts in centimetres because that is what a gardener measures a plant in; the kind is whichever one is still free. */
const NEW_ROW_UNIT = 'cm';

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
 * One row per kind, because `observation_measurement_unique_kind` allows one
 * height, one width, and one count per observation — a second of the same kind
 * is a correction, and a correction is a new observation. The kind picker
 * therefore offers only kinds no other row has taken, and the add control
 * disappears once all three are in use. Offering the duplicate would produce a
 * server refusal for a rule the reader was never shown.
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

  const takenKinds = new Set(value.map((measurement) => measurement.kind));
  const freeKind = OBSERVATION_MEASUREMENT_KINDS.find((kind) => !takenKinds.has(kind));

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t('observations.measurementsLegend')}</legend>

      {value.map((measurement, index) => (
        // Keyed by kind, which is unique across rows by construction: rows
        // carry no id until the server assigns one, and an index key would
        // move a reader's focus to a different row when an earlier one is
        // removed.
        <div className={styles['row']} key={measurement.kind}>
          <Select
            label={t('observations.measurementKindLabel')}
            value={measurement.kind}
            onChange={(event) =>
              replace(index, {
                ...measurement,
                kind: event.target.value as ObservationMeasurementKind,
              })
            }
            options={OBSERVATION_MEASUREMENT_KINDS.filter(
              (kind) => kind === measurement.kind || !takenKinds.has(kind),
            ).map((kind) => ({
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

      {freeKind !== undefined && (
        <Button
          variant="secondary"
          onClick={() => onChange([...value, { kind: freeKind, value: 0, unit: NEW_ROW_UNIT }])}
        >
          <PlusIcon />
          {t('observations.measurementAdd')}
        </Button>
      )}
    </fieldset>
  );
}
