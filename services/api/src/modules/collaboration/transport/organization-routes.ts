/**
 * Service-organization HTTP routes (P9B-API-01).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Organizations`;
 * implementation-plan.md work package P9B-API-01.
 */

import type {
  CreateServiceOrganizationRequest,
  ServiceOrganization,
  ServiceOrganizationListResult,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CreateServiceOrganization } from '../application/create-service-organization.js';
import type { GetOrganization } from '../application/get-organization.js';
import type { ListOrganizations } from '../application/list-organizations.js';
import { invalid, requireIdempotencyKey, requireOrganizationId } from './route-helpers.js';

export interface OrganizationRoutesDependencies {
  readonly createServiceOrganization: CreateServiceOrganization;
  readonly listOrganizations: ListOrganizations;
  readonly getOrganization: GetOrganization;
}

function requireCreateOrganizationBody(request: FastifyRequest): CreateServiceOrganizationRequest {
  const body = request.body as Partial<CreateServiceOrganizationRequest> | undefined;

  if (typeof body?.name !== 'string') {
    throw invalid('name is required.', 'request.invalid', '/name');
  }

  return body as CreateServiceOrganizationRequest;
}

export function registerOrganizationRoutes(
  app: FastifyInstance,
  dependencies: OrganizationRoutesDependencies,
): void {
  app.post('/service-organizations', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireCreateOrganizationBody(request);

    const organization: ServiceOrganization = await dependencies.createServiceOrganization.execute(
      request.actorContext.profileId,
      body.name,
      idempotencyKey,
    );

    return reply.status(201).send(organization);
  });

  app.get('/service-organizations', async (request, reply) => {
    const result: ServiceOrganizationListResult = await dependencies.listOrganizations.execute(
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.get('/service-organizations/:organizationId', async (request, reply) => {
    const organizationId = requireOrganizationId(request);

    const organization: ServiceOrganization = await dependencies.getOrganization.execute(
      organizationId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(organization);
  });
}
