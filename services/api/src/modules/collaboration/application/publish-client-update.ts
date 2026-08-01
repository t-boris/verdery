/**
 * Publishes a ready-for-client update (P9C-PUBLISH-01):
 * `ready_for_client -> published`. The six-step publish transaction
 * (collaboration-and-client-sharing.md section 10), mapped onto real code:
 *
 *   1. REVALIDATES CAPABILITIES. `PublisherAuthorization.requireActiveGrant`
 *      re-checks the caller's publisher grant fresh (never assumed from an
 *      earlier request); inside the transaction, the engagement is re-read
 *      and its `state` re-checked `active`, and the garden every selected
 *      item must belong to is the client update's own `gardenId`. This
 *      package deliberately revalidates the PUBLISHER grant and the
 *      ENGAGEMENT/GARDEN facts; it does not additionally re-walk the
 *      granting actor's own current organization membership or assignment
 *      standing — `publisher_grant` is the one authoritative capability row
 *      ADR-0012 names as "separate," and nothing in this codebase cascades
 *      a later organization-membership change into an automatic grant
 *      revocation (the identical non-cascading posture
 *      `RemoveOrganizationMember` already takes toward `garden_assignment`).
 *      Documented here rather than silently assumed.
 *   2. RE-VALIDATES SELECTED ITEMS. Every staged `work_log`/`media` item is
 *      re-fetched and re-checked against the client update's own garden
 *      (media additionally re-checked `available`); every inline
 *      `staffAttributions` entry is re-checked against a real profile.
 *      `gardenSnapshot`/`timelineEntries` carry no cross-reference to
 *      re-validate beyond the schema's own not-blank text constraints.
 *   3. CREATES THE IMMUTABLE VERSION AND ITEM SNAPSHOTS —
 *      `PublicationRepository.create`.
 *   4. CREATES MEDIA ENTITLEMENTS — the SAME `create()` call, one row per
 *      media item (see that repository's own header for why one call
 *      legitimately performs two of the six steps).
 *   5. APPENDS AUDIT AND OUTBOX ATOMICALLY — in the SAME transaction as the
 *      guarded `client_update` write and the publication insert.
 *   6. SCHEDULES A NOTIFICATION ONLY AFTER COMMIT — the outbox event IS
 *      that deferral mechanism: nothing here calls a notification provider
 *      synchronously; a worker consumes the appended event strictly after
 *      this transaction commits, the identical "domain event through the
 *      outbox" shape `AssignTask`'s own `task.assigned` event already
 *      establishes.
 *
 * `gardenSnapshot`/`timelineEntries`/`staffAttributions` are supplied
 * DIRECTLY in this request, never staged in advance — see the
 * P9C-PUBLISH-01 migration's own header, "SCOPE: WORK-LOG AND MEDIA
 * REFERENCES ONLY", for why only those two kinds are staged.
 *
 * CONCURRENCY: the client-update write is a strict
 * `WHERE revision = expectedRevision AND state = 'ready_for_client'`
 * conditional update, attempted BEFORE the (more expensive) snapshot
 * inserts — the loser of two publishers racing to publish the SAME update
 * fails fast on this guard with `412`, never reaching the snapshot-insert
 * work at all. This is the SAME `WHERE revision = ?` mechanism
 * `AssignTask`'s own revision guard uses, proven here against genuine
 * concurrent Postgres transactions in
 * `tests/integration/collaboration-publications.test.ts`.
 *
 * IDEMPOTENCY, TWO LAYERS. A retry that reuses the SAME `Idempotency-Key`
 * replays the stored result via `runIdempotentCommand`, unchanged from
 * every other command in this module. A retry that does NOT reuse the key
 * fails cleanly before any write is attempted: if `expectedRevision` is now
 * stale (the ordinary case — publishing advances the revision), `412`; if
 * it happens to match the CURRENT (already-published) revision, the
 * state-transition check catches the self-loop
 * (`isValidPublicationTransition('published', 'published')` is `false` —
 * this machine has no edge back to `published`) and raises a specific `409`
 * (`alreadyPublished`), distinct from the generic `422` every OTHER invalid
 * transition (from `internal_draft` or `withdrawn`) raises. The
 * `publication_version.client_update_id` UNIQUE constraint is a THIRD,
 * defense-in-depth layer beneath both: the revision guard already makes
 * reaching a duplicate insert unreachable through this command's own
 * ordinary call path, so a caught violation here is translated into the
 * SAME clean `409`, never surfaced as a raw constraint violation, exactly
 * like `AddOrganizationMember`'s own dual guard.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "10. Publication Workflow", "11. Publication Contents".
 */

