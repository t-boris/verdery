/**
 * Client-publication event contract (P9C-INVITE-01, formalizing an event
 * `PublishClientUpdate` — P9C-PUBLISH-01 — already appended to the outbox as
 * an ad hoc literal). architecture/collaboration-and-client-sharing.md
 * section 17 names "Client publication" as one of the durable notification
 * intents this codebase must add; this is that event's own typed contract,
 * hand-written and machine-to-machine exactly like `task-events.ts`.
 *
 * EMITTED UNCLAIMED, the identical honest posture `task-events.ts`'s own
 * header documents at length: `PublishClientUpdate` (`services/api`) appends
 * one event per successful publish, in the SAME transaction as the
 * publication write, because appending must happen inside that transaction —
 * retrofitting it once a consumer exists would reopen that transaction path.
 * `services/workers`' outbox relay claims only its own recognized event
 * types, and wiring a `client_update.published` consumer into
 * `notifications/application/apply-notification-policy.ts` plus the relay's
 * recognized-type list is explicitly OUT OF P9C-INVITE-01's own scope — this
 * package's job was to give the ALREADY-EMITTED event a genuine, versioned,
 * documented contract (replacing the raw string/object literal
 * `PublishClientUpdate` used before), not to build the consumer. A later
 * package does both, the identical relationship P7-NOTIF-01 had to
 * `recommendation.candidate_created` and the one still owed to
 * `task.assigned`. Until a consumer exists, rows of this type simply stay
 * unpublished, harmlessly — this table has carried unclaimed rows before
 * with no ill effect.
 *
 * A separate "client invitation" durable-intent case (section 17's other
 * new bullet for this package) is deliberately NOT modeled as an event here:
 * `notifications.notification_intent.recipient_profile_id` is `NOT NULL`,
 * and an invited-but-not-yet-accepted client has no profile at all to name —
 * routing the invitation's own first email through this pipeline is
 * structurally impossible, not merely deferred. `CreateClientInvitation`
 * (`services/api`) sends that email itself, synchronously; see that file's
 * own header for the full reasoning.
 */

/**
 * The `platform.outbox_event.event_type` appended once per successfully
 * published `client_update`, in the same transaction as the publication
 * version write.
 */
export const CLIENT_UPDATE_PUBLISHED_EVENT_TYPE = 'client_update.published';

/**
 * The `platform.outbox_event.payload` shape for
 * `CLIENT_UPDATE_PUBLISHED_EVENT_TYPE`. Identifiers only
 * (architecture/asynchronous-processing.md section 3): a future notification
 * policy resolves recipients (this engagement's active `client_access_grant`
 * holders), preferences, and any rendered wording itself from these ids —
 * the identical restraint `TaskAssignedEventPayload`'s own header documents.
 */
export interface ClientUpdatePublishedEventPayload {
  readonly publicationVersionId: string;
  readonly engagementId: string;
  readonly clientUpdateId: string;
  readonly gardenId: string;
}
