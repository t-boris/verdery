/**
 * Membership HTTP routes (P9A-API-01).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * implementation-plan.md work package P9A-API-01.
 */

import type { ChangeGardenMemberRoleRequest, GardenMember } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ChangeMemberRole } from '../application/change-member-role.js';
import type { ListGardenMembers } from '../application/list-garden-members.js';
import type { RemoveMember } from '../application/remove-member.js';
import { invalid, requireGardenId, requireIdempotencyKey, UUID_PATTERN } from './garden-routes.js';

export interface MemberRoutesDependencies {
  readonly listGardenMembers: ListGardenMembers;
  readonly changeMemberRole: ChangeMemberRole;
  readonly removeMember: RemoveMember;
}

const CHANGEABLE_ROLES = new Set(['editor', 'viewer']);

function requireMemberProfileId(request: FastifyRequest): string {
  const { profileId } = request.params as { profileId?: unknown };

  if (typeof profileId !== 'string' || !UUID_PATTERN.test(profileId)) {
    throw invalid('profileId must be a UUID.', 'request.profile_id.invalid', '/profileId');
  }

  return profileId;
}

function requireChangeRoleBody(request: FastifyRequest): ChangeGardenMemberRoleRequest {
  const body = request.body as Partial<ChangeGardenMemberRoleRequest> | undefined;

  if (typeof body?.role !== 'string' || !CHANGEABLE_ROLES.has(body.role)) {
    throw invalid('role must be "editor" or "viewer".', 'request.invalid', '/role');
  }

  return body as ChangeGardenMemberRoleRequest;
}

export function registerMemberRoutes(
  app: FastifyInstance,
  dependencies: MemberRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/members', async (request, reply) => {
    const gardenId = requireGardenId(request);

    const result = await dependencies.listGardenMembers.execute(
      gardenId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.patch('/gardens/:gardenId/members/:profileId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const targetProfileId = requireMemberProfileId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireChangeRoleBody(request);

    const member: GardenMember = await dependencies.changeMemberRole.execute(
      gardenId,
      targetProfileId,
      request.actorContext.profileId,
      body.role,
      idempotencyKey,
    );

    return reply.status(200).send(member);
  });

  app.delete('/gardens/:gardenId/members/:profileId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const targetProfileId = requireMemberProfileId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const member: GardenMember = await dependencies.removeMember.execute(
      gardenId,
      targetProfileId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(200).send(member);
  });
}
