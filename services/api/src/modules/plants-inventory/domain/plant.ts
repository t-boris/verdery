/**
 * The plant aggregate: a plant instance (or, for `groupingKind !== 'individual'`,
 * a row or group of instances tracked as one record), its placement on the
 * garden map, its identity/taxonomy state, and its lifecycle/status.
 *
 * Mirrors `plants_inventory.plant` exactly, the same way `gardens-mapping`'s
 * `Garden` (domain/garden.ts) mirrors `gardens_mapping.garden`: a single
 * integer `revision` column, optimistic-concurrency-guarded, journaled on
 * every accepted command — see `application/apply-plant-revision-guarded-update.ts`
 * and `application/plant-revision-journal-writer.ts`.
 *
 * `lifecycleStage` and `status` are two orthogonal fields — see the
 * migration's own comment on `plants_inventory.plant` — so this module keeps
 * their transition functions in a separate file, `plant-lifecycle.ts`,
 * mirroring how gardens-mapping splits `map-object.ts` (the aggregate) from
 * `map-object-lifecycle.ts` (its transitions).
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `plants_inventory.plant`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { LifecycleStage, PlantStatus } from './plant-lifecycle.js';

export type GroupingKind = 'individual' | 'row' | 'group';
export type AcquisitionDateType = 'planted' | 'sown' | 'acquired';

const MAX_DISPLAY_NAME_LENGTH = 200;
const ACQUISITION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A plant's position on the garden map: both fields reference a `gardens_mapping.garden_object` in `plant.gardenId`, validated by the application layer, never by this module directly (see `application/require-plant-placement-in-garden.ts`). */
export interface PlantPlacement {
  readonly gardenAreaMapObjectId: Uuid | null;
  readonly placementMapObjectId: Uuid | null;
}

export interface Plant {
  readonly id: Uuid;
  /** Immutable after creation — moving a plant to a different garden is not a supported operation, only moving its map placement within the same garden is. */
  readonly gardenId: Uuid;
  readonly gardenAreaMapObjectId: Uuid | null;
  readonly placementMapObjectId: Uuid | null;
  readonly displayName: string;
  readonly taxonomyReferenceId: Uuid | null;
  readonly varietyLabel: string | null;
  readonly acceptedIdentificationId: Uuid | null;
  /** Calendar date only, `'YYYY-MM-DD'` — never reinterpreted through a timezone. See `platform/database/pg-date-parser.ts`. */
  readonly acquisitionDate: string | null;
  readonly acquisitionDateType: AcquisitionDateType | null;
  /** Immutable after creation for this pass — no command in this module changes it. */
  readonly groupingKind: GroupingKind;
  /** Required and `> 0` when `groupingKind !== 'individual'`; always `null` for `'individual'`. Enforced by `validateQuantityForGroupingKind`. */
  readonly quantity: number | null;
  readonly lifecycleStage: LifecycleStage;
  readonly status: PlantStatus;
  readonly conditionNote: string | null;
  readonly careGuidanceNote: string | null;
  readonly revision: number;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Trims and validates a proposed display name, the same shape of gap
 * `gardens-mapping/domain/garden.ts`'s `validateGardenName` closes for
 * `garden.name`: `display_name` carries only `NOT NULL` in the migration, no
 * `CHECK`, so a string of only spaces would satisfy that while still being
 * useless.
 */
export function validateDisplayName(rawDisplayName: string): string {
  const displayName = rawDisplayName.trim();

  if (displayName.length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'displayName must not be blank.', {
      details: [{ code: 'plants_inventory.plant.display_name.blank', pointer: '/displayName' }],
    });
  }

  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `displayName must be at most ${String(MAX_DISPLAY_NAME_LENGTH)} characters.`,
      {
        details: [
          { code: 'plants_inventory.plant.display_name.too_long', pointer: '/displayName' },
        ],
      },
    );
  }

  return displayName;
}

/**
 * Enforces the migration's `plant_quantity_positive_check` invariant one
 * level up, at the point a clean `ValidationError` can still be raised
 * instead of a raw `CHECK` violation: required and `> 0` for a row or group,
 * and — since a raw `quantity` on a single plant instance is meaningless —
 * must be absent for `'individual'`.
 */
export function validateQuantityForGroupingKind(
  groupingKind: GroupingKind,
  rawQuantity: number | null | undefined,
): number | null {
  if (groupingKind === 'individual') {
    if (rawQuantity !== null && rawQuantity !== undefined) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        'quantity must not be set for an individual plant.',
        {
          details: [{ code: 'plants_inventory.plant.quantity.not_allowed', pointer: '/quantity' }],
        },
      );
    }
    return null;
  }

  if (rawQuantity === null || rawQuantity === undefined || rawQuantity <= 0) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'quantity is required and must be greater than zero for a row or group.',
      {
        details: [
          { code: 'plants_inventory.plant.quantity.required_positive', pointer: '/quantity' },
        ],
      },
    );
  }

  return rawQuantity;
}

