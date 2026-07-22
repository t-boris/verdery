/**
 * Pre-write geometry validation shared by every command that creates or
 * replaces a geometry.
 *
 * This runs *before* the database `CHECK` constraints
 * (`garden_object_geometry_valid_check`, `garden_object_geometry_type_check`)
 * for a better error: `@verdery/geometry-contracts`'s own `validateGeometry`
 * returns stable, specific issue codes a client can localize, where a
 * `CHECK` violation only carries a constraint name (see
 * `persistence/translate-check-violation.ts`, the safety net for whatever
 * this check does not catch).
 *
 * Source: task instructions, "Validation to actually implement for this
 * pass... geometry validity... category/geometry-type mismatch."
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { ErrorDetail } from '@verdery/api-contracts';
import type { GardenObjectCategory, Geometry } from '@verdery/geometry-contracts';
import { isGeometryTypeAllowedForCategory, validateGeometry } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';

export function requireValidGeometryForCategory(
  category: GardenObjectCategory,
  geometry: Geometry,
): void {
  if (!isGeometryTypeAllowedForCategory(category, geometry.type)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `A ${geometry.type} geometry is not valid for the ${category} category.`,
      { details: [{ code: 'map.geometry.category_mismatch', pointer: '/geometry' }] },
    );
  }

  const issues = validateGeometry(geometry).filter((issue) => issue.severity === 'error');
  if (issues.length > 0) {
    const details: ErrorDetail[] = issues.map((issue) => ({
      code: `map.${issue.code}`,
      pointer: '/geometry',
      ...(issue.parameters === undefined ? {} : { parameters: issue.parameters }),
    }));
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'The submitted geometry is not valid.',
      {
        details,
      },
    );
  }
}
