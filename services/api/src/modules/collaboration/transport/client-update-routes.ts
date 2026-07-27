/**
 * Client-update lifecycle HTTP routes (P9C-PUBLISH-01): list, create, get,
 * edit content, submit, publish, withdraw — the
 * `internal_draft -> ready_for_client -> published -> withdrawn` workflow.
 *
 * PUBLISH/WITHDRAW TELEMETRY (P9C-OBS-01). `POST .../publish` logs
 * `client_update.publish_completed` on success — `versionNumber` (`1` is a
 * first publish, `> 1` is a correction/re-publish, serving "publication
 * correction ... rate" alongside `withdraw_completed` below) and
 * `workToPublicationLagMs` ("time from work completion to publication",
 * section 19), computed PURELY from the `PublicationVersion` the command
 * already returned — the SAME "no second query" posture
 * `sync-routes.ts`'s own `pullLagMilliseconds` comment documents: every
 * `work_log`-kind item already carries its own `occurredAt`, and the
 * version already carries `publishedAt`, so this is the gap between the
 * LATEST included work and the moment it was published. Absent when the
 * publish included no `work_log` item (nothing to measure a gap from) —
 * the identical "absent when not computable" convention `pullLagMilliseconds`
 * itself uses. `POST .../withdraw` logs `client_update.withdraw_completed`
 * ("... or withdrawal rate", the same section), never the withdrawal
 * reason (only whether one was given). Either route logs
 * `authorization.denied` (`surface: 'publisher_grant'`) instead, on a
 * caller who administers the engagement but holds no publisher grant.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * implementation-plan.md work packages P9C-PUBLISH-01, P9C-OBS-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "10. Publication Workflow", "19. Audit and Observability".
 */

import {
  type ClientUpdate,
  type ClientUpdateListResult,
  ClientUpdateErrorCode,
  type CreateClientUpdateRequest,
  type PublicationVersion,
  type PublishClientUpdateRequest,
  type UpdateClientUpdateContentRequest,
  type WithdrawClientUpdateRequest,
} from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../platform/errors/application-error.js';
import { logAuthorizationDenial } from '../../../platform/telemetry/authorization-denial-log.js';
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

/** `true` only for the caller who administers the engagement but holds no active publisher grant — every OTHER failure (not-found, state-machine, revision) is left uninstrumented here, unchanged from before this package. */
function isPublisherAccessDenial(error: unknown): boolean {
  return (
    error instanceof ApplicationError &&
    error.code === ClientUpdateErrorCode.PublisherAccessRequired
  );
}

/**
 * "Time from work completion to publication" (section 19), computed from
 * data the response already carries — see this file's own header. `null`
 * when the publish included no `work_log` item.
 */
function computeWorkToPublicationLagMs(version: PublicationVersion): number | undefined {
  const workLogOccurredAtValues = version.items
    .filter((item) => item.kind === 'work_log')
    .map((item) => new Date(item.occurredAt).getTime());
  if (workLogOccurredAtValues.length === 0) {
    return undefined;
  }
  const latestWorkCompletedAt = Math.max(...workLogOccurredAtValues);
  return new Date(version.publishedAt).getTime() - latestWorkCompletedAt;
}

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

      let version: PublicationVersion;
      try {
        version = await dependencies.publishClientUpdate.execute(
          engagementId,
          clientUpdateId,
          body,
          request.actorContext.profileId,
          expectedRevision,
          idempotencyKey,
        );
      } catch (error) {
        if (isPublisherAccessDenial(error)) {
          logAuthorizationDenial(request.log, {
            surface: 'publisher_grant',
            reasonCategory: 'not_entitled',
            route: request.routeOptions?.url ?? request.url,
          });
        }
        throw error;
      }

      const workToPublicationLagMs = computeWorkToPublicationLagMs(version);
      request.log.info(
        {
          event: 'client_update.publish_completed',
          engagementId,
          versionNumber: version.versionNumber,
          itemCount: version.items.length,
          workLogItemCount: version.items.filter((item) => item.kind === 'work_log').length,
          mediaItemCount: version.items.filter((item) => item.kind === 'media').length,
          ...(workToPublicationLagMs === undefined ? {} : { workToPublicationLagMs }),
        },
        'Client update published',
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

      let update: ClientUpdate;
      try {
        update = await dependencies.withdrawClientUpdate.execute(
          engagementId,
          clientUpdateId,
          reason,
          request.actorContext.profileId,
          expectedRevision,
          idempotencyKey,
        );
      } catch (error) {
        if (isPublisherAccessDenial(error)) {
          logAuthorizationDenial(request.log, {
            surface: 'publisher_grant',
            reasonCategory: 'not_entitled',
            route: request.routeOptions?.url ?? request.url,
          });
        }
        throw error;
      }

      request.log.info(
        {
          event: 'client_update.withdraw_completed',
          engagementId,
          hasReason: reason !== null,
        },
        'Client update withdrawn',
      );

      return reply.status(200).send(update);
    },
  );
}
