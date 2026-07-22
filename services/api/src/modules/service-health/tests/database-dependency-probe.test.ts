import { describe, expect, it } from 'vitest';
import type { DatabaseGateway } from '../../../platform/database/database-gateway.js';
import { DatabaseDependencyProbe } from '../persistence/database-dependency-probe.js';

function gateway(ping: () => Promise<void>): DatabaseGateway {
  return {
    queries: {} as DatabaseGateway['queries'],
    ping,
    close: () => Promise.resolve(),
  };
}

describe('DatabaseDependencyProbe', () => {
  it('reports the database as available when a trivial query succeeds', async () => {
    const probe = new DatabaseDependencyProbe(gateway(() => Promise.resolve()));

    await expect(probe.check()).resolves.toEqual({ name: 'database', availability: 'available' });
  });

  it('resolves rather than rejecting when the database is unreachable', async () => {
    const probe = new DatabaseDependencyProbe(
      gateway(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432'))),
    );

    const health = await probe.check();

    expect(health.availability).toBe('unavailable');
    // The readiness endpoint is unauthenticated, so the driver message — which
    // carries the database host — must not reach it.
    // Source: architecture/observability-and-analytics.md, section "6. Prohibited Telemetry".
    expect(health.detail).not.toContain('10.0.0.1');
  });
});
