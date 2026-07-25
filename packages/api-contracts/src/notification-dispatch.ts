/**
 * Notification event dispatch contract (P7-NOTIF-01).
 *
 * Hand-written, machine-to-machine, exactly like `media-processing.ts` and
 * `recommendation-events.ts`: this is the HTTP contract between
 * `services/workers`' outbox relay (the sender — it claims unpublished
 * notification-relevant `platform.outbox_event` rows and forwards each one)
 * and `services/api`'s internal notification-policy endpoint
 * (`POST /internal/notifications/events`, the receiver — it evaluates
 * notifications.md section 5's "notification policy" step and persists the
 * resulting in-app intents). Never a client-facing HTTP body, so it has no
 * place in `openapi.yaml`.
 *
 * WHY THE RELAY FORWARDS INSTEAD OF PROCESSING: the policy needs garden
 * membership, profile, preference, and recommendation-candidate reads that
 * `verdery_worker` deliberately has no database access to (its grants stop
 * at `platform.outbox_event` and `media.processing_job`); the worker
 * contributes exactly what it uniquely has — the already-polling relay loop
 * and a verified worker-to-API OIDC identity — the same privilege-boundary
 * reasoning the three scheduled sweeps document.
 *
 * IDEMPOTENCY: the receiver is duplicate-safe per event (each created
 * intent carries a purpose-specific deduplication key enforced by a unique
 * index — notifications.md section 10), so the relay's publish-then-record
 * crash window (asynchronous-processing.md section 4: "a relay can publish
 * before recording success") re-delivers harmlessly.
 */

/**
 * One `platform.outbox_event` row as the relay forwards it — the stored
 * columns the receiving policy needs, nothing re-interpreted in transit.
 */
export interface NotificationDomainEventEnvelope {
  /** The outbox event's own id (UUIDv7) — the stable per-event identity a duplicate delivery repeats. */
  readonly id: string;
  /** e.g. `RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE`. The receiver rejects types it does not recognize — a mismatch is a deploy defect, surfaced loudly, never silently dropped. */
  readonly eventType: string;
  /** The event's own payload, already parsed — for `recommendation.candidate_created`, a `RecommendationCandidateCreatedEventPayload`. */
  readonly payload: unknown;
  readonly traceId: string | null;
  /** ISO-8601 instant: when the producing transaction appended the event. */
  readonly occurredAt: string;
}

/**
 * The receiver's structured processing summary — observability's own
 * "intent creation, suppression reason" counters (notifications.md section
 * 15) at their source. Counts only, never recipient identities.
 */
export interface NotificationEventProcessingSummary {
  readonly eventType: string;
  /** Garden members considered as recipients before any per-recipient policy ran. */
  readonly recipientsConsidered: number;
  /** New durable intents persisted by this delivery. */
  readonly intentsCreated: number;
  /** Recipients whose intent already existed under the same deduplication key — the duplicate-delivery no-op path. */
  readonly intentsDeduplicated: number;
  /** Per-reason suppression counts, e.g. `{ "channels_disabled": 2 }`. Empty object when nothing was suppressed. */
  readonly suppressed: Readonly<Record<string, number>>;
  /** Prior pending intents closed as `superseded` because this event's candidate replaces theirs. */
  readonly priorIntentsSuperseded: number;
}
