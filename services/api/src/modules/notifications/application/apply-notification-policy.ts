/**
 * The notification policy applied to one forwarded domain event
 * (P7-NOTIF-01) — notifications.md section 5's `domain event ->
 * notification policy -> persist in-app intent` steps, in one transaction.
 *
 * CALLED BY: the internal OIDC-verified endpoint the workers relay posts
 * each claimed `recommendation.candidate_created` outbox row to (see
 * `transport/notification-events-route.ts` and `@verdery/api-contracts`'
 * `notification-dispatch.ts` for why the relay forwards instead of
 * processing: the policy's membership/preference/candidate reads are
 * exactly the data `verdery_worker` deliberately cannot touch).
 *
 * DUPLICATE-SAFE BY CONSTRUCTION, because the relay may deliver the same
 * event twice (publish-then-record crash window): the supersession close
 * is a state-conditional no-op on rows already closed, and every insert is
 * `ON CONFLICT DO NOTHING` against the per-recipient deduplication key —
 * so a replay converges to zero new rows, reported honestly as
 * `intentsDeduplicated`. No `platform.idempotency_record` is involved:
 * that table is actor-scoped for client retries, while this path's
 * idempotency boundary is the event itself, carried by the dedup key
 * (asynchronous-processing.md section 11: "Every handler defines its
 * idempotency boundary").
 *
 * ORDER INSIDE THE TRANSACTION — supersession close FIRST, freshness
 * second: a new candidate's supersession of its prior stands regardless of
 * whether the NEW candidate is still fresh enough to notify about (the
 * engine already recorded that replacement durably), so a stale drained
 * event must still close the prior's pending intents while suppressing its
 * own.
 *
 * The freshness recheck runs HERE, at intent creation, and again at send
 * time in P7-NOTIF-02 (section 9's recheck list) — creation-time first,
 * because the relay's backlog is explicitly allowed to age and a durable
 * inbox entry about an already-resolved recommendation would be wrong the
 * moment it is written.
 */

import type {
  NotificationDomainEventEnvelope,
  NotificationEventProcessingSummary,
  RecommendationCandidateCreatedEventPayload,
} from '@verdery/api-contracts';
import {
  RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
  SharedErrorCode,
} from '@verdery/api-contracts';
import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import { generateUuidV7, type Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  assessCareRecommendationEvent,
  buildCareRecommendationDedupKey,
  buildCareRecommendationDeepLink,
  CARE_RECOMMENDATION_INTENT_VERSION,
  CARE_RECOMMENDATION_TEMPLATE_KEY,
  derivePriorityFromUrgency,
  evaluateRecipientPolicy,
} from '../domain/notification-policy.js';
import {
  CARE_RECOMMENDATION_INTENT_TYPE,
  resolveChannelPreference,
  UNWRITTEN_PREFERENCE_SETTINGS,
} from '../domain/notification-preference.js';
import type { NotificationsUnitOfWork } from './notifications-unit-of-work.js';

/** The same UUIDv7 shape every transport helper pins (`garden-routes.ts`'s `UUID_PATTERN`): both producers of these ids (`EvaluateGardenRecommendations`, the outbox appender) generate v7. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code: 'notification.event.invalid', pointer }],
  });
}

function requireUuid(value: unknown, pointer: string): Uuid {
  if (typeof value !== 'string' || !UUID_SHAPE.test(value)) {
    throw invalid('a UUID is required.', pointer);
  }
  return value;
}

function optionalUuid(value: unknown, pointer: string): Uuid | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requireUuid(value, pointer);
}

/**
 * Validates the forwarded payload's fields this policy actually consumes.
 * The producer is this codebase's own `EvaluateGardenRecommendations`, so
 * a malformed payload is a defect between two trusted components —
 * rejected loudly (the relay keeps the event unpublished and visible),
 * never repaired or skipped silently.
 */
function requireCandidateCreatedPayload(
  payload: unknown,
): RecommendationCandidateCreatedEventPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw invalid('the event payload must be an object.', '/payload');
  }
  const record = payload as Partial<RecommendationCandidateCreatedEventPayload>;

  requireUuid(record.candidateId, '/payload/candidateId');
  requireUuid(record.gardenId, '/payload/gardenId');
  optionalUuid(record.supersedesCandidateId ?? null, '/payload/supersedesCandidateId');
  if (typeof record.ruleKey !== 'string' || record.ruleKey === '') {
    throw invalid('ruleKey is required.', '/payload/ruleKey');
  }
  if (typeof record.ruleVersion !== 'number' || !Number.isInteger(record.ruleVersion)) {
    throw invalid('ruleVersion must be an integer.', '/payload/ruleVersion');
  }
  if (typeof record.urgency !== 'string' || record.urgency === '') {
    throw invalid('urgency is required.', '/payload/urgency');
  }
  if (typeof record.targetKind !== 'string' || record.targetKind === '') {
    throw invalid('targetKind is required.', '/payload/targetKind');
  }

  return record as RecommendationCandidateCreatedEventPayload;
}