/** Rejects a malformed calendar date before it becomes a raw driver error against the `date`-typed column. Postgres itself still rejects an invalid real date (`'2026-02-30'`); this only catches the wrong shape. */
export function validateAcquisitionDate(rawAcquisitionDate: string): string {
  if (!ACQUISITION_DATE_PATTERN.test(rawAcquisitionDate)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "acquisitionDate must be a calendar date in 'YYYY-MM-DD' form.",
      {
        details: [
          { code: 'plants_inventory.plant.acquisition_date.invalid', pointer: '/acquisitionDate' },
        ],
      },
    );
  }

  return rawAcquisitionDate;
}

export function createPlant(
  id: Uuid,
  gardenId: Uuid,
  placement: PlantPlacement,
  rawDisplayName: string,
  taxonomyReferenceId: Uuid | null,
  varietyLabel: string | null,
  rawAcquisitionDate: string | null,
  acquisitionDateType: AcquisitionDateType | null,
  groupingKind: GroupingKind,
  rawQuantity: number | null | undefined,
  createdByProfileId: Uuid,
  now: Date,
): Plant {
  return {
    id,
    gardenId,
    gardenAreaMapObjectId: placement.gardenAreaMapObjectId,
    placementMapObjectId: placement.placementMapObjectId,
    displayName: validateDisplayName(rawDisplayName),
    taxonomyReferenceId,
    varietyLabel,
    acceptedIdentificationId: null,
    acquisitionDate:
      rawAcquisitionDate === null ? null : validateAcquisitionDate(rawAcquisitionDate),
    acquisitionDateType,
    groupingKind,
    quantity: validateQuantityForGroupingKind(groupingKind, rawQuantity),
    lifecycleStage: 'planned',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fields `UpdatePlantDetails` may change. `undefined` means "leave
 * unchanged"; for the nullable fields, an explicit `null` clears it —
 * "Setting `taxonomyReferenceId` to `null` is always legal" per this
 * module's own command spec, and the same `undefined`-vs-`null` convention
 * applies to every other nullable field here, matching
 * `ChangeMapObjectProperties`'s `payload.label !== undefined ? payload.label
 * : object.label` handling of the identical gap.
 */
export interface PlantDetailsChanges {
  readonly displayName?: string;
  readonly taxonomyReferenceId?: Uuid | null;
  readonly varietyLabel?: string | null;
  readonly acquisitionDate?: string | null;
  readonly acquisitionDateType?: AcquisitionDateType | null;
  readonly conditionNote?: string | null;
  readonly careGuidanceNote?: string | null;
  readonly quantity?: number | null;
}

/** `groupingKind` is immutable and not part of `PlantDetailsChanges`, so `quantity` is always validated against the plant's own existing `groupingKind`. */
export function updatePlantDetails(plant: Plant, changes: PlantDetailsChanges, now: Date): Plant {
  const displayName =
    changes.displayName !== undefined
      ? validateDisplayName(changes.displayName)
      : plant.displayName;
  const acquisitionDate =
    changes.acquisitionDate !== undefined
      ? changes.acquisitionDate === null
        ? null
        : validateAcquisitionDate(changes.acquisitionDate)
      : plant.acquisitionDate;
  const quantity =
    changes.quantity !== undefined
      ? validateQuantityForGroupingKind(plant.groupingKind, changes.quantity)
      : plant.quantity;

  return {
    ...plant,
    displayName,
    taxonomyReferenceId:
      changes.taxonomyReferenceId !== undefined
        ? changes.taxonomyReferenceId
        : plant.taxonomyReferenceId,
    varietyLabel: changes.varietyLabel !== undefined ? changes.varietyLabel : plant.varietyLabel,
    acquisitionDate,
    acquisitionDateType:
      changes.acquisitionDateType !== undefined
        ? changes.acquisitionDateType
        : plant.acquisitionDateType,
    conditionNote:
      changes.conditionNote !== undefined ? changes.conditionNote : plant.conditionNote,
    careGuidanceNote:
      changes.careGuidanceNote !== undefined ? changes.careGuidanceNote : plant.careGuidanceNote,
    quantity,
    revision: plant.revision + 1,
    updatedAt: now,
  };
}

/** Sets the plant's identity from a prior `plant_identification` row already verified (by the application layer, see `application/confirm-plant-identification.ts`) to belong to this plant. `taxonomyReferenceId` may end up `null` here — a confirmed "no confident match" identification is still a legitimate accepted state. */
export function confirmPlantIdentification(
  plant: Plant,
  taxonomyReferenceId: Uuid | null,
  identificationId: Uuid,
  now: Date,
): Plant {
  return {
    ...plant,
    taxonomyReferenceId,
    acceptedIdentificationId: identificationId,
    revision: plant.revision + 1,
    updatedAt: now,
  };
}

/** Placement-only change. `gardenId` itself never changes — see the field's own doc comment on `Plant` — so this never touches it. The application layer (`application/move-plant.ts`) is what validates the new placement references garden objects in this same garden before calling here. */
export function movePlant(plant: Plant, placement: PlantPlacement, now: Date): Plant {
  return {
    ...plant,
    gardenAreaMapObjectId: placement.gardenAreaMapObjectId,
    placementMapObjectId: placement.placementMapObjectId,
    revision: plant.revision + 1,
    updatedAt: now,
  };
}
