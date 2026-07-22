/**
 * Structural parsing for `GardenObjectDetails`'s nine category branches,
 * matching `packages/api-contracts/openapi.yaml`'s `*Details` schemas.
 *
 * Whether a given `categoryDetails` value is even applicable to the command's
 * own `category`/`objectId` is `application/validate-category-details.ts`'s
 * job, not this module's — this only confirms the shape of whichever branch
 * `categoryDetails.category` names is well-formed.
 */

import type {
  GardenObjectDetails,
  Measurement,
  MeasurementAcquisitionMethod,
  MeasurementUnit,
} from '@verdery/geometry-contracts';
import { invalid } from './garden-routes.js';
import { requireGeometry } from './parse-geometry.js';
import {
  requireEnum,
  requireInteger,
  requireNumber,
  requireOptionalNumber,
  requireOptionalString,
  requireOptionalUuid,
  requireRecord,
  requireString,
  requireUuid,
} from './parse-primitives.js';

const STRUCTURE_KINDS = ['house', 'shed', 'greenhouse', 'deck', 'garage', 'other'] as const;
const FENCE_KINDS = ['wood', 'chainLink', 'vinyl', 'metal', 'hedge', 'other'] as const;
const ZONE_KINDS = ['lawn', 'garden', 'mulch', 'gravel', 'groundCover', 'other'] as const;
const BED_KINDS = ['inGround', 'raised', 'container'] as const;
const UTILITY_EXCLUSION_KINDS = [
  'undergroundUtility',
  'septicField',
  'wellRadius',
  'setback',
  'other',
] as const;
const MEASUREMENT_UNITS = ['metres', 'squareMetres', 'degrees'] as const;
const MEASUREMENT_ACQUISITION_METHODS = [
  'userEntered',
  'derivedFromGeometry',
  'arMeasurement',
  'imageExtraction',
  'depthCapture',
  'importedPlan',
] as const;

function parseMeasurement(value: unknown, pointer: string): Measurement {
  const record = requireRecord(value, pointer);
  const unit = requireEnum<MeasurementUnit>(record['unit'], MEASUREMENT_UNITS, `${pointer}/unit`);
  const acquisitionMethod = requireEnum<MeasurementAcquisitionMethod>(
    record['acquisitionMethod'],
    MEASUREMENT_ACQUISITION_METHODS,
    `${pointer}/acquisitionMethod`,
  );
  const originalEntry = requireOptionalString(record['originalEntry'], `${pointer}/originalEntry`);
  const uncertainty = requireOptionalNumber(record['uncertainty'], `${pointer}/uncertainty`);
  const referenceObjectId = requireOptionalUuid(
    record['referenceObjectId'],
    `${pointer}/referenceObjectId`,
  );
  const calibrationRevision = requireOptionalNumber(
    record['calibrationRevision'],
    `${pointer}/calibrationRevision`,
  );

  return {
    value: requireNumber(record['value'], `${pointer}/value`),
    unit,
    acquisitionMethod,
    ...(originalEntry === undefined ? {} : { originalEntry }),
    ...(uncertainty === undefined ? {} : { uncertainty }),
    ...(referenceObjectId === undefined ? {} : { referenceObjectId }),
    ...(calibrationRevision === undefined ? {} : { calibrationRevision }),
  };
}

