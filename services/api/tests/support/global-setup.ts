/**
 * Vitest global setup: one authoritative Docker probe per run (P7-QA-01).
 *
 * Runs in the main vitest process before any worker fork spawns, so the
 * verdict in `VERDERY_DOCKER_AVAILABLE` is inherited by every fork's
 * environment. This replaces ~64 per-file `docker info` probes with one
 * retried check — both faster and immune to the
 * probe-overruns-under-load failure mode that silently skipped healthy
 * suites (see `docker.ts`).
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { DOCKER_AVAILABILITY_ENV_VAR, probeDockerDaemon } from './docker.js';

export default async function globalSetup(): Promise<void> {
  const available = await probeDockerDaemon();
  process.env[DOCKER_AVAILABILITY_ENV_VAR] = available ? '1' : '0';
  if (!available) {
    console.warn(
      '[docker] No responsive Docker daemon found — every container-backed suite will skip. ' +
        'Start Docker and re-run for full coverage.',
    );
  }
}
