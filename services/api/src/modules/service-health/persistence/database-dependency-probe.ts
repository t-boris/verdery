/**
 * Database availability probe.
 *
 * Source: architecture/backend-modular-monolith.md, section "20. Health and Lifecycle".
 */

import type { DatabaseGateway } from '../../../platform/database/database-gateway.js';
import type { DependencyProbe } from '../application/dependency-probe.js';
import type { DependencyHealth } from '../domain/readiness.js';

export const DATABASE_DEPENDENCY_NAME = 'database';

export class DatabaseDependencyProbe implements DependencyProbe {
  readonly name = DATABASE_DEPENDENCY_NAME;

  readonly #database: DatabaseGateway;

  constructor(database: DatabaseGateway) {
    this.#database = database;
  }

  async check(): Promise<DependencyHealth> {
    try {
      await this.#database.ping();
      return { name: this.name, availability: 'available' };
    } catch {
      // The driver message can contain the host and connection string, and the
      // readiness response is unauthenticated, so it is replaced with a fixed
      // summary. The failure itself is logged by the caller.
      // Source: architecture/observability-and-analytics.md, section "6. Prohibited Telemetry".
      return {
        name: this.name,
        availability: 'unavailable',
        detail: 'The database did not answer a health query.',
      };
    }
  }
}
