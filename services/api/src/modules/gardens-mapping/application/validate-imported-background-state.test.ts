import type {
  GardenObjectDetails,
  ImportedBackgroundCalibration,
} from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { MapObject } from '../domain/map-object.js';
import {
  requireBackgroundGeometryEditable,
  requireImportedBackgroundStateCreatable,
  requireImportedBackgroundStatePreserved,
  uncalibratedDuplicateDetails,
  withServerOwnedCalibration,
} from './validate-imported-background-state.js';

const CALIBRATION: ImportedBackgroundCalibration = {
  transformRevision: 3,
  pageAspectRatio: 0.75,
  knownDistance: { pointA: [0.1, 0.1], pointB: [0.6, 0.1], distanceMetres: 10 },
  referencePoints: [],
  transform: {
    metresPerPlanUnit: 20,
    rotationRadians: 0,
    translationMetres: { x: 0, y: 0 },
  },
  rmsErrorMetres: null,
};

function backgroundDetails(
  overrides: Partial<
    Extract<GardenObjectDetails, { category: 'importedBackground' }>['details']
  > = {},
): GardenObjectDetails {
  return {
    category: 'importedBackground',
    details: {
      planMediaId: '01890000-0000-7000-8000-000000000001',
      isBackgroundVisible: true,
      calibrationState: 'uncalibrated',
      ...overrides,
    },
  };
}

function backgroundObject(details: GardenObjectDetails | undefined): MapObject {
  return {
    id: '01890000-0000-7000-8000-000000000002',
    gardenId: '01890000-0000-7000-8000-000000000003',
    coordinateSpaceId: '01890000-0000-7000-8000-000000000004',
    category: 'importedBackground',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
    label: null,
    provenance: 'importedPlan',
    confidence: null,
    isHidden: false,
    isLocked: false,
    lifecycleState: 'active',
    currentRevision: 1,
    details,
    createdByProfileId: '01890000-0000-7000-8000-000000000005',
    createdAt: new Date('2026-07-24T09:00:00Z'),
    updatedAt: new Date('2026-07-24T09:00:00Z'),
  };
}

describe('requireImportedBackgroundStateCreatable', () => {
  it('accepts an uncalibrated creation and non-background details', () => {
    expect(() => requireImportedBackgroundStateCreatable(backgroundDetails())).not.toThrow();
    expect(() =>
      requireImportedBackgroundStateCreatable({ category: 'zone', details: { zoneKind: 'lawn' } }),
    ).not.toThrow();
    expect(() => requireImportedBackgroundStateCreatable(undefined)).not.toThrow();
  });

  it('rejects creating a background that claims to be calibrated', () => {
    expect(() =>
      requireImportedBackgroundStateCreatable(
        backgroundDetails({ calibrationState: 'calibrated' }),
      ),
    ).toThrow(ValidationError);
  });
});

describe('requireImportedBackgroundStatePreserved', () => {
  it('accepts an echo of the current state', () => {
    const current = backgroundObject(backgroundDetails({ calibrationState: 'calibrated' }));
    expect(() =>
      requireImportedBackgroundStatePreserved(
        current,
        backgroundDetails({ calibrationState: 'calibrated', isBackgroundVisible: false }),
      ),
    ).not.toThrow();
  });

  it('rejects flipping the state in either direction', () => {
    const uncalibrated = backgroundObject(backgroundDetails());
    expect(() =>
      requireImportedBackgroundStatePreserved(
        uncalibrated,
        backgroundDetails({ calibrationState: 'calibrated' }),
      ),
    ).toThrow(ValidationError);

    const calibrated = backgroundObject(backgroundDetails({ calibrationState: 'calibrated' }));
    expect(() => requireImportedBackgroundStatePreserved(calibrated, backgroundDetails())).toThrow(
      ValidationError,
    );
  });
});

describe('withServerOwnedCalibration', () => {
  it('re-attaches the stored calibration block to a details replacement that lacks it', () => {
    const current = backgroundDetails({
      calibrationState: 'calibrated',
      calibration: CALIBRATION,
    });
    const submitted = backgroundDetails({
      calibrationState: 'calibrated',
      isBackgroundVisible: false,
    });

    const merged = withServerOwnedCalibration(current, submitted);
    expect(merged).toEqual(
      backgroundDetails({
        calibrationState: 'calibrated',
        isBackgroundVisible: false,
        calibration: CALIBRATION,
      }),
    );
  });

  it('replaces a client-echoed block with the stored one', () => {
    const current = backgroundDetails({
      calibrationState: 'calibrated',
      calibration: CALIBRATION,
    });
    const submitted = backgroundDetails({
      calibrationState: 'calibrated',
      calibration: { ...CALIBRATION, transformRevision: 99 },
    });

    const merged = withServerOwnedCalibration(current, submitted);
    expect(
      merged.category === 'importedBackground' ? merged.details.calibration : undefined,
    ).toEqual(CALIBRATION);
  });

  it('leaves non-background details untouched', () => {
    const zone: GardenObjectDetails = { category: 'zone', details: { zoneKind: 'lawn' } };
    expect(withServerOwnedCalibration(undefined, zone)).toBe(zone);
  });
});

describe('requireBackgroundGeometryEditable', () => {
  it('allows geometry edits on an uncalibrated background', () => {
    expect(() =>
      requireBackgroundGeometryEditable(backgroundObject(backgroundDetails())),
    ).not.toThrow();
  });

  it('rejects geometry edits on a calibrated background', () => {
    const calibrated = backgroundObject(
      backgroundDetails({ calibrationState: 'calibrated', calibration: CALIBRATION }),
    );
    expect(() => requireBackgroundGeometryEditable(calibrated)).toThrow(ValidationError);
  });
});

describe('uncalibratedDuplicateDetails', () => {
  it('resets a calibrated source to an uncalibrated copy without the block', () => {
    const source = backgroundDetails({
      calibrationState: 'calibrated',
      calibration: CALIBRATION,
    });
    expect(uncalibratedDuplicateDetails(source)).toEqual(backgroundDetails());
  });

  it('passes other categories through unchanged', () => {
    const zone: GardenObjectDetails = { category: 'zone', details: { zoneKind: 'lawn' } };
    expect(uncalibratedDuplicateDetails(zone)).toBe(zone);
    expect(uncalibratedDuplicateDetails(undefined)).toBeUndefined();
  });
});
