import { describe, expect, it, vi } from 'vitest';
import type { DependencyProbe } from '../application/dependency-probe.js';
import { ServiceHealth } from '../application/service-health.js';
import type { DependencyHealth } from '../domain/readiness.js';

function probe(name: string, health: DependencyHealth, spy = vi.fn()): DependencyProbe {
  return {
    name,
    check: async () => {
      spy();
      return Promise.resolve(health);
    },
  };
}

const SERVICE_VERSION = '1.2.3';

describe('ServiceHealth', () => {
  it('reports liveness without consulting any dependency', () => {
    const checked = vi.fn();
    const health = new ServiceHealth(
      [probe('database', { name: 'database', availability: 'available' }, checked)],
      SERVICE_VERSION,
    );

    expect(health.checkLiveness()).toEqual({ status: 'alive', version: SERVICE_VERSION });
    expect(checked).not.toHaveBeenCalled();
  });

  it('reports readiness with every dependency it checked', async () => {
    const health = new ServiceHealth(
      [
        probe('database', { name: 'database', availability: 'available' }),
        probe('storage', { name: 'storage', availability: 'available' }),
      ],
      SERVICE_VERSION,
    );

    await expect(health.checkReadiness()).resolves.toEqual({
      status: 'ready',
      version: SERVICE_VERSION,
      dependencies: [
        { name: 'database', availability: 'available' },
        { name: 'storage', availability: 'available' },
      ],
    });
  });

  it('is not ready while a required dependency is unavailable', async () => {
    const health = new ServiceHealth(
      [
        probe('database', {
          name: 'database',
          availability: 'unavailable',
          detail: 'The database did not answer a health query.',
        }),
      ],
      SERVICE_VERSION,
    );

    const snapshot = await health.checkReadiness();

    expect(snapshot.status).toBe('notReady');
    expect(snapshot.dependencies[0]?.availability).toBe('unavailable');
  });
});