export function parseGardenObjectDetails(value: unknown, pointer: string): GardenObjectDetails {
  const record = requireRecord(value, pointer);
  const category = requireString(record['category'], `${pointer}/category`);

  switch (category) {
    case 'structure': {
      const structureKind = requireEnum(
        record['structureKind'],
        STRUCTURE_KINDS,
        `${pointer}/structureKind`,
      );
      const heightMetres = requireOptionalNumber(record['heightMetres'], `${pointer}/heightMetres`);
      return {
        category: 'structure',
        details: { structureKind, ...(heightMetres === undefined ? {} : { heightMetres }) },
      };
    }

    case 'fence': {
      const fenceKind = requireEnum(record['fenceKind'], FENCE_KINDS, `${pointer}/fenceKind`);
      const heightMetres = requireOptionalNumber(record['heightMetres'], `${pointer}/heightMetres`);
      return {
        category: 'fence',
        details: { fenceKind, ...(heightMetres === undefined ? {} : { heightMetres }) },
      };
    }

    case 'gate': {
      const fenceObjectId = requireUuid(record['fenceObjectId'], `${pointer}/fenceObjectId`);
      const widthMetres = requireOptionalNumber(record['widthMetres'], `${pointer}/widthMetres`);
      return {
        category: 'gate',
        details: { fenceObjectId, ...(widthMetres === undefined ? {} : { widthMetres }) },
      };
    }

    case 'zone': {
      const zoneKind = requireEnum(record['zoneKind'], ZONE_KINDS, `${pointer}/zoneKind`);
      return { category: 'zone', details: { zoneKind } };
    }

    case 'bed': {
      const bedKind = requireEnum(record['bedKind'], BED_KINDS, `${pointer}/bedKind`);
      const soilNotes = requireOptionalString(record['soilNotes'], `${pointer}/soilNotes`);
      return {
        category: 'bed',
        details: { bedKind, ...(soilNotes === undefined ? {} : { soilNotes }) },
      };
    }

    case 'tree': {
      const rawCanopyGeometry = record['canopyGeometry'];
      const canopyGeometry =
        rawCanopyGeometry === undefined
          ? undefined
          : requireGeometry(rawCanopyGeometry, `${pointer}/canopyGeometry`);
      const commonName = requireOptionalString(record['commonName'], `${pointer}/commonName`);
      const estimatedHeightMetres = requireOptionalNumber(
        record['estimatedHeightMetres'],
        `${pointer}/estimatedHeightMetres`,
      );
      const estimatedSpreadMetres = requireOptionalNumber(
        record['estimatedSpreadMetres'],
        `${pointer}/estimatedSpreadMetres`,
      );
      return {
        category: 'tree',
        details: {
          ...(canopyGeometry === undefined ? {} : { canopyGeometry }),
          ...(commonName === undefined ? {} : { commonName }),
          ...(estimatedHeightMetres === undefined ? {} : { estimatedHeightMetres }),
          ...(estimatedSpreadMetres === undefined ? {} : { estimatedSpreadMetres }),
        },
      };
    }

    case 'plant': {
      const commonName = requireString(record['commonName'], `${pointer}/commonName`);
      const quantity = requireInteger(record['quantity'], `${pointer}/quantity`, 1);
      const spacingMetres = requireOptionalNumber(
        record['spacingMetres'],
        `${pointer}/spacingMetres`,
      );
      const assignedToObjectId = requireOptionalUuid(
        record['assignedToObjectId'],
        `${pointer}/assignedToObjectId`,
      );
      return {
        category: 'plant',
        details: {
          commonName,
          quantity,
          ...(spacingMetres === undefined ? {} : { spacingMetres }),
          ...(assignedToObjectId === undefined ? {} : { assignedToObjectId }),
        },
      };
    }

    case 'utilityExclusion': {
      const utilityExclusionKind = requireEnum(
        record['utilityExclusionKind'],
        UTILITY_EXCLUSION_KINDS,
        `${pointer}/utilityExclusionKind`,
      );
      const notes = requireOptionalString(record['notes'], `${pointer}/notes`);
      return {
        category: 'utilityExclusion',
        details: { utilityExclusionKind, ...(notes === undefined ? {} : { notes }) },
      };
    }

    case 'annotation': {
      const rawMeasurement = record['measurement'];
      const measurement =
        rawMeasurement === undefined
          ? undefined
          : parseMeasurement(rawMeasurement, `${pointer}/measurement`);
      return { category: 'annotation', details: measurement === undefined ? {} : { measurement } };
    }

    default:
      throw invalid(
        `${pointer}/category must be one of: structure, fence, gate, zone, bed, tree, plant, utilityExclusion, annotation.`,
        'request.category_details.category.invalid',
        `${pointer}/category`,
      );
  }
}

export function requireOptionalGardenObjectDetails(
  value: unknown,
  pointer: string,
): GardenObjectDetails | undefined {
  return value === undefined ? undefined : parseGardenObjectDetails(value, pointer);
}
