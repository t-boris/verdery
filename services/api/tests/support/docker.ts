/**
 * Docker availability detection for container-backed integration tests.
 *
 * Integration tests run against the real PostgreSQL/PostGIS image, which needs
 * a container runtime. Where none is available the suite must say so loudly and
 * skip, never silently substitute a weaker database.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DOCKER_PROBE_TIMEOUT_MS = 15_000;

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: DOCKER_PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/** Reports a skipped container suite so a green run is never mistaken for coverage. */
export function warnDockerUnavailable(suiteName: string): void {
  console.warn(
    `[skipped] ${suiteName} requires a running Docker daemon. ` +
      'Start Docker and re-run to execute the container-backed migration tests.',
  );
}
