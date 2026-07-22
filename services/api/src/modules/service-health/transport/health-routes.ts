/**
 * Health endpoints.
 *
 * The paths, schemas, and status codes are fixed by the contract document; this
 * file only maps the module's snapshots onto them.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `getLiveness` and
 * `getReadiness`.
 */

import type { DependencyStatus, LivenessResult, ReadinessResult } from '@verdery/api-contracts';
import type { FastifyInstance } from 'fastify';
import type { ReadinessSnapshot } from '../application/service-health.js';
import type { ServiceHealth } from '../application/service-health.js';
import type { DependencyHealth } from '../domain/readiness.js';

function toDependencyStatus(dependency: DependencyHealth): DependencyStatus {
  return {
    name: dependency.name,
    status: dependency.availability,
    ...(dependency.detail === undefined ? {} : { detail: dependency.detail }),
  };
}

function toReadinessResult(snapshot: ReadinessSnapshot): ReadinessResult {
  return {
    status: snapshot.status,
    version: snapshot.version,
    dependencies: snapshot.dependencies.map(toDependencyStatus),
  };
}

export function registerHealthRoutes(app: FastifyInstance, health: ServiceHealth): void {
  app.get('/health/live', (_request, reply) => {
    const result: LivenessResult = health.checkLiveness();

    return reply.status(200).send(result);
  });

  app.get('/health/ready', async (request, reply) => {
    const snapshot = await health.checkReadiness();

    if (snapshot.status === 'notReady') {
      const unavailable = snapshot.dependencies
        .filter((dependency) => dependency.availability === 'unavailable')
        .map((dependency) => dependency.name);

      request.log.warn(
        { event: 'service.not_ready', dependencies: unavailable },
        'Readiness check failed',
      );
    }

    // 503 makes the platform stop routing traffic to this instance rather than
    // letting it answer requests it cannot serve.
    const status = snapshot.status === 'ready' ? 200 : 503;

    return reply.status(status).send(toReadinessResult(snapshot));
  });
}
