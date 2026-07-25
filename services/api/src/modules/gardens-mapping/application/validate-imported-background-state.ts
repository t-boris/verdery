/**
 * Server-ownership rules for an imported background's calibration fields
 * (P6-PLAN-02), the state-transition sibling of
 * `validate-imported-plan-reference.ts`'s reference checks:
 *
 * - `calibrationState` changes only through the `upsertCalibration`
 *   command. `createObject` must say `uncalibrated` (a fresh background
 *   cannot claim a calibration that does not exist); `changeProperties`
 *   must echo the current stored state — both rejected loudly on mismatch
 *   rather than silently corrected.
 * - The `calibration` block is read-only on the wire (the transport parser
 *   never even materializes a client-supplied copy); `changeProperties`
 *   re-attaches the server's stored block so a details replacement can
 *   never strip it.
 * - A CALIBRATED background's geometry is derived from its transform (the
 *   page footprint `upsertCalibration` computes), so the geometry-editing
 *   commands (`moveObject`, `replaceGeometry`, `editVertex`) are rejected
 *   for it: letting them translate the footprint while the stored
 *   transform stays put would silently split the selectable outline from
 *   the rendered plan imagery. Placement adjustment of a calibrated
 *   background IS recalibration with a manual adjustment — the section-16
 *   path the web client's drag gesture takes.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { GardenObjectDetails } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { MapObject } from '../domain/map-object.js';

function invalidState(code: string, message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

/** `createObject` rule: a freshly created background is always uncalibrated. */
export function requireImportedBackgroundStateCreatable(
  details: GardenObjectDetails | undefined,
): void {
  if (details?.category !== 'importedBackground') {
    return;
  }
  if (details.details.calibrationState !== 'uncalibrated') {
    throw invalidState(
      'map.imported_background.calibration_state_not_creatable',
      'A newly created background is always uncalibrated; calibrate it with the upsertCalibration command.',
      '/categoryDetails/calibrationState',
    );
  }
}

/** `changeProperties` rule: the submitted state must echo the stored one — only `upsertCalibration` changes it. */
export function requireImportedBackgroundStatePreserved(
  current: MapObject,
  submitted: GardenObjectDetails | undefined,
): void {
  if (
    submitted?.category !== 'importedBackground' ||
    current.details?.category !== 'importedBackground'
  ) {
    return;
  }
  if (submitted.details.calibrationState !== current.details.details.calibrationState) {
    throw invalidState(
      'map.imported_background.calibration_state_immutable',
      'calibrationState changes only through the upsertCalibration command.',
      '/categoryDetails/calibrationState',
    );
  }
}

/**
 * Re-attaches the server-owned `calibration` block to a details
 * replacement, so `changeProperties` (which swaps details wholesale) can
 * never strip a calibrated background's transform out of the read model.
 */
export function withServerOwnedCalibration(
  current: GardenObjectDetails | undefined,
  submitted: GardenObjectDetails,
): GardenObjectDetails {
  if (submitted.category !== 'importedBackground' || current?.category !== 'importedBackground') {
    return submitted;
  }
  const stored = current.details.calibration;
  const { calibration: _submittedCopy, ...submittedRest } = submitted.details;
  return {
    category: 'importedBackground',
    details: { ...submittedRest, ...(stored === undefined ? {} : { calibration: stored }) },
  };
}

/** Geometry-editing rule — see the module doc comment's third bullet. */
export function requireBackgroundGeometryEditable(object: MapObject): void {
  if (
    object.details?.category === 'importedBackground' &&
    object.details.details.calibrationState === 'calibrated'
  ) {
    throw invalidState(
      'map.imported_background.geometry_locked_by_calibration',
      "A calibrated background's placement is its transform; adjust it by recalibrating (upsertCalibration with a manual adjustment), not by editing its footprint geometry.",
      '/objectId',
    );
  }
}

/**
 * `duplicateObject` rule: calibration revisions belong to the SOURCE
 * object, so a duplicate starts uncalibrated — its copied footprint is
 * just a placeholder placement, exactly like a freshly created background.
 */
export function uncalibratedDuplicateDetails(
  details: GardenObjectDetails | undefined,
): GardenObjectDetails | undefined {
  if (details?.category !== 'importedBackground') {
    return details;
  }
  const { calibration: _calibration, ...rest } = details.details;
  return {
    category: 'importedBackground',
    details: { ...rest, calibrationState: 'uncalibrated' },
  };
}
