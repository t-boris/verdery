/**
 * Organization membership HTTP routes (P9B-API-01).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Organizations`;
 * implementation-plan.md work package P9B-API-01.
 */

import type {
  AddOrganizationMemberRequest,
  ChangeOrganizationMemberRoleRequest,
  OrganizationMember,
  OrganizationMemberListResult,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AddOrganizationMember } from '../application/add-organization-member.js';
import type { ChangeOrganizationMemberRole } from '../application/change-organization-member-role.js';
import { fromOrganizationRoleRequest } from '../application/organization-view.js';
import type { ListOrganizationMembers } from '../application/list-organization-members.js';
import type { RemoveOrganizationMember } from '../application/remove-organization-member.js';
import {
  invalid,
  requireIdempotencyKey,
  requireOrganizationId,
  requireProfileId,
  UUID_PATTERN,
} from './route-helpers.js';

export interface OrganizationMemberRoutesDependencies {
  readonly listOrganizationMembers: ListOrganizationMembers;
  readonly addOrganizationMember: AddOrganizationMember;
  readonly changeOrganizationMemberRole: ChangeOrganizationMemberRole;
  readonly removeOrganizationMember: RemoveOrganizationMember;
}

const ORGANIZATION_ROLES = new Set(['organizationAdmin', 'professional']);

function requireAddMemberBody(request: FastifyRequest): AddOrganizationMemberRequest {
  const body = request.body as Partial<AddOrganizationMemberRequest> | undefined;

  if (typeof body?.profileId !== 'string' || !UUID_PATTERN.test(body.profileId)) {
    throw invalid('profileId must be a UUID.', 'request.invalid', '/profileId');
  }
  if (typeof body.role !== 'string' || !ORGANIZATION_ROLES.has(body.role)) {
    throw invalid(
      'role must be "organizationAdmin" or "professional".',
      'request.invalid',
      '/role',
    );
  }

  return body as AddOrganizationMemberRequest;
}

function requireChangeRoleBody(request: FastifyRequest): ChangeOrganizationMemberRoleRequest {
  const body = request.body as Partial<ChangeOrganizationMemberRoleRequest> | undefined;

  if (typeof body?.role !== 'string' || !ORGANIZATION_ROLES.has(body.role)) {
    throw invalid(
      'role must be "organizationAdmin" or "professional".',
      'request.invalid',
      '/role',
    );
  }

  return body as ChangeOrganizationMemberRoleRequest;
}

export function registerOrganizationMemberRoutes(
  app: FastifyInstance,
  dependencies: OrganizationMemberRoutesDependencies,
): void {
  app.get('/service-organizations/:organizationId/members', async (request, reply) => {
    const organizationId = requireOrganizationId(request);

    const result: OrganizationMemberListResult = await dependencies.listOrganizationMembers.execute(
      organizationId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.post('/service-organizations/:organizationId/members', async (request, reply) => {
    const organizationId = requireOrganizationId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireAddMemberBody(request);

    const member: OrganizationMember = await dependencies.addOrganizationMember.execute(
      organizationId,
      body.profileId,
      fromOrganizationRoleRequest(body.role),
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(201).send(member);
  });

  app.patch('/service-organizations/:organizationId/members/:profileId', async (request, reply) => {
    const organizationId = requireOrganizationId(request);
    const targetProfileId = requireProfileId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireChangeRoleBody(request);

    const member: OrganizationMember = await dependencies.changeOrganizationMemberRole.execute(
      organizationId,
      targetProfileId,
      request.actorContext.profileId,
      fromOrganizationRoleRequest(body.role),
      idempotencyKey,
    );

    return reply.status(200).send(member);
  });

  app.delete(
    '/service-organizations/:organizationId/members/:profileId',
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const targetProfileId = requireProfileId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const member: OrganizationMember = await dependencies.removeOrganizationMember.execute(
        organizationId,
        targetProfileId,
        request.actorContext.profileId,
        idempotencyKey,
      );

      return reply.status(200).send(member);
    },
  );
}
