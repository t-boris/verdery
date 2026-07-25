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

import { formatFixed, type Locale, type Translate } from '@/shared/localization/public';

/**
 * Honest error formatting: centimetres below a metre, metres above — never
 * more digits than the estimate supports.
 *
 * Both the separator and the unit go through the catalogue. The previous
 * `toFixed` plus a literal `' cm'` put a POSIX decimal point and an English
 * abbreviation inside otherwise-Russian prose ("погрешность ±1.5 cm"). The
 * *digit counts* are unchanged, so this still renders the same figure as the
 * iOS client for the same stored RMS — the parity that mattered was the
 * precision, never the punctuation.
 */
export function formatErrorMetres(value: number, t: Translate, locale: Locale): string {
  return value < 1
    ? t('map.units.centimetres', { value: formatFixed(value * 100, 1, locale) })
    : t('map.units.metres', { value: formatFixed(value, 2, locale) });
}

/** The state/quality text for a background, calibrated or not. */
export function calibrationStateText(
  t: Translate,
  locale: Locale,
  calibration: ImportedBackgroundCalibration | undefined,
): string {
  if (calibration === undefined) {
    return t('map.background.notCalibrated');
  }
  if (calibration.rmsErrorMetres === null) {
    return t('map.background.calibratedNoEstimate');
  }
  return t('map.background.calibratedError', {
    value: formatErrorMetres(calibration.rmsErrorMetres, t, locale),
  });
}
