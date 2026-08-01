/**
 * Makes a deliberate test-container teardown stop failing the run.
 *
 * THE FAILURE THIS CLOSES. Every container-backed suite ends its
 * `afterAll` with `await db.destroy()` then `await container.stop()` — the
 * correct order, verified across all of them. Under a loaded Docker daemon
 * the container (or Testcontainers' own reaper) can still kill the backend
 * while a pooled connection is mid-close, and PostgreSQL delivers `57P01`
 * (`admin_shutdown`) to that connection. `pg` surfaces a backend error on an
 * idle/closing pooled client as an `'error'` event ON THE POOL, and its own
 * documentation is explicit that a pool without an `'error'` listener
 * crashes the process. None of the 110 files that call `new pg.Pool(...)`
 * attaches one, so the event became an `uncaughtException`, which vitest
 * reports as an unhandled error and fails the job with — precisely — every
 * test passing (`345 passed`, `Errors 1 error`). The saturation half of this
 * is already documented in `postgres-container.ts`'s own header, which names
 * "teardown-time connection terminations (`57P01`)" as a known symptom; that
 * file bounded container STARTUPS and left this side open.
 *
 * WHY SUPPRESSING `57P01` IS NOT HIDING A BUG. The code means "the
 * administrator shut this server down". In a test run the only thing that
 * shuts a test container down is our own `container.stop()`. "The server we
 * asked to stop, stopped" is not a test result. Every other error code
 * re-throws exactly as before, so a genuine connection fault still fails the
 * run — this narrows the blast radius rather than muting the channel (the
 * reason `dangerouslyIgnoreUnhandledErrors` was rejected: it would mute
 * every unhandled error in the package).
 *
 * WHY A CONSTRUCTOR PATCH. The listener has to exist on each pool INSTANCE,
 * and 110 test files build their own with no shared factory. Wrapping the
 * constructor once, in a setup file that runs before any test module is
 * imported, is the only single-point fix; the alternative is editing 110
 * files and requiring every future one to remember.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration
 * Tests"; tests/support/postgres-container.ts.
 */

import pg from 'pg';

/** `admin_shutdown` — the server was deliberately stopped, which in a test run is always our own teardown. */
const POSTGRES_ADMIN_SHUTDOWN = '57P01';

function isAdminShutdown(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === POSTGRES_ADMIN_SHUTDOWN
  );
}

const UnguardedPool = pg.Pool;

class ShutdownGuardedPool extends UnguardedPool {
  constructor(...parameters: ConstructorParameters<typeof UnguardedPool>) {
    super(...parameters);

    this.on('error', (error: unknown) => {
      if (isAdminShutdown(error)) {
        return;
      }
      // Preserves the previous behaviour for every other code: an
      // unlistened pool error crashed the process, and a throw from here
      // still surfaces as the same uncaught exception.
      throw error;
    });
  }
}

pg.Pool = ShutdownGuardedPool;
