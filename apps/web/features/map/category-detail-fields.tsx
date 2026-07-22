'use client';

import type {
  FenceDetails,
  FenceKind,
  GardenObjectCategory,
  GardenObjectDetails,
  PlantPlacementDetails,
  StructureDetails,
  StructureKind,
  TreeDetails,
} from '@verdery/geometry-contracts';
import type { ChangeEvent } from 'react';

import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Select, TextField } from '@/shared/ui/public';

export interface CategoryDetailFieldsProps {
  readonly category: GardenObjectCategory;
  readonly details: GardenObjectDetails | undefined;
  readonly onChange: (details: GardenObjectDetails | undefined) => void;
}

const STRUCTURE_KINDS: readonly StructureKind[] = [
  'house',
  'shed',
  'greenhouse',
  'deck',
  'garage',
  'other',
];
const FENCE_KINDS: readonly FenceKind[] = ['wood', 'chainLink', 'vinyl', 'metal', 'hedge', 'other'];

/** Reads a number input's value, treating a blank field as "field cleared", not zero. */
function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function StructureFields({
  details,
  onChange,
}: {
  readonly details: StructureDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <Select
        label={t('map.properties.structureKind')}
        value={details.structureKind}
        options={STRUCTURE_KINDS.map((kind) => ({
          value: kind,
          label: t(`map.enum.structureKind.${kind}` as MessageKey),
        }))}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange({
            category: 'structure',
            details: { ...details, structureKind: event.target.value as StructureKind },
          })
        }
      />
      <TextField
        label={t('map.properties.heightMetres')}
        type="number"
        min={0}
        step="any"
        value={details.heightMetres ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const heightMetres = parseOptionalNumber(event.target.value);
          onChange({
            category: 'structure',
            details:
              heightMetres === undefined
                ? { structureKind: details.structureKind }
                : { ...details, heightMetres },
          });
        }}
      />
    </>
  );
}

function FenceFields({
  details,
  onChange,
}: {
  readonly details: FenceDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <Select
        label={t('map.properties.fenceKind')}
        value={details.fenceKind}
        options={FENCE_KINDS.map((kind) => ({
          value: kind,
          label: t(`map.enum.fenceKind.${kind}` as MessageKey),
        }))}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange({
            category: 'fence',
            details: { ...details, fenceKind: event.target.value as FenceKind },
          })
        }
      />
      <TextField
        label={t('map.properties.heightMetres')}
        type="number"
        min={0}
        step="any"
        value={details.heightMetres ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const heightMetres = parseOptionalNumber(event.target.value);
          onChange({
            category: 'fence',
            details:
              heightMetres === undefined
                ? { fenceKind: details.fenceKind }
                : { ...details, heightMetres },
          });
        }}
      />
    </>
  );
}

function TreeFields({
  details,
  onChange,
}: {
  readonly details: TreeDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <TextField
        label={t('map.properties.commonName')}
        value={details.commonName ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { commonName: _drop, ...rest } = details;
          const value = event.target.value;
          onChange({
            category: 'tree',
            details: value === '' ? rest : { ...rest, commonName: value },
          });
        }}
      />
      <TextField
        label={t('map.properties.estimatedHeightMetres')}
        type="number"
        min={0}
        step="any"
        value={details.estimatedHeightMetres ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { estimatedHeightMetres: _drop, ...rest } = details;
          const value = parseOptionalNumber(event.target.value);
          onChange({
            category: 'tree',
            details: value === undefined ? rest : { ...rest, estimatedHeightMetres: value },
          });
        }}
      />
      <TextField
        label={t('map.properties.estimatedSpreadMetres')}
        type="number"
        min={0}
        step="any"
        value={details.estimatedSpreadMetres ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { estimatedSpreadMetres: _drop, ...rest } = details;
          const value = parseOptionalNumber(event.target.value);
          onChange({
            category: 'tree',
            details: value === undefined ? rest : { ...rest, estimatedSpreadMetres: value },
          });
        }}
      />
    </>
  );
}

function PlantFields({
  details,
  onChange,
}: {
  readonly details: PlantPlacementDetails;
  readonly onChange: (details: GardenObjectDetails) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <TextField
        label={t('map.properties.commonName')}
        required
        value={details.commonName}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange({ category: 'plant', details: { ...details, commonName: event.target.value } })
        }
      />
      <TextField
        label={t('map.properties.quantity')}
        type="number"
        min={1}
        step={1}
        required
        value={details.quantity}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const quantity = Math.max(1, Math.round(Number(event.target.value) || 1));
          onChange({ category: 'plant', details: { ...details, quantity } });
        }}
      />
      <TextField
        label={t('map.properties.spacingMetres')}
        type="number"
        min={0}
        step="any"
        value={details.spacingMetres ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { spacingMetres: _drop, ...rest } = details;
          const value = parseOptionalNumber(event.target.value);
          onChange({
            category: 'plant',
            details: value === undefined ? rest : { ...rest, spacingMetres: value },
          });
        }}
      />
      <TextField
        label={t('map.properties.assignedToObjectId')}
        value={details.assignedToObjectId ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const { assignedToObjectId: _drop, ...rest } = details;
          const value = event.target.value;
          onChange({
            category: 'plant',
            details: value === '' ? rest : { ...rest, assignedToObjectId: value },
          });
        }}
      />
    </>
  );
}

/**
 * Category-specific property fields — implemented for the four categories
 * the toolbar can create with a details schema of their own (`structure`,
 * `fence`, `tree`, `plant`). `lot`, `path`, `waterFeature`, and
 * `importedBackground` have no details schema at all (nothing renders).
 * `gate`, `zone`, `bed`, `utilityExclusion`, and `annotation` do have a
 * details schema but no field editor here yet — the label above this
 * component is still fully editable for them, only their specific fields are
 * not; see this work package's final report for why this five-category cut
 * was made instead of covering all nine.
 */
export function CategoryDetailFields({ category, details, onChange }: CategoryDetailFieldsProps) {
  const { t } = useLocalization();

  switch (category) {
    case 'lot':
    case 'path':
    case 'waterFeature':
    case 'importedBackground':
      return null;

    case 'structure':
      return (
        <StructureFields
          details={details?.category === 'structure' ? details.details : { structureKind: 'other' }}
          onChange={onChange}
        />
      );

    case 'fence':
      return (
        <FenceFields
          details={details?.category === 'fence' ? details.details : { fenceKind: 'other' }}
          onChange={onChange}
        />
      );

    case 'tree':
      return (
        <TreeFields
          details={details?.category === 'tree' ? details.details : {}}
          onChange={onChange}
        />
      );

    case 'plant':
      return (
        <PlantFields
          details={
            details?.category === 'plant' ? details.details : { commonName: '', quantity: 1 }
          }
          onChange={onChange}
        />
      );

    case 'gate':
    case 'zone':
    case 'bed':
    case 'utilityExclusion':
    case 'annotation':
      return <p role="note">{t('map.properties.detailsNotEditable')}</p>;
  }
}