function countReason(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export class ApplyNotificationPolicy {
  constructor(
    private readonly unitOfWork: NotificationsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    envelope: NotificationDomainEventEnvelope,
  ): Promise<NotificationEventProcessingSummary> {
    if (envelope.eventType !== RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE) {
      // The relay only forwards types it recognizes; receiving another type
      // means the two sides' shared constants have drifted — a deploy
      // defect, surfaced loudly (the relay retries and the failure stays
      // visible), never marked processed.
      throw invalid(`unrecognized event type "${envelope.eventType}".`, '/eventType');
    }
    const sourceEventId = requireUuid(envelope.id, '/id');
    const payload = requireCandidateCreatedPayload(envelope.payload);
    const now = this.clock.now();

    return this.unitOfWork.run(async (context) => {
      const suppressed: Record<string, number> = {};

      // Supersession close first — see the header for why order matters.
      const priorIntentsSuperseded =
        payload.supersedesCandidateId === null
          ? 0
          : await context.intents.closePendingForCandidate(payload.supersedesCandidateId, now);

      const candidate = await context.recommendationFreshness.findCandidate(payload.candidateId);
      if (candidate !== null && candidate.gardenId !== payload.gardenId) {
        throw new InternalError(
          SharedErrorCode.Internal,
          'The candidate-created event names a different garden than the stored candidate.',
        );
      }

      const assessment = assessCareRecommendationEvent(candidate, now);
      if (assessment.kind === 'suppress') {
        countReason(suppressed, assessment.reason);
        return {
          eventType: envelope.eventType,
          recipientsConsidered: 0,
          intentsCreated: 0,
          intentsDeduplicated: 0,
          suppressed,
          priorIntentsSuperseded,
        };
      }

      const recipients = await context.recipients.listActiveMembers(payload.gardenId);
      const profileIds = recipients.map((recipient) => recipient.profileId);
      const settingsByProfile = await context.preferences.getSettingsForProfiles(profileIds);
      const entriesByProfile = await context.preferences.listEntriesForProfiles(
        profileIds,
        CARE_RECOMMENDATION_INTENT_TYPE,
      );

      let intentsCreated = 0;
      let intentsDeduplicated = 0;

      for (const recipient of recipients) {
        const settings =
          settingsByProfile.get(recipient.profileId) ?? UNWRITTEN_PREFERENCE_SETTINGS;
        const entries = entriesByProfile.get(recipient.profileId) ?? [];

        const decision = evaluateRecipientPolicy(
          {
            profileId: recipient.profileId,
            accountState: recipient.accountState,
            profileTimeZone: recipient.timeZone,
            channels: resolveChannelPreference(
              entries,
              CARE_RECOMMENDATION_INTENT_TYPE,
              payload.gardenId,
            ),
            quietHours: settings.quietHours,
            quietHoursTimeZone: settings.quietHoursTimeZone,
          },
          now,
        );

        if (decision.kind === 'suppress') {
          countReason(suppressed, decision.reason);
          continue;
        }

        const created = await context.intents.insertIfAbsent(
          {
            id: generateUuidV7(),
            intentType: CARE_RECOMMENDATION_INTENT_TYPE,
            intentVersion: CARE_RECOMMENDATION_INTENT_VERSION,
            recipientProfileId: recipient.profileId,
            gardenId: payload.gardenId,
            recommendationCandidateId: payload.candidateId,
            sourceEventId,
            traceId: envelope.traceId,
            templateKey: CARE_RECOMMENDATION_TEMPLATE_KEY,
            // Structured facts only, never rendered text (section 8): the
            // client resolves wording, plant names, and titles in the
            // recipient's own locale from these identifiers.
            templateParameters: {
              gardenId: payload.gardenId,
              recommendationCandidateId: payload.candidateId,
              ruleKey: payload.ruleKey,
              ruleVersion: payload.ruleVersion,
              urgency: payload.urgency,
              targetKind: payload.targetKind,
              targetPlantId: payload.targetPlantId,
              targetGardenAreaMapObjectId: payload.targetGardenAreaMapObjectId,
              windowEnd: payload.windowEnd,
            },
            priority: derivePriorityFromUrgency(payload.urgency),
            channelInApp: decision.channelInApp,
            channelPush: decision.channelPush,
            deepLink: buildCareRecommendationDeepLink(payload.gardenId, payload.candidateId),
            dedupKey: buildCareRecommendationDedupKey(payload.candidateId),
            earliestDeliveryAt: decision.earliestDeliveryAt,
            expiresAt: assessment.expiresAt,
          },
          now,
        );

        if (created) {
          intentsCreated += 1;
        } else {
          intentsDeduplicated += 1;
        }
      }

      return {
        eventType: envelope.eventType,
        recipientsConsidered: recipients.length,
        intentsCreated,
        intentsDeduplicated,
        suppressed,
        priorIntentsSuperseded,
      };
    });
  }
}
