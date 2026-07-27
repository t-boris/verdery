/**
 * Stages a work-log or media item on a draft update (P9C-PUBLISH-01) — one
 * command for both kinds, discriminated by `kind`, rather than two
 * near-duplicate commands: the validation and staging shapes differ only in
 * which fields matter, and a single switch keeps that difference in one
 * place.
 *
 * `internal_draft` only — see `client-update-errors.ts`'s own
 * `clientUpdateContentLockedError`. `kind: work_log` requires
 * `sourceWorkLogId` to resolve to a real work log belonging to the SAME
 * garden as the client update (`work_log.garden_id === clientUpdate
 * .gardenId`); `kind: media` requires `mediaRecordId` to resolve to a real,
 * `available` media record in the same garden. Both existence/garden checks
 * run again at publish time (`PublishClientUpdate` step 2) since staged
 * content can go stale between selection and publication (media deleted,
 * work log... though `work_log` carries no delete path today, so only the
 * media half is genuinely at risk of going stale between staging and
 * publish).
 *
 * NO REVISION GUARD AGAINST `client_update.revision`. Items live in a
 * separate, independently mutable table — adding one does not itself
 * advance the draft's own revision. The `internal_draft`-only state check is
 * re-read fresh at write time (not revision-guarded, not row-locked): this
 * is a bounded, documented simplification appropriate for a low-stakes
 * staging convenience action, unlike the publish transaction itself, which
 * genuinely needs and gets a real concurrency proof.
 *
 * Refused with `409` when the same `sourceWorkLogId`/`mediaRecordId` is
 * already staged on this draft (`client_update_item_work_log_key`/
 * `client_update_item_media_key`) — the same dual pre-check-plus-catch
 * pattern this module's every insert command already establishes.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * migrations/1786800000000_engagement-publisher-grant-and-client-update-items.sql.
 */

import type { ClientUpdateItem as ClientUpdateItemResource } from '@verdery/api-contracts';
import { ClientUpdateErrorCode } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import { ConflictError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import {
  clientUpdateContentLockedError,
  selectedItemInvalidError,
} from './client-update-errors.js';
import { toClientUpdateItemResource } from './client-update-view.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { PublicationMediaRole } from './client-update-item-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { requireClientUpdateAndAuthorize } from './require-client-update-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { WorkLogRepository } from './work-log-repository.js';

const OPERATION = 'client_engagements.updates.items.add';
const WORK_LOG_ITEM_CONSTRAINT = 'client_update_item_work_log_key';
const MEDIA_ITEM_CONSTRAINT = 'client_update_item_media_key';

export type AddClientUpdateItemInput =
  | {
      readonly kind: 'work_log';
      readonly occurredAt: Date;
      readonly sourceWorkLogId: Uuid;
      readonly description: string;
    }
  | {
      readonly kind: 'media';
      readonly occurredAt: Date;
      readonly mediaRecordId: Uuid;
      readonly mediaRole: PublicationMediaRole;
      readonly caption: string | null;
    };

function isMediaClientSafe(media: MediaRecord, gardenId: Uuid): boolean {
  return media.gardenId === gardenId && media.uploadState === 'available';
}

function alreadyStaged(cause?: unknown): ConflictError {
  return new ConflictError(
    ClientUpdateErrorCode.InvalidTransition,
    'This item is already staged on this draft.',
    cause === undefined ? {} : { cause },
  );
}

export class AddClientUpdateItem {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly publisherAuthorization: PublisherAuthorization,
    private readonly engagements: ClientEngagementRepository,
    private readonly clientUpdates: ClientUpdateRepository,
    private readonly workLogs: WorkLogRepository,
    private readonly media: MediaRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    clientUpdateId: Uuid,
    request: AddClientUpdateItemInput,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<ClientUpdateItemResource> {
    const { clientUpdate } = await requireClientUpdateAndAuthorize(
      this.engagements,
      this.clientUpdates,
      this.publisherAuthorization,
      engagementId,
      clientUpdateId,
      actorProfileId,
    );

    if (clientUpdate.state !== 'internal_draft') {
      throw clientUpdateContentLockedError();
    }

    if (request.kind === 'work_log') {
      const workLog = await this.workLogs.findById(request.sourceWorkLogId);
      if (workLog === null || workLog.gardenId !== clientUpdate.gardenId) {
        throw selectedItemInvalidError([
          { code: 'client_update.selected_item_invalid', pointer: '/sourceWorkLogId' },
        ]);
      }
    } else {
      const media = await this.media.get(request.mediaRecordId);
      if (media === null || !isMediaClientSafe(media, clientUpdate.gardenId)) {
        throw selectedItemInvalidError([
          { code: 'client_update.selected_item_invalid', pointer: '/mediaRecordId' },
        ]);
      }
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, clientUpdateId, request }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const id = generateUuidV7();
      const now = this.clock.now();

      try {
        if (request.kind === 'work_log') {
          await context.clientUpdateItems.insert({
            id,
            clientUpdateId,
            kind: 'work_log',
            occurredAt: request.occurredAt,
            sourceWorkLogId: request.sourceWorkLogId,
            description: request.description,
            now,
          });
        } else {
          await context.clientUpdateItems.insert({
            id,
            clientUpdateId,
            kind: 'media',
            occurredAt: request.occurredAt,
            mediaRecordId: request.mediaRecordId,
            mediaRole: request.mediaRole,
            caption: request.caption,
            now,
          });
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          const constraint = postgresConstraintName(error);
          if (constraint === WORK_LOG_ITEM_CONSTRAINT || constraint === MEDIA_ITEM_CONSTRAINT) {
            throw alreadyStaged(error);
          }
        }
        throw error;
      }

      await context.auditLogger.record({
        eventType: 'client_update.item_added',
        subjectType: 'client_update_item',
        subjectId: id,
        actorProfileId,
        actorType: 'user',
        gardenId: clientUpdate.gardenId,
        details: { engagementId, clientUpdateId, kind: request.kind },
      });
      await context.outbox.append({
        eventType: 'client_update.item_added',
        aggregateType: 'client_update_item',
        aggregateId: id,
        payload: { engagementId, clientUpdateId, kind: request.kind },
      });

      return toClientUpdateItemResource(
        request.kind === 'work_log'
          ? {
              id,
              clientUpdateId,
              kind: 'work_log',
              occurredAt: request.occurredAt,
              sourceWorkLogId: request.sourceWorkLogId,
              description: request.description,
              mediaRecordId: null,
              mediaRole: null,
              caption: null,
              createdAt: now,
            }
          : {
              id,
              clientUpdateId,
              kind: 'media',
              occurredAt: request.occurredAt,
              sourceWorkLogId: null,
              description: null,
              mediaRecordId: request.mediaRecordId,
              mediaRole: request.mediaRole,
              caption: request.caption,
              createdAt: now,
            },
      );
    });
  }
}
