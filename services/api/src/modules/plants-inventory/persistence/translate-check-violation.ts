/**
 * Translates a PostgreSQL `CHECK`/`FOREIGN KEY` violation raised by a
 * `plant`/`plant_photo`/`plant_identification` write into a clean
 * `ValidationError`, instead of letting a raw driver error reach the global
 * error handler as an unexplained 500 — the same rationale gardens-mapping's
 * own `persistence/translate-check-violation.ts` documents in full; this is
 * this module's own copy, since that file is not exported through
 * gardens-mapping's `public.ts`.
 *
 * Every `CHECK` this module's own migration defines on these tables
 * (grouping-kind/lifecycle-stage/status enum membership, quantity
 * positivity, acquisition-date-type enum membership) is already enforced one
 * layer up by this module's own domain validation before a write is
 * attempted; this is a safety net behind that, not the primary defense — the
 * same relationship gardens-mapping's own copy describes for its `FOREIGN
 * KEY` case.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
  isCheckViolation,
  isForeignKeyViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import { ValidationError } from '../../../platform/errors/application-error.js';

/**
 * Returns a `ValidationError` when `error` is a `CHECK` or `FOREIGN KEY`
 * violation, `null` otherwise (letting the caller rethrow the original error
 * unchanged for anything not recognized as a domain-rule violation).
 */
export function translateCheckViolation(error: unknown, pointer: string): ValidationError | null {
  if (!isCheckViolation(error) && !isForeignKeyViolation(error)) {
    return null;
  }

  const constraint = postgresConstraintName(error) ?? 'unknown_constraint';

  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'The submitted data violates a database-enforced domain rule.',
    {
      details: [{ code: `plants_inventory.constraint_violation.${constraint}`, pointer }],
      cause: error,
    },
  );
}
