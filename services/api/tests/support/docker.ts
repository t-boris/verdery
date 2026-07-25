/**
 * Docker availability detection for container-backed integration tests.
 *
 * Integration tests run against the real PostgreSQL/PostGIS image, which needs
 * a container runtime. Where none is available the suite must say so loudly and
 * skip, never silently substitute a weaker database.
 *
 * P7-QA-01 hardening: the probe used to run `docker info` once per suite
 * FILE with a single 15-second attempt. Under a saturated daemon (the same
 * saturation the startup semaphore in `postgres-container.ts` bounds) one
 * slow answer silently skipped a whole healthy suite — a green-looking run
 * with lost coverage. Now `tests/support/global-setup.ts` probes ONCE per
 * run (with retries) and hands the verdict to every fork through
 * `VERDERY_DOCKER_AVAILABLE`; the in-fork probe below remains only as the
 * fallback for a file executed outside this package's vitest config, and
 * retries before concluding the daemon is absent.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DOCKER_PROBE_TIMEOUT_MS = 15_000;
const DOCKER_PROBE_ATTEMPTS = 3;
const DOCKER_PROBE_RETRY_DELAY_MS = 2_000;

/** The global-setup handoff variable: `'1'` (available) or `'0'` (absent). */
export const DOCKER_AVAILABILITY_ENV_VAR = 'VERDERY_DOCKER_AVAILABLE';

/**
 * One `docker info` round-trip, retried so a momentarily overloaded daemon
 * is not mistaken for an absent one. A genuinely missing daemon fails each
 * attempt fast (connection refused), so the retries cost nothing there.
 */
export async function probeDockerDaemon(): Promise<boolean> {
  for (let attempt = 1; attempt <= DOCKER_PROBE_ATTEMPTS; attempt += 1) {
    try {
      await execFileAsync('docker', ['info'], { timeout: DOCKER_PROBE_TIMEOUT_MS });
      return true;
    } catch {
      if (attempt < DOCKER_PROBE_ATTEMPTS) {
        await sleep(DOCKER_PROBE_RETRY_DELAY_MS);
      }
    }
  }
  return false;
}

export async function isDockerAvailable(): Promise<boolean> {
  const fromGlobalSetup = process.env[DOCKER_AVAILABILITY_ENV_VAR];
  if (fromGlobalSetup === '1') {
    return true;
  }
  if (fromGlobalSetup === '0') {
    return false;
  }
  return probeDockerDaemon();
}

/** Reports a skipped container suite so a green run is never mistaken for coverage. */
export function warnDockerUnavailable(suiteName: string): void {
  console.warn(
    `[skipped] ${suiteName} requires a running Docker daemon. ` +
      'Start Docker and re-run to execute the container-backed migration tests.',
  );
}