import type { PublicationVersion as PublicationVersionResource } from '@verdery/api-contracts';
import type { ClientUpdatePublishedEventPayload } from '@verdery/api-contracts';
import { CLIENT_UPDATE_PUBLISHED_EVENT_TYPE, ClientUpdateErrorCode } from '@verdery/api-contracts';
import { isValidPublicationTransition } from '../domain/publication-state.js';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import {
  ConflictError,
  DomainRuleViolatedError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { ProfileRepository } from '../../identity-access/public.js';
import type { MediaRecord, MediaRepository } from '../../media/public.js';
import type { ObservationRepository } from '../../observations-history/public.js';
import {
  clientUpdateInvalidTransitionError,
  clientUpdateNotFoundError,
  clientUpdateStaleRevisionError,
  engagementNotFoundError,
  selectedItemInvalidError,
  staffProfileNotFoundError,
} from './client-update-errors.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type {
  CreatePublicationVersionInput,
  PublicationGardenSnapshotItemInput,
  PublicationMediaItemInput,
  PublicationObservationItemInput,
  PublicationStaffAttributionInput,
  PublicationTimelineEntryItemInput,
  PublicationWorkLogItemInput,
} from './publication-repository.js';
import { toPublicationVersionResource } from './publication-view.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { requireClientUpdateAndAuthorize } from './require-client-update-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.updates.publish';
const TARGET_STATE = 'published';
const VERSION_UNIQUE_CONSTRAINT = 'publication_version_client_update_id_key';

export interface PublishGardenSnapshotInput {
  readonly overviewText: string;
  readonly snapshotData: unknown;
}

export interface PublishTimelineEntryInput {
  readonly entryText: string;
  readonly occurredAt: Date;
}

export interface PublishStaffAttributionRequestInput {
  readonly staffProfileId: Uuid;
  readonly displayName: string;
  readonly roleLabel: string | null;
}

export interface PublishClientUpdateInput {
  readonly gardenSnapshot: PublishGardenSnapshotInput | null;
  readonly timelineEntries: readonly PublishTimelineEntryInput[];
  readonly staffAttributions: readonly PublishStaffAttributionRequestInput[];
}

function alreadyPublished(cause?: unknown): ConflictError {
  return new ConflictError(
    ClientUpdateErrorCode.InvalidTransition,
    'This client update has already been published.',
    cause === undefined ? {} : { cause },
  );
}

function isMediaClientSafe(media: MediaRecord, gardenId: Uuid): boolean {
  // Kept in lockstep with `add-client-update-item.ts`'s own copy of this
  // function — see that file's doc comment for why `derivedFromMediaId`
  // is checked (excludes originals, whose bytes can carry EXIF/GPS).
  return (
    media.gardenId === gardenId &&
    media.uploadState === 'available' &&
    media.derivedFromMediaId !== null
  );
}

export class PublishClientUpdate {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly publisherAuthorization: PublisherAuthorization,
    private readonly engagements: ClientEngagementRepository,
    private readonly clientUpdates: ClientUpdateRepository,
    private readonly media: MediaRepository,
    private readonly observations: ObservationRepository,
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    clientUpdateId: Uuid,
    request: PublishClientUpdateInput,
    actorProfileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<PublicationVersionResource> {
    await requireClientUpdateAndAuthorize(
      this.engagements,
      this.clientUpdates,
      this.publisherAuthorization,
      engagementId,
      clientUpdateId,
      actorProfileId,
    );

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        engagementId,
        clientUpdateId,
        expectedRevision,
        request,
      }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      // Step 1 (partial — the fresh, transaction-scoped half): re-read the
      // engagement and the client update, never trusting the pre-transaction
      // reads above.
      const engagement = await context.clientEngagements.findById(engagementId);
      if (engagement === null) {
        throw engagementNotFoundError();
      }
      if (engagement.state !== 'active') {
        throw new DomainRuleViolatedError(
          ClientUpdateErrorCode.EngagementNotActive,
          'A client update can only be published while its engagement is active.',
        );
      }

      const clientUpdate = await context.clientUpdates.findByIdAndEngagement(
        clientUpdateId,
        engagementId,
      );
      if (clientUpdate === null) {
        throw clientUpdateNotFoundError();
      }
      if (clientUpdate.revision !== expectedRevision) {
        throw clientUpdateStaleRevisionError(clientUpdate.revision);
      }
      if (!isValidPublicationTransition(clientUpdate.state, TARGET_STATE)) {
        throw clientUpdate.state === TARGET_STATE
          ? alreadyPublished()
          : clientUpdateInvalidTransitionError(
              `Cannot publish a client update in state "${clientUpdate.state}".`,
            );
      }
      // Guaranteed by `client_update_summary_required_check` once
      // `ready_for_client`, but never trust a CHECK's guarantee silently.
      if (clientUpdate.summary === null) {
        throw clientUpdateInvalidTransitionError('A ready-for-client update must have a summary.');
      }

      // Step 2: re-validate every staged and inline item.
      const stagedItems = await context.clientUpdateItems.listForClientUpdate(clientUpdateId);
      const workLogItems: PublicationWorkLogItemInput[] = [];
      const mediaItems: PublicationMediaItemInput[] = [];
      const observationItems: PublicationObservationItemInput[] = [];

