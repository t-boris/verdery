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

import {
  AnnotationFields,
  BedFields,
  GateFields,
  UtilityExclusionFields,
  ZoneFields,
} from './category-detail-fields-secondary';
import type { MapObjectRecord } from './types';

export interface CategoryDetailFieldsProps {
  readonly category: GardenObjectCategory;
  readonly details: GardenObjectDetails | undefined;
  readonly onChange: (details: GardenObjectDetails | undefined) => void;
  /** Every object in the garden — only `gate`'s read-only fence display needs this. */
  readonly records: readonly MapObjectRecord[];
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

/** Reads a number input's value, treating a blank field as "field cleared", not zero. Exported for `category-detail-fields-secondary.tsx`. */
export function parseOptionalNumber(value: string): number | undefined {
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

/**
 * `assignedToObjectId` (the plant's zone/bed placement) is deliberately not
 * editable here — it commits through the dedicated `assignPlant` command,
 * not `changeProperties`, via `plant-assignment-field.tsx` in the property
 * panel. See `command.ts`'s `AssignPlantPayload` and this file's own
 * `CategoryDetailFields` doc comment.
 */
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
    </>
  );
}

/**
 * Category-specific property fields — implemented for the four categories
 * the toolbar can create with a details schema of their own (`structure`,
 * `fence`, `tree`, `plant`). `lot`, `path`, `waterFeature`, and
 * `importedBackground` have no details schema at all (nothing renders).
 * `gate`, `zone`, `bed`, `utilityExclusion`, and `annotation` each have a
 * form of their own too, defined in `category-detail-fields-secondary.tsx`
 * (split out to keep this file under this repository's 600-line limit).
 * Every category with a details schema (`object-category.ts`'s
 * `GardenObjectDetails` union) now has a field editor here.
 */
export function CategoryDetailFields({
  category,
  details,
  onChange,
  records,
}: CategoryDetailFieldsProps) {
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
      // A real gate object always has a real `fenceObjectId` — it is only
      // ever created via `completeGateCreation`, which requires one. The
      // empty-string fallback below only satisfies the type system for an
      // object that has no details at all, which should not occur in practice.
      return (
        <GateFields
          details={details?.category === 'gate' ? details.details : { fenceObjectId: '' }}
          onChange={onChange}
          records={records}
        />
      );

    case 'zone':
      return (
        <ZoneFields
          details={details?.category === 'zone' ? details.details : { zoneKind: 'other' }}
          onChange={onChange}
        />
      );

    case 'bed':
      return (
        <BedFields
          details={details?.category === 'bed' ? details.details : { bedKind: 'inGround' }}
          onChange={onChange}
        />
      );

    case 'utilityExclusion':
      return (
        <UtilityExclusionFields
          details={
            details?.category === 'utilityExclusion'
              ? details.details
              : { utilityExclusionKind: 'other' }
          }
          onChange={onChange}
        />
      );

    case 'annotation':
      return (
        <AnnotationFields
          details={details?.category === 'annotation' ? details.details : {}}
          onChange={onChange}
        />
      );
  }
}
