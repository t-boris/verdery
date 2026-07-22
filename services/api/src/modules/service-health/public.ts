/**
 * Public interface of the service-health module.
 *
 * Other modules and the composition root may import only from this file. The
 * module's domain, application internals, persistence, and transport files are
 * private to it.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { DependencyProbe } from './application/dependency-probe.js';
export type { LivenessSnapshot, ReadinessSnapshot } from './application/service-health.js';
export { ServiceHealth } from './application/service-health.js';
export type {
  DependencyAvailability,
  DependencyHealth,
  ReadinessStatus,
} from './domain/readiness.js';
export {
  DATABASE_DEPENDENCY_NAME,
  DatabaseDependencyProbe,
} from './persistence/database-dependency-probe.js';
export { registerHealthRoutes } from './transport/health-routes.js';
