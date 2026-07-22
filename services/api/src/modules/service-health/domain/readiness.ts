/**
 * Readiness rules.
 *
 * Liveness proves the process is running; readiness proves required
 * initialization completed and required dependencies answer. Keeping the rule
 * here — rather than inside a route handler — is what makes it testable without
 * an HTTP server or a database.
 *
 * Source: architecture/backend-modular-monolith.md, section "20. Health and Lifecycle".
 */

export type DependencyAvailability = 'available' | 'unavailable';

export interface DependencyHealth {
  /** Stable dependency name, for example `database`. */
  readonly name: string;
  readonly availability: DependencyAvailability;
  /** Non-sensitive summary. Never a driver message, host, or credential. */
  readonly detail?: string;
}

export type ReadinessStatus = 'ready' | 'notReady';

/** The process is alive whenever it can execute this function. */
export const LIVENESS_STATUS = 'alive' as const;

/**
 * A single unavailable required dependency makes the instance not ready, so the
 * platform stops routing traffic to it instead of returning failures to users.
 */
export function decideReadiness(dependencies: readonly DependencyHealth[]): ReadinessStatus {
  const allAvailable = dependencies.every((dependency) => dependency.availability === 'available');

  return allAvailable ? 'ready' : 'notReady';
}
