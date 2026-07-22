/**
 * Translates a PostgreSQL `CHECK` constraint violation raised by a
 * `garden_object`/detail-table write into a clean `ValidationError`, instead
 * of letting a raw driver error reach the global error handler as an
 * unexplained 500.
 *
 * Deliberately general rather than an allowlist of known constraint names:
 * every `CHECK`/`FOREIGN KEY` this module's own migration defines on these
 * tables (geometry validity, geometry/category type matching, category-
 * specific enum values, quantity/confidence ranges, `gate_details`'s
 * reference to its fence) represents a documented domain rule the *submitted
 * data* violated, by construction — this repository never issues a write
 * that could fail one of these checks through a bug in its own query rather
 * than through caller input. The constraint name still travels in the error
 * detail's `code`, so a client can special-case a specific rule if it needs
 * to.
 *
 * `FOREIGN KEY` is a safety net behind the application-level reference
 * checks (`validate-gate-fence-reference.ts`, `AssignPlantToTarget`'s own
 * target check) — those catch the common case with a specific error message
 * before any write is attempted; this catches the rare race where the
 * referenced row was deleted between that check and this write.
 *
 * Source: task instructions, "Validation to actually implement for this
 * pass... geometry validity... a violation surfaces as a Postgres error your
 * handler should translate to a clean ValidationError."
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
    { details: [{ code: `map.constraint_violation.${constraint}`, pointer }], cause: error },
  );
}
