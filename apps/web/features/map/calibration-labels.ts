/**
 * The one place a background's calibration state/quality becomes user
 * text, shared by the canvas badge, the background panel, the property
 * panel, and the calibration panel — section 16's "displays calibration
 * quality and prevents false precision", phrased identically everywhere:
 * an honest ± estimate when one exists, an explicit "accuracy not
 * estimated" when it does not (below two control points), never an
 * implied zero.
 */

import type { ImportedBackgroundCalibration } from '@verdery/geometry-contracts';

import type { Translate } from '@/shared/localization/public';

/** Honest error formatting: centimetres below a metre, metres above — never more digits than the estimate supports. */
export function formatErrorMetres(value: number): string {
  return value < 1 ? `${(value * 100).toFixed(1)} cm` : `${value.toFixed(2)} m`;
}

/** The state/quality text for a background, calibrated or not. */
export function calibrationStateText(
  t: Translate,
  calibration: ImportedBackgroundCalibration | undefined,
): string {
  if (calibration === undefined) {
    return t('map.background.notCalibrated');
  }
  if (calibration.rmsErrorMetres === null) {
    return t('map.background.calibratedNoEstimate');
  }
  return t('map.background.calibratedError', {
    value: formatErrorMetres(calibration.rmsErrorMetres),
  });
}
