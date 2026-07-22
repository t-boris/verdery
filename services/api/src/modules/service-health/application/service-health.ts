/**
 * Health use cases.
 *
 * Liveness deliberately ignores every probe: a degraded database must not cause
 * the platform to restart an otherwise healthy process.
 *
 * Source: architecture/backend-modular-monolith.md, section "20. Health and Lifecycle";
 * packages/api-contracts/openapi.yaml, operation `getLiveness`.
 */

import type { DependencyHealth, ReadinessStatus } from '../domain/readiness.js';
import { decideReadiness, LIVENESS_STATUS } from '../domain/readiness.js';
import type { DependencyProbe } from './dependency-probe.js';

export interface LivenessSnapshot {
  readonly status: typeof LIVENESS_STATUS;
  readonly version: string;
}

export interface ReadinessSnapshot {
  readonly status: ReadinessStatus;
  readonly version: string;
  readonly dependencies: readonly DependencyHealth[];
}

export class ServiceHealth {
  readonly #probes: readonly DependencyProbe[];

  readonly #version: string;

  constructor(probes: readonly DependencyProbe[], version: string) {
    this.#probes = probes;
    this.#version = version;
  }

  checkLiveness(): LivenessSnapshot {
    return { status: LIVENESS_STATUS, version: this.#version };
  }

  async checkReadiness(): Promise<ReadinessSnapshot> {
    // Probes run concurrently so that readiness latency is bounded by the
    // slowest dependency rather than by their sum.
    const dependencies = await Promise.all(this.#probes.map((probe) => probe.check()));

    return {
      status: decideReadiness(dependencies),
      version: this.#version,
      dependencies,
    };
  }
}