      for (const item of stagedItems) {
        if (item.kind === 'work_log') {
          const workLog = await context.workLogs.findById(item.sourceWorkLogId as Uuid);
          if (workLog === null || workLog.gardenId !== clientUpdate.gardenId) {
            throw selectedItemInvalidError([
              { code: 'client_update.selected_item_invalid', parameters: { itemId: item.id } },
            ]);
          }
          workLogItems.push({
            id: generateUuidV7(),
            occurredAt: item.occurredAt,
            description: item.description as string,
            sourceWorkLogId: item.sourceWorkLogId,
          });
        } else if (item.kind === 'media') {
          const media = await this.media.get(item.mediaRecordId as Uuid);
          if (media === null || !isMediaClientSafe(media, clientUpdate.gardenId)) {
            throw selectedItemInvalidError([
              { code: 'client_update.selected_item_invalid', parameters: { itemId: item.id } },
            ]);
          }
          mediaItems.push({
            id: generateUuidV7(),
            occurredAt: item.occurredAt,
            mediaRecordId: item.mediaRecordId as Uuid,
            mediaRole: item.mediaRole as PublicationMediaItemInput['mediaRole'],
            caption: item.caption,
          });
        } else {
          const observation = await this.observations.get(item.sourceObservationId as Uuid);
          if (observation === null || observation.gardenId !== clientUpdate.gardenId) {
            throw selectedItemInvalidError([
              { code: 'client_update.selected_item_invalid', parameters: { itemId: item.id } },
            ]);
          }
          observationItems.push({
            id: generateUuidV7(),
            occurredAt: item.occurredAt,
            narrativeText: item.description as string,
            sourceObservationId: item.sourceObservationId,
          });
        }
      }

      const gardenSnapshotItem: PublicationGardenSnapshotItemInput | null =
        request.gardenSnapshot === null
          ? null
          : {
              id: generateUuidV7(),
              occurredAt: this.clock.now(),
              overviewText: request.gardenSnapshot.overviewText,
              snapshotData: request.gardenSnapshot.snapshotData,
            };

      const timelineEntryItems: PublicationTimelineEntryItemInput[] = request.timelineEntries.map(
        (entry) => ({
          id: generateUuidV7(),
          occurredAt: entry.occurredAt,
          entryText: entry.entryText,
        }),
      );

      const staffAttributions: PublicationStaffAttributionInput[] = [];
      for (const attribution of request.staffAttributions) {
        const profile = await this.profiles.findById(attribution.staffProfileId);
        if (profile === null) {
          throw staffProfileNotFoundError('/staffAttributions');
        }
        staffAttributions.push({
          id: generateUuidV7(),
          staffProfileId: attribution.staffProfileId,
          displayName: attribution.displayName,
          roleLabel: attribution.roleLabel,
        });
      }

      const now = this.clock.now();

      // The revision-guarded write, attempted BEFORE the (more expensive)
      // snapshot inserts — see this file's own header, "CONCURRENCY".
      const applied = await context.clientUpdates.update(
        {
          ...clientUpdate,
          state: TARGET_STATE,
          publishedAt: now,
          publishedByProfileId: actorProfileId,
          revision: clientUpdate.revision + 1,
          updatedAt: now,
        },
        expectedRevision,
      );
      if (!applied) {
        throw clientUpdateStaleRevisionError(clientUpdate.revision);
      }

      const versionInput: CreatePublicationVersionInput = {
        id: generateUuidV7(),
        clientUpdateId,
        engagementId,
        gardenId: clientUpdate.gardenId,
        title: clientUpdate.title,
        summary: clientUpdate.summary,
        clientUpdateRevisionAtPublish: clientUpdate.revision,
        publishedAt: now,
        publishedByProfileId: actorProfileId,
        workLogItems,
        mediaItems,
        gardenSnapshotItem,
        timelineEntryItems,
        observationItems,
        staffAttributions,
      };

      let version;
      try {
        version = await context.publications.create(versionInput);
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          postgresConstraintName(error) === VERSION_UNIQUE_CONSTRAINT
        ) {
          throw alreadyPublished(error);
        }
        throw error;
      }

      await context.auditLogger.record({
        eventType: 'client_update.published',
        subjectType: 'publication_version',
        subjectId: version.id,
        actorProfileId,
        actorType: 'user',
        gardenId: clientUpdate.gardenId,
        details: {
          engagementId,
          clientUpdateId,
          itemCount:
            workLogItems.length +
            mediaItems.length +
            timelineEntryItems.length +
            observationItems.length,
        },
      });
      // Step 6: this outbox event, appended in the SAME transaction, is the
      // "notification only after commit" mechanism — nothing here calls a
      // notification provider synchronously. Formalized (P9C-INVITE-01) as a
      // real, versioned `@verdery/api-contracts` event contract — see
      // `client-publication-events.ts`'s own header for why this is
      // deliberately EMITTED UNCLAIMED, the identical `task.assigned`
      // posture, rather than a silently dropped promise.
      const eventPayload: ClientUpdatePublishedEventPayload = {
        publicationVersionId: version.id,
        engagementId,
        clientUpdateId,
        gardenId: clientUpdate.gardenId,
      };
      await context.outbox.append({
        eventType: CLIENT_UPDATE_PUBLISHED_EVENT_TYPE,
        aggregateType: 'publication_version',
        aggregateId: version.id,
        payload: eventPayload,
      });

      return toPublicationVersionResource(version);
    });
  }
}
