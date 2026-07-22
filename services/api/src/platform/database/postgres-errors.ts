/**
 * Recognizes PostgreSQL error codes relevant to application-level conflict
 * handling, without depending on `pg`'s own error class (Kysely wraps and
 * re-throws driver errors, but the `code` field survives that).
 *
 * Source: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  );
}
