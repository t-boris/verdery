/**
 * Client-update lifecycle HTTP routes (P9C-PUBLISH-01): list, create, get,
 * edit content, submit, publish, withdraw — the
 * `internal_draft -> ready_for_client -> published -> withdrawn` workflow.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "10. Publication Workflow".
 */

import type {
  ClientUpdate,
  ClientUpdateListResult,
  CreateClientUpdateRequest,
  PublicationVersion,
  PublishClientUpdateRequest,
  UpdateClientUpdateContentRequest,
  WithdrawClientUpdateRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CreateClientUpdate } from '../application/create-client-update.js';
import type { GetClientUpdate } from '../application/get-client-update.js';
import type { ListClientUpdatesForEngagement } from '../application/list-client-updates-for-engagement.js';
import type {
  PublishClientUpdate,
  PublishClientUpdateInput,
} from '../application/publish-client-update.js';
import type { SubmitClientUpdate } from '../application/submit-client-update.js';
import type {
  UpdateClientUpdateContent,
  UpdateClientUpdateContentInput,
} from '../application/update-client-update-content.js';
import type { WithdrawClientUpdate } from '../application/withdraw-client-update.js';
import {
  invalid,
  requireClientUpdateId,
  requireEngagementId,
  requireExpectedRevision,
  requireIdempotencyKey,
  UUID_PATTERN,
} from './route-helpers.js';

export interface ClientUpdateRoutesDependencies {
  readonly listClientUpdates: ListClientUpdatesForEngagement;
  readonly createClientUpdate: CreateClientUpdate;
  readonly getClientUpdate: GetClientUpdate;
  readonly updateClientUpdateContent: UpdateClientUpdateContent;
  readonly submitClientUpdate: SubmitClientUpdate;
  readonly publishClientUpdate: PublishClientUpdate;
  readonly withdrawClientUpdate: WithdrawClientUpdate;
}

function requireCreateBody(request: FastifyRequest): string {
  const body = request.body as Partial<CreateClientUpdateRequest> | undefined;

  if (typeof body?.title !== 'string' || body.title.trim().length === 0) {
    throw invalid('title must be a non-empty string.', 'request.invalid', '/title');
  }

  return body.title;
}

function requireUpdateContentBody(request: FastifyRequest): UpdateClientUpdateContentInput {
  const body = request.body as Partial<UpdateClientUpdateContentRequest> | undefined;

  if (body?.title === undefined && body?.summary === undefined) {
    throw invalid('At least one of title/summary must be supplied.', 'request.invalid', '/title');
  }
  if (
    body.title !== undefined &&
    (typeof body.title !== 'string' || body.title.trim().length === 0)
  ) {
    throw invalid('title must be a non-empty string.', 'request.invalid', '/title');
  }
  if (
    body.summary !== undefined &&
    (typeof body.summary !== 'string' || body.summary.trim().length === 0)
  ) {
    throw invalid('summary must be a non-empty string.', 'request.invalid', '/summary');
  }

  return {
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.summary === undefined ? {} : { summary: body.summary }),
  };
}

function parseWithdrawReason(request: FastifyRequest): string | null {
  const body = request.body as Partial<WithdrawClientUpdateRequest> | undefined;

  if (body?.reason === undefined) {
    return null;
  }
  if (typeof body.reason !== 'string') {
    throw invalid('reason must be a string.', 'request.invalid', '/reason');
  }

  return body.reason;
}

