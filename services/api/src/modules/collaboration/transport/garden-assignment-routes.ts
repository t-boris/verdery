/**
 * Organization-scoped garden-assignment HTTP routes (P9B-API-01).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Organizations`;
 * implementation-plan.md work package P9B-API-01.
 */

import type {
  CreateGardenAssignmentRequest,
  GardenAssignment,
  GardenAssignmentListResult,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CreateGardenAssignment } from '../application/create-garden-assignment.js';
import type { EndGardenAssignment } from '../application/end-garden-assignment.js';
import type { ListGardenAssignmentsForOrganization } from '../application/list-garden-assignments-for-organization.js';
import type { RevokeGardenAssignment } from '../application/revoke-garden-assignment.js';
import {
  invalid,
  requireAssignmentId,
  requireIdempotencyKey,
  requireOrganizationId,
  UUID_PATTERN,
} from './route-helpers.js';

export interface GardenAssignmentRoutesDependencies {
  readonly createGardenAssignment: CreateGardenAssignment;
  readonly listGardenAssignmentsForOrganization: ListGardenAssignmentsForOrganization;
  readonly endGardenAssignment: EndGardenAssignment;
  readonly revokeGardenAssignment: RevokeGardenAssignment;
}

const ASSIGNMENT_ROLES = new Set(['editor', 'viewer']);

function requireCreateAssignmentBody(request: FastifyRequest): CreateGardenAssignmentRequest {
  const body = request.body as Partial<CreateGardenAssignmentRequest> | undefined;

  if (typeof body?.profileId !== 'string' || !UUID_PATTERN.test(body.profileId)) {
    throw invalid('profileId must be a UUID.', 'request.invalid', '/profileId');
  }
  if (typeof body.gardenId !== 'string' || !UUID_PATTERN.test(body.gardenId)) {
    throw invalid('gardenId must be a UUID.', 'request.invalid', '/gardenId');
  }
  if (typeof body.role !== 'string' || !ASSIGNMENT_ROLES.has(body.role)) {
    throw invalid('role must be "editor" or "viewer".', 'request.invalid', '/role');
  }

  return body as CreateGardenAssignmentRequest;
}

export function registerGardenAssignmentRoutes(
  app: FastifyInstance,
  dependencies: GardenAssignmentRoutesDependencies,
): void {
  app.post('/service-organizations/:organizationId/garden-assignments', async (request, reply) => {
    const organizationId = requireOrganizationId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireCreateAssignmentBody(request);

    const assignment: GardenAssignment = await dependencies.createGardenAssignment.execute(
      organizationId,
      {
        profileId: body.profileId,
        gardenId: body.gardenId,
        role: body.role,
      },
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(201).send(assignment);
  });

  app.get('/service-organizations/:organizationId/garden-assignments', async (request, reply) => {
    const organizationId = requireOrganizationId(request);

    const result: GardenAssignmentListResult =
      await dependencies.listGardenAssignmentsForOrganization.execute(
        organizationId,
        request.actorContext.profileId,
      );

    return reply.status(200).send(result);
  });

  app.post(
    '/service-organizations/:organizationId/garden-assignments/:assignmentId/end',
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const assignmentId = requireAssignmentId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const assignment: GardenAssignment = await dependencies.endGardenAssignment.execute(
        organizationId,
        assignmentId,
        request.actorContext.profileId,
        idempotencyKey,
      );

      return reply.status(200).send(assignment);
    },
  );

  app.post(
    '/service-organizations/:organizationId/garden-assignments/:assignmentId/revoke',
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const assignmentId = requireAssignmentId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const assignment: GardenAssignment = await dependencies.revokeGardenAssignment.execute(
        organizationId,
        assignmentId,
        request.actorContext.profileId,
        idempotencyKey,
      );

      return reply.status(200).send(assignment);
    },
  );
}
