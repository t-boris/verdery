/**
 * Recommendation candidate event contract (P7-ASYNC-01).
 *
 * Hand-written, machine-to-machine, exactly like `media-processing.ts`: this
 * is the `platform.outbox_event` contract between `services/api`'s
 * `EvaluateGardenRecommendations` (the producer — it appends one event per
 * created candidate in the same transaction as the candidate insert) and the
 * notification pipeline P7-NOTIF-01 builds (the consumer — notifications.md
 * section 5's flow starts at "domain event", and the recommendation-created
 * fact is that flow's entry point for care notifications). Never a
 * client-facing HTTP body, so it has no place in `openapi.yaml`.
 *
 * Emitted BEFORE the consumer exists, deliberately: the outbox is how "domain
 * commit cannot silently lose its publication intent"
 * (architecture/asynchronous-processing.md section 20), and appending must
 * happen inside the candidate-creating transaction — retrofitting it in
 * P7-NOTIF-01 would reopen the exact transaction path this stage already
 * owns. Until that consumer lands, rows of this type simply stay unpublished:
 * `services/workers`' relay claims only its own recognized media event types,
 * so nothing mis-routes them, and the notification worker's own
 * send-time freshness recheck (notifications.md section 9) makes a backlog of
 * old events safe to drain when it arrives.
 */

/**
 * The `platform.outbox_event.event_type` appended once per created
 * recommendation candidate, in the same transaction as the candidate,
 * evidence, and priority-factor inserts.
 */
export const RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE = 'recommendation.candidate_created';

/**
 * The `platform.outbox_event.payload` shape for
 * `RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE`. Small structured facts only
 * (architecture/asynchronous-processing.md section 3): identifiers, the rule
 * identity, and the timing/priority facts a notification policy needs to
 * decide recipient, urgency, and deduplication key ("recommendation ID plus
 * reminder window", notifications.md section 10) — never evidence content or
 * rendered explanation text.
 */
export interface RecommendationCandidateCreatedEventPayload {
  readonly candidateId: string;
  readonly gardenId: string;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  /** `'garden'`, `'garden_area'`, or `'plant'` — `services/api`'s `RecommendationTargetKind` owns the canonical vocabulary. */
  readonly targetKind: string;
  readonly targetPlantId: string | null;
  readonly targetGardenAreaMapObjectId: string | null;
  readonly urgency: string;
  readonly priorityScore: number;
  /** ISO-8601 instants, or `null` when the rule declared no bound. */
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly supersedesCandidateId: string | null;
}
