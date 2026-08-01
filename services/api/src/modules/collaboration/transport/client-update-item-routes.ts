/**
 * Client-update item-staging HTTP routes (P9C-PUBLISH-01): stage/unstage a
 * work-log or media item on a draft update.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * migrations/1786800000000_engagement-publisher-grant-and-client-update-items.sql.
 */

import type { AddClientUpdateItemRequest, ClientUpdateItem } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AddClientUpdateItem,
  AddClientUpdateItemInput,
} from '../application/add-client-update-item.js';
import type { RemoveClientUpdateItem } from '../application/remove-client-update-item.js';
import {
  invalid,
  requireClientUpdateId,
  requireEngagementId,
  requireIdempotencyKey,
  requireItemId,
  UUID_PATTERN,
} from './route-helpers.js';

export interface ClientUpdateItemRoutesDependencies {
  readonly addClientUpdateItem: AddClientUpdateItem;
  readonly removeClientUpdateItem: RemoveClientUpdateItem;
}

const ITEM_KINDS = new Set(['work_log', 'media', 'observation']);
const MEDIA_ROLES = new Set(['before', 'after', 'general']);

function requireAddItemBody(request: FastifyRequest): AddClientUpdateItemInput {
  const body = request.body as Partial<AddClientUpdateItemRequest> | undefined;

  if (typeof body?.kind !== 'string' || !ITEM_KINDS.has(body.kind)) {
    throw invalid(
      'kind must be "work_log", "media", or "observation".',
      'request.invalid',
      '/kind',
    );
  }
  if (typeof body.occurredAt !== 'string' || Number.isNaN(Date.parse(body.occurredAt))) {
    throw invalid('occurredAt must be a valid timestamp.', 'request.invalid', '/occurredAt');
  }
  const occurredAt = new Date(body.occurredAt);

  if (body.kind === 'work_log') {
    if (typeof body.sourceWorkLogId !== 'string' || !UUID_PATTERN.test(body.sourceWorkLogId)) {
      throw invalid('sourceWorkLogId must be a UUID.', 'request.invalid', '/sourceWorkLogId');
    }
    if (typeof body.description !== 'string' || body.description.trim().length === 0) {
      throw invalid('description must be a non-empty string.', 'request.invalid', '/description');
    }
    return {
      kind: 'work_log',
      occurredAt,
      sourceWorkLogId: body.sourceWorkLogId,
      description: body.description,
    };
  }

  if (body.kind === 'observation') {
    if (
      typeof body.sourceObservationId !== 'string' ||
      !UUID_PATTERN.test(body.sourceObservationId)
    ) {
      throw invalid(
        'sourceObservationId must be a UUID.',
        'request.invalid',
        '/sourceObservationId',
      );
    }
    if (typeof body.description !== 'string' || body.description.trim().length === 0) {
      throw invalid('description must be a non-empty string.', 'request.invalid', '/description');
    }
    return {
      kind: 'observation',
      occurredAt,
      sourceObservationId: body.sourceObservationId,
      description: body.description,
    };
  }

  if (typeof body.mediaRecordId !== 'string' || !UUID_PATTERN.test(body.mediaRecordId)) {
    throw invalid('mediaRecordId must be a UUID.', 'request.invalid', '/mediaRecordId');
  }
  if (typeof body.mediaRole !== 'string' || !MEDIA_ROLES.has(body.mediaRole)) {
    throw invalid(
      'mediaRole must be "before", "after", or "general".',
      'request.invalid',
      '/mediaRole',
    );
  }
  if (body.caption !== undefined && typeof body.caption !== 'string') {
    throw invalid('caption must be a string.', 'request.invalid', '/caption');
  }

  return {
    kind: 'media',
    occurredAt,
    mediaRecordId: body.mediaRecordId,
    mediaRole: body.mediaRole,
    caption: body.caption ?? null,
  };
}

export function registerClientUpdateItemRoutes(
  app: FastifyInstance,
  dependencies: ClientUpdateItemRoutesDependencies,
): void {
  app.post(
    '/client-engagements/:engagementId/updates/:clientUpdateId/items',
    async (request, reply) => {
      const engagementId = requireEngagementId(request);
      const clientUpdateId = requireClientUpdateId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const body = requireAddItemBody(request);

      const item: ClientUpdateItem = await dependencies.addClientUpdateItem.execute(
        engagementId,
        clientUpdateId,
        body,
        request.actorContext.profileId,
        idempotencyKey,
      );

      return reply.status(201).send(item);
    },
  );

  app.delete(
    '/client-engagements/:engagementId/updates/:clientUpdateId/items/:itemId',
    async (request, reply) => {
      const engagementId = requireEngagementId(request);
      const clientUpdateId = requireClientUpdateId(request);
      const itemId = requireItemId(request);
      const idempotencyKey = requireIdempotencyKey(request);

      const item: ClientUpdateItem = await dependencies.removeClientUpdateItem.execute(
        engagementId,
        clientUpdateId,
        itemId,
        request.actorContext.profileId,
        idempotencyKey,
      );

      return reply.status(200).send(item);
    },
  );
}
