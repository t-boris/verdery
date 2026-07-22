/**
 * Joins class names, dropping the ones that are absent.
 *
 * CSS module lookups are typed as possibly undefined under
 * `noUncheckedIndexedAccess`; without this helper a missing class would be
 * interpolated into the DOM as the literal text `undefined`.
 */
export function classNames(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
