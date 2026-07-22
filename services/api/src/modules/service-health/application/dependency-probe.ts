/**
 * Port for checking one required dependency.
 *
 * The application layer declares what it needs; adapters in `persistence/` and
 * `integration/` implement it. Readiness therefore gains a dependency without
 * the health use case learning what a database or a bucket is.
 *
 * Source: architecture/backend-modular-monolith.md, section "8. Dependency Direction".
 */

import type { DependencyHealth } from '../domain/readiness.js';

export interface DependencyProbe {
  /** Stable name reported to operators. */
  readonly name: string;

  /**
   * Resolves with the dependency's health. Implementations must not reject:
   * an unreachable dependency is a result, not an exception.
   */
  check(): Promise<DependencyHealth>;
}
