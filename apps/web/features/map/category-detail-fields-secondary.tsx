'use client';

import type {
  AnnotationDetails,
  BedDetails,
  BedKind,
  GardenObjectDetails,
  GateDetails,
  MeasurementUnit,
  UtilityExclusionDetails,
  UtilityExclusionKind,
  ZoneDetails,
  ZoneKind,
} from '@verdery/geometry-contracts';
import type { ChangeEvent } from 'react';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Select, TextField } from '@/shared/ui/public';

import { parseOptionalNumber } from './category-detail-fields';
import type { MapObjectRecord } from './types';

const ZONE_KINDS: readonly ZoneKind[] = [
  'lawn',
  'garden',
  'mulch',
  'gravel',
  'groundCover',
  'other',
];
const BED_KINDS: readonly BedKind[] = ['inGround', 'raised', 'container'];
const UTILITY_EXCLUSION_KINDS: readonly UtilityExclusionKind[] = [
  'undergroundUtility',
  'septicField',
  'wellRadius',
  'setback',
  'other',
];
const MEASUREMENT_UNITS: readonly MeasurementUnit[] = ['metres', 'squareMetres', 'degrees'];

/**
 * `gate`, `zone`, `bed`, `utilityExclusion`, and `annotation` detail forms —
 * split out of `category-detail-fields.tsx` to keep both files under this
 * repository's 600-line-per-file limit, the same way
 * `apps/ios/Sources/FeatureMap/MapEditorViewModelEditing.swift` splits a
 * large stateful module into a topic-scoped sibling file.
 */

export function GateFields({
  details,
  onChange,
  records,
}: {
  readonly details: GateDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
  readonly records: readonly MapObjectRecord[];
}) {
  const { t } = useLocalization();
  const fence = records.find((record) => record.id === details.fenceObjectId);
  const fenceLabel = fence === undefined ? details.fenceObjectId : (fence.label ?? fence.id);

  return (
    <>
      <TextField label={t('map.properties.fenceObjectId')} value={fenceLabel} readOnly />
      <TextField
        label={t('map.properties.widthMetres')}
        type="number"
        min={0}
        step="any"
        value={details.widthMetres ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const widthMetres = parseOptionalNumber(event.target.value);
          onChange({
            category: 'gate',
            details:
              widthMetres === undefined
                ? { fenceObjectId: details.fenceObjectId }
                : { ...details, widthMetres },
          });
        }}
      />
    </>
  );
}

export function ZoneFields({
  details,
  onChange,
}: {
  readonly details: ZoneDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <Select
      label={t('map.properties.zoneKind')}
      value={details.zoneKind}
      options={ZONE_KINDS.map((kind) => ({
        value: kind,
        label: t(`map.enum.zoneKind.${kind}` as MessageKey),
      }))}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onChange({ category: 'zone', details: { zoneKind: event.target.value as ZoneKind } })
      }
    />
  );
}

export function BedFields({
  details,
  onChange,
}: {
  readonly details: BedDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <Select
        label={t('map.properties.bedKind')}
        value={details.bedKind}
        options={BED_KINDS.map((kind) => ({
          value: kind,
          label: t(`map.enum.bedKind.${kind}` as MessageKey),
        }))}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange({
            category: 'bed',
            details: { ...details, bedKind: event.target.value as BedKind },
          })
        }
      />
      <TextField
        label={t('map.properties.soilNotes')}
        value={details.soilNotes ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { soilNotes: _drop, ...rest } = details;
          const value = event.target.value;
          onChange({
            category: 'bed',
            details: value === '' ? rest : { ...rest, soilNotes: value },
          });
        }}
      />
    </>
  );
}

export function UtilityExclusionFields({
  details,
  onChange,
}: {
  readonly details: UtilityExclusionDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <Select
        label={t('map.properties.utilityExclusionKind')}
        value={details.utilityExclusionKind}
        options={UTILITY_EXCLUSION_KINDS.map((kind) => ({
          value: kind,
          label: t(`map.enum.utilityExclusionKind.${kind}` as MessageKey),
        }))}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange({
            category: 'utilityExclusion',
            details: {
              ...details,
              utilityExclusionKind: event.target.value as UtilityExclusionKind,
            },
          })
        }
      />
      <TextField
        label={t('map.properties.notes')}
        value={details.notes ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { notes: _drop, ...rest } = details;
          const value = event.target.value;
          onChange({
            category: 'utilityExclusion',
            details: value === '' ? rest : { ...rest, notes: value },
          });
        }}
      />
    </>
  );
}

/**
 * `measurement` is optional (`AnnotationDetails.measurement?`) — entering a
 * value creates it with `acquisitionMethod: 'userEntered'`; clearing the
 * value removes it entirely rather than leaving a zero. `originalEntry`,
 * `uncertainty`, `referenceObjectId`, and `calibrationRevision` have no UI
 * here — this pass covers only what a user directly enters.
 */
export function AnnotationFields({
  details,
  onChange,
}: {
  readonly details: AnnotationDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  const measurement = details.measurement;

  return (
    <>
      <TextField
        label={t('map.properties.measurementValue')}
        type="number"
        step="any"
        value={measurement?.value ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = parseOptionalNumber(event.target.value);
          if (value === undefined) {
            onChange({ category: 'annotation', details: {} });
            return;
          }
          onChange({
            category: 'annotation',
            details: {
              measurement: {
                value,
                unit: measurement?.unit ?? 'metres',
                acquisitionMethod: 'userEntered',
              },
            },
          });
        }}
      />
      <Select
        label={t('map.properties.measurementUnit')}
        value={measurement?.unit ?? 'metres'}
        disabled={measurement === undefined}
        options={MEASUREMENT_UNITS.map((unit) => ({
          value: unit,
          label: t(`map.enum.measurementUnit.${unit}` as MessageKey),
        }))}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          if (measurement === undefined) {
            return;
          }
          onChange({
            category: 'annotation',
            details: {
              measurement: {
                ...measurement,
                unit: event.target.value as MeasurementUnit,
                acquisitionMethod: 'userEntered',
              },
            },
          });
        }}
      />
    </>
  );
}
