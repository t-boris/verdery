/**
 * Cross-checks a command's `categoryDetails` against the object's own
 * category — shared by `CreateMapObject` and `ChangeMapObjectProperties`,
 * the two commands a client can attach `categoryDetails` to.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import type { GardenObjectCategory, GardenObjectDetails } from '@verdery/geometry-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';

export function requireMatchingCategoryDetails(
  category: GardenObjectCategory,
  details: GardenObjectDetails | undefined,
): void {
  if (details === undefined) {
    return;
  }

  if (details.category !== category) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `categoryDetails is for category "${details.category}", but this object's category is "${category}".`,
      {
        details: [{ code: 'map.category_details.category_mismatch', pointer: '/categoryDetails' }],
      },
    );
  }
}
