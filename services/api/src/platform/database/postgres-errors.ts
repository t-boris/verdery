/**
 * Recognizes PostgreSQL error codes relevant to application-level conflict
 * handling, without depending on `pg`'s own error class (Kysely wraps and
 * re-throws driver errors, but the `code` field survives that).
 *
 * Source: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  );
}

/** True for a `CHECK` constraint violation — the garden map's geometry-validity and category-detail rules are enforced this way. */
export function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === CHECK_VIOLATION
  );
}

/** True for a `FOREIGN KEY` constraint violation — a race-condition safety net behind the application-level reference checks the garden map's command handlers run first (see `validate-gate-fence-reference.ts`). */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === FOREIGN_KEY_VIOLATION
  );
}

/** The violated constraint's name, when the driver reported one. */
export function postgresConstraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }
  const { constraint } = error as { constraint?: unknown };
  return typeof constraint === 'string' ? constraint : undefined;
}