function requirePublishBody(request: FastifyRequest): PublishClientUpdateInput {
  const body = (request.body as Partial<PublishClientUpdateRequest> | undefined) ?? {};

  let gardenSnapshot: PublishClientUpdateInput['gardenSnapshot'] = null;
  if (body.gardenSnapshot !== undefined) {
    const snapshot = body.gardenSnapshot;
    if (typeof snapshot.overviewText !== 'string' || snapshot.overviewText.trim().length === 0) {
      throw invalid(
        'gardenSnapshot.overviewText must be a non-empty string.',
        'request.invalid',
        '/gardenSnapshot/overviewText',
      );
    }
    gardenSnapshot = {
      overviewText: snapshot.overviewText,
      snapshotData: snapshot.snapshotData ?? null,
    };
  }

  const timelineEntries = (body.timelineEntries ?? []).map((entry, index) => {
    if (typeof entry.entryText !== 'string' || entry.entryText.trim().length === 0) {
      throw invalid(
        'timelineEntries[].entryText must be a non-empty string.',
        'request.invalid',
        `/timelineEntries/${index}/entryText`,
      );
    }
    if (typeof entry.occurredAt !== 'string' || Number.isNaN(Date.parse(entry.occurredAt))) {
      throw invalid(
        'timelineEntries[].occurredAt must be a valid timestamp.',
        'request.invalid',
        `/timelineEntries/${index}/occurredAt`,
      );
    }
    return { entryText: entry.entryText, occurredAt: new Date(entry.occurredAt) };
  });

  const staffAttributions = (body.staffAttributions ?? []).map((attribution, index) => {
    if (
      typeof attribution.staffProfileId !== 'string' ||
      !UUID_PATTERN.test(attribution.staffProfileId)
    ) {
      throw invalid(
        'staffAttributions[].staffProfileId must be a UUID.',
        'request.invalid',
        `/staffAttributions/${index}/staffProfileId`,
      );
    }
    if (
      typeof attribution.displayName !== 'string' ||
      attribution.displayName.trim().length === 0
    ) {
      throw invalid(
        'staffAttributions[].displayName must be a non-empty string.',
        'request.invalid',
        `/staffAttributions/${index}/displayName`,
      );
    }
    return {
      staffProfileId: attribution.staffProfileId,
      displayName: attribution.displayName,
      roleLabel: attribution.roleLabel ?? null,
    };
  });

  return { gardenSnapshot, timelineEntries, staffAttributions };
}

export function registerClientUpdateRoutes(
  app: FastifyInstance,
  dependencies: ClientUpdateRoutesDependencies,
): void {
  app.get('/client-engagements/:engagementId/updates', async (request, reply) => {
    const engagementId = requireEngagementId(request);

    const result: ClientUpdateListResult = await dependencies.listClientUpdates.execute(
      engagementId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(result);
  });

  app.post('/client-engagements/:engagementId/updates', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const title = requireCreateBody(request);

    const update: ClientUpdate = await dependencies.createClientUpdate.execute(
      engagementId,
      title,
      request.actorContext.profileId,
      idempotencyKey,
    );

    return reply.status(201).send(update);
  });

  app.get('/client-engagements/:engagementId/updates/:clientUpdateId', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const clientUpdateId = requireClientUpdateId(request);

    const update: ClientUpdate = await dependencies.getClientUpdate.execute(
      engagementId,
      clientUpdateId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(update);
  });

  app.patch('/client-engagements/:engagementId/updates/:clientUpdateId', async (request, reply) => {
    const engagementId = requireEngagementId(request);
    const clientUpdateId = requireClientUpdateId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);
    const body = requireUpdateContentBody(request);

    const update: ClientUpdate = await dependencies.updateClientUpdateContent.execute(
      engagementId,
      clientUpdateId,
      body,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    return reply.status(200).send(update);
  });

  app.post(
    '/client-engagements/:engagementId/updates/:clientUpdateId/submit',
    async (request, reply) => {
      const engagementId = requireEngagementId(request);
      const clientUpdateId = requireClientUpdateId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);

      const update: ClientUpdate = await dependencies.submitClientUpdate.execute(
        engagementId,
        clientUpdateId,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(update);
    },
  );

  app.post(
    '/client-engagements/:engagementId/updates/:clientUpdateId/publish',
    async (request, reply) => {
      const engagementId = requireEngagementId(request);
      const clientUpdateId = requireClientUpdateId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);
      const body = requirePublishBody(request);

      const version: PublicationVersion = await dependencies.publishClientUpdate.execute(
        engagementId,
        clientUpdateId,
        body,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(version);
    },
  );

  app.post(
    '/client-engagements/:engagementId/updates/:clientUpdateId/withdraw',
    async (request, reply) => {
      const engagementId = requireEngagementId(request);
      const clientUpdateId = requireClientUpdateId(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const expectedRevision = requireExpectedRevision(request);
      const reason = parseWithdrawReason(request);

      const update: ClientUpdate = await dependencies.withdrawClientUpdate.execute(
        engagementId,
        clientUpdateId,
        reason,
        request.actorContext.profileId,
        expectedRevision,
        idempotencyKey,
      );

      return reply.status(200).send(update);
    },
  );
}
