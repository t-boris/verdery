/**
 * Owner-administration HTTP routes (P9A-OWNER-01): promote to co-owner,
 * demote an owner, request an ownership transfer, accept or decline it as
 * its recipient, or cancel it as its initiator.
 *
 * A separate file from `member-routes.ts` rather than an addition to it —
 * `member-routes.ts` is P9A-API-01's already-shipped surface
 * (`listGardenMembers`/`changeGardenMemberRole`/`removeGardenMember`), which
 * this work package's own constraints leave untouched; these routes are new
 * endpoints with a distinct recent-auth precondition none of that file's
 * routes share (and, for accept/decline, deliberately NO recent-auth
 * precondition at all — see `accept-ownership-transfer.ts`'s header).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * implementation-plan.md work package P9A-OWNER-01.
 */

import type {
  ChangeGardenMemberRoleRequest,
  GardenMember,
  OwnershipTransfer,
  TransferOwnershipRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AcceptOwnershipTransfer } from '../application/accept-ownership-transfer.js';
import type { CancelOwnershipTransfer } from '../application/cancel-ownership-transfer.js';
import type { DeclineOwnershipTransfer } from '../application/decline-ownership-transfer.js';
import type { DemoteOwner } from '../application/demote-owner.js';
import type { PromoteToOwner } from '../application/promote-to-owner.js';
import type { TransferOwnership } from '../application/transfer-ownership.js';
import { invalid, requireGardenId, requireIdempotencyKey, UUID_PATTERN } from './garden-routes.js';

export interface OwnershipRoutesDependencies {
  readonly promoteToOwner: PromoteToOwner;
  readonly demoteOwner: DemoteOwner;
  readonly transferOwnership: TransferOwnership;
  readonly acceptOwnershipTransfer: AcceptOwnershipTransfer;
  readonly declineOwnershipTransfer: DeclineOwnershipTransfer;
  readonly cancelOwnershipTransfer: CancelOwnershipTransfer;
}

const CHANGEABLE_ROLES = new Set(['editor', 'viewer']);

function requireMemberProfileId(request: FastifyRequest): string {
  const { profileId } = request.params as { profileId?: unknown };

  if (typeof profileId !== 'string' || !UUID_PATTERN.test(profileId)) {
    throw invalid('profileId must be a UUID.', 'request.profile_id.invalid', '/profileId');
  }

  return profileId;
}

function requireDemoteRoleBody(request: FastifyRequest): ChangeGardenMemberRoleRequest {
  const body = request.body as Partial<ChangeGardenMemberRoleRequest> | undefined;

  if (typeof body?.role !== 'string' || !CHANGEABLE_ROLES.has(body.role)) {
    throw invalid('role must be "editor" or "viewer".', 'request.invalid', '/role');
  }

  return body as ChangeGardenMemberRoleRequest;
}

function requireTransferBody(request: FastifyRequest): TransferOwnershipRequest {
  const body = request.body as Partial<TransferOwnershipRequest> | undefined;

  if (typeof body?.toProfileId !== 'string' || !UUID_PATTERN.test(body.toProfileId)) {
    throw invalid('toProfileId must be a UUID.', 'request.invalid', '/toProfileId');
  }
  if (typeof body.resultingRole !== 'string' || !CHANGEABLE_ROLES.has(body.resultingRole)) {
    throw invalid(
      'resultingRole must be "editor" or "viewer".',
      'request.invalid',
      '/resultingRole',
    );
  }

  return body as TransferOwnershipRequest;
}

export function registerOwnershipRoutes(
  app: FastifyInstance,
  dependencies: OwnershipRoutesDependencies,
): void {
  app.post('/gardens/:gardenId/members/:profileId/promote', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const targetProfileId = requireMemberProfileId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const member: GardenMember = await dependencies.promoteToOwner.execute(
      gardenId,
      targetProfileId,
      request.actorContext,
      idempotencyKey,
    );

    return reply.status(200).send(member);
  });

  app.post('/gardens/:gardenId/members/:profileId/demote', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const targetProfileId = requireMemberProfileId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireDemoteRoleBody(request);

    const member: GardenMember = await dependencies.demoteOwner.execute(
      gardenId,
      targetProfileId,
      request.actorContext,
      body.role,
      idempotencyKey,
    );

    return reply.status(200).send(member);
  });

  app.post('/gardens/:gardenId/ownership-transfer', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireTransferBody(request);

    const transfer: OwnershipTransfer = await dependencies.transferOwnership.execute(
      gardenId,
      body.toProfileId,
      body.resultingRole,
      request.actorContext,
      idempotencyKey,
    );

    return reply.status(200).send(transfer);
  });

  app.delete('/gardens/:gardenId/ownership-transfer', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const transfer: OwnershipTransfer = await dependencies.cancelOwnershipTransfer.execute(
      gardenId,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(200).send(transfer);
  });

  app.post('/gardens/:gardenId/ownership-transfer/accept', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const transfer: OwnershipTransfer = await dependencies.acceptOwnershipTransfer.execute(
      gardenId,
      request.actorContext,
      idempotencyKey,
    );

    return reply.status(200).send(transfer);
  });

  app.post('/gardens/:gardenId/ownership-transfer/decline', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const transfer: OwnershipTransfer = await dependencies.declineOwnershipTransfer.execute(
      gardenId,
      request.actorContext,
      idempotencyKey,
    );

    return reply.status(200).send(transfer);
  });
}
