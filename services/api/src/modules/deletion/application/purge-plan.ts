/**
 * The purge cascade, written down once as ordered data (P8-DELETE-01) —
 * architecture/data-export-and-deletion.md section 10.7: "Purges domain
 * records, media, derivatives, search projections, and exports."
 *
 * WHY A DATA PLAN RATHER THAN A PROCEDURE: every step is the same shape —
 * "delete the rows of ONE table matching ONE predicate" — so expressing them
 * as a list makes three properties true that a hand-written procedure would
 * only claim. The executor can batch every step identically without any step
 * knowing about batching; every step is trivially idempotent (re-running a
 * completed one deletes zero rows), which is what makes a crashed purge safe
 * to retry from anywhere; and each step's name is a checkpoint key AND an
 * evidence row, so "what was deleted, and how much of it" is recorded without
 * a parallel bookkeeping mechanism.
 *
 * ORDERING IS THE WHOLE CORRECTNESS ARGUMENT. Nothing here relies on
 * `ON DELETE CASCADE` except where the schema genuinely declares it (the nine
 * `gardens_mapping.*_details` tables and `imported_background_details` follow
 * `garden_object`; `notification_delivery_attempt` follows
 * `notification_intent`; `export_section_checkpoint` follows
 * `export_request`). Every other child is deleted before its parent, by name,
 * in this list. The systematic emptiness test
 * (`tests/integration/deletion-garden-purge.test.ts`) is what proves the list
 * is COMPLETE rather than merely plausible: it enumerates garden-referencing
 * tables from `information_schema` and asserts each is empty, so a table
 * added by a future migration and forgotten here fails that test rather than
 * quietly surviving a purge.
 *
 * WHAT DELIBERATELY SURVIVES A GARDEN PURGE, and why:
 *
 * - `platform.sync_change` — the garden's `delete` tombstone lives there and
 *   must outlive the garden for offline clients to converge (section 13). The
 *   table has no foreign keys precisely so it can.
 * - `collaboration.membership`, reduced to `removed` tombstones — the same
 *   reason: `GetSyncChanges` decides tombstone visibility from these rows.
 *   Handled by the purge's own revocation step, not by this list.
 * - `platform.audit_event` — the completion evidence (section 10.9). Its
 *   `subject_id` has no foreign key for exactly this case.
 * - `plants_inventory.taxonomy_reference` and `integrations.plant_content_*`
 *   — a shared reference catalog and its provider cache, keyed on taxonomy,
 *   containing nothing about any garden.
 */

import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';

/**
 * One step of a purge: the table it empties and the rows it claims, as a
 * boolean SQL fragment over that table parameterized by the subject id.
 *
 * `name` is the checkpoint key and the evidence label, so it must stay stable
 * across releases: renaming one makes an in-flight purge redo that step
 * (harmless — every step converges on zero) but silently orphans its recorded
 * count.
 */
export interface PurgeStep {
  readonly name: string;
  /** Schema-qualified, exactly as written in the migrations. */
  readonly table: string;
  readonly rows: (subjectId: string) => RawBuilder<unknown>;
  /**
   * Steps sharing a group name run in ONE transaction instead of one each.
   *
   * Needed exactly where two tables reference each other and the schema
   * resolves the cycle with a DEFERRABLE constraint rather than a nullable
   * column: `recommendation_candidate.primary_evidence_id` points at an
   * evidence row that points back at the candidate, and that constraint is
   * checked at COMMIT. Deleting the evidence in its own transaction would
   * therefore fail against a candidate that still exists, and deleting the
   * candidate first would fail against the evidence's own non-deferrable
   * reference — the pair is only deletable together, which is precisely what
   * the schema's `DEFERRABLE INITIALLY DEFERRED` was written to allow.
   *
   * Grouped steps must be CONSECUTIVE in the plan; the runner treats a group
   * as one unit and still records a checkpoint per step inside it.
   */
  readonly group?: string;
}

/**
 * A statement that runs once before the batched deletes, to break a reference
 * cycle the ordering alone cannot: `plant.accepted_identification_id` points
 * forward at `plant_identification`, which points back at `plant`, so one of
 * the two links has to be released rather than ordered around.
 */
export interface PurgePreparation {
  readonly name: string;
  readonly statement: (subjectId: string) => RawBuilder<unknown>;
}

export const GARDEN_PURGE_PREPARATIONS: readonly PurgePreparation[] = [
  {
    name: 'plants_inventory.plant.detach_accepted_identification',
    statement: (gardenId) => sql`
      UPDATE plants_inventory.plant
      SET accepted_identification_id = NULL
      WHERE garden_id = ${gardenId} AND accepted_identification_id IS NOT NULL
    `,
  },
  // Section 10.5, "Cancels or closes pending jobs". Media processing jobs are
  // cancelled by the deletion workflow itself, one media record at a time;
  // an export generation job has no such owner, so it is closed here — with
  // a terminal `failed` transition rather than a row deletion, so a worker
  // still holding the request cannot complete it and register a package for
  // a garden that no longer exists. `CompleteExport` accepts only `running`,
  // which this state is not.
  {
    name: 'exports.export_request.close_active',
    statement: (gardenId) => sql`
      UPDATE exports.export_request
      SET state = 'failed',
          failure_code = 'subject_purged',
          revision = revision + 1,
          updated_at = now()
      WHERE garden_id = ${gardenId} AND state IN ('requested', 'running')
    `,
  },
];

/**
 * The garden cascade, leaves first.
 *
 * The published-outbox step leads deliberately: an outbox payload can carry
 * user content (a `media.deletion_requested` event names the display
 * filename), and the rows it selects are found through tables later steps
 * delete, so it has to run while those tables still resolve. Only PUBLISHED
 * rows are removed — an unpublished one is undelivered work, and the media
 * drain the purge waits on cannot have completed while any remains.
 */
export const GARDEN_PURGE_STEPS: readonly PurgeStep[] = [
  {
    name: 'platform.outbox_event',
    table: 'platform.outbox_event',
    rows: (gardenId) => sql`
      published_at IS NOT NULL
      AND (
        aggregate_id = ${gardenId}
        OR aggregate_id IN (SELECT id FROM media.media_record WHERE garden_id = ${gardenId})
        OR aggregate_id IN (SELECT id FROM exports.export_request WHERE garden_id = ${gardenId})
        OR aggregate_id IN (
          SELECT id FROM tasks_recommendations.recommendation_candidate WHERE garden_id = ${gardenId}
        )
      )
    `,
  },

  // Candidate children with no cycle of their own go first, each in its own
  // transaction. The candidates themselves, and the tasks tangled with them,
  // follow as one grouped unit.
  {
    name: 'tasks_recommendations.recommendation_ai_explanation',
    table: 'tasks_recommendations.recommendation_ai_explanation',
    rows: (gardenId) =>
      sql`candidate_id IN (SELECT id FROM tasks_recommendations.recommendation_candidate WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'tasks_recommendations.recommendation_priority_factor',
    table: 'tasks_recommendations.recommendation_priority_factor',
    rows: (gardenId) =>
      sql`candidate_id IN (SELECT id FROM tasks_recommendations.recommendation_candidate WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'tasks_recommendations.recommendation_feedback',
    table: 'tasks_recommendations.recommendation_feedback',
    rows: (gardenId) =>
      sql`candidate_id IN (SELECT id FROM tasks_recommendations.recommendation_candidate WHERE garden_id = ${gardenId})`,
  },
  // ONE transaction from here to the candidates, because the schema leaves
  // no ordering that works across separate ones:
  //   evidence  -> task           (`recommendation_evidence.source_task_id`)
  //   task      -> candidate      (`task.origin_recommendation_id`)
  //   candidate -> evidence       (`primary_evidence_id`, DEFERRABLE)
  // a genuine cycle whose only legal resolution is the deferred check the
  // recommendations baseline added for exactly this reason. See
  // `PurgeStep.group`.
  {
    name: 'tasks_recommendations.recommendation_evidence',
    table: 'tasks_recommendations.recommendation_evidence',
    group: 'recommendations',
    rows: (gardenId) =>
      sql`candidate_id IN (SELECT id FROM tasks_recommendations.recommendation_candidate WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'tasks_recommendations.task_attachment',
    table: 'tasks_recommendations.task_attachment',
    group: 'recommendations',
    rows: (gardenId) =>
      sql`task_id IN (SELECT id FROM tasks_recommendations.task WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'tasks_recommendations.task_revision',
    table: 'tasks_recommendations.task_revision',
    group: 'recommendations',
    rows: (gardenId) =>
      sql`task_id IN (SELECT id FROM tasks_recommendations.task WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'tasks_recommendations.task',
    table: 'tasks_recommendations.task',
    group: 'recommendations',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  {
    name: 'tasks_recommendations.recommendation_candidate',
    table: 'tasks_recommendations.recommendation_candidate',
    group: 'recommendations',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Observations. `recommendation_evidence.source_observation_id` and
  // `task.origin_observation_id` both point here, so both are already gone.
  // `observation.corrects_observation_id` is a self-reference resolved
  // inside its own statement: Postgres queues referential checks to the end
  // of the statement, so deleting a correction and its target together is
  // fine.
  {
    name: 'observations_history.image_analysis_result',
    table: 'observations_history.image_analysis_result',
    rows: (gardenId) => sql`
      observation_photo_id IN (
        SELECT p.id FROM observations_history.observation_photo p
        JOIN observations_history.observation o ON o.id = p.observation_id
        WHERE o.garden_id = ${gardenId}
      )
    `,
  },
  {
    name: 'observations_history.observation_photo',
    table: 'observations_history.observation_photo',
    rows: (gardenId) =>
      sql`observation_id IN (SELECT id FROM observations_history.observation WHERE garden_id = ${gardenId})`,
  },
  // P11-MEDIA-01: another `observation`-scoped child table, the same shape
  // as `observation_photo` immediately above.
  {
    name: 'observations_history.observation_measurement',
    table: 'observations_history.observation_measurement',
    rows: (gardenId) =>
      sql`observation_id IN (SELECT id FROM observations_history.observation WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'observations_history.observation',
    table: 'observations_history.observation',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Plant candidates (P11-DATA-01), before plants: `candidate_conversion`
  // references BOTH `plant_candidate` and `plant`, so it must clear before
  // either. `candidate_suitability_assessment` and `plant_candidate_photo`
  // (P11-CAND-PHOTO-01) only reference `plant_candidate`.
  // `plant_candidate.alternative_to_candidate_id` is a self-reference
  // resolved within its own DELETE statement — the same "Postgres queues
  // referential checks to the end of the statement" note
  // `observation.corrects_observation_id` relies on below.
  {
    name: 'plants_inventory.candidate_suitability_assessment',
    table: 'plants_inventory.candidate_suitability_assessment',
    rows: (gardenId) =>
      sql`candidate_id IN (SELECT id FROM plants_inventory.plant_candidate WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'plants_inventory.candidate_conversion',
    table: 'plants_inventory.candidate_conversion',
    rows: (gardenId) => sql`
      candidate_id IN (SELECT id FROM plants_inventory.plant_candidate WHERE garden_id = ${gardenId})
      OR plant_id IN (SELECT id FROM plants_inventory.plant WHERE garden_id = ${gardenId})
    `,
  },
  {
    name: 'plants_inventory.plant_candidate_photo',
    table: 'plants_inventory.plant_candidate_photo',
    rows: (gardenId) =>
      sql`candidate_id IN (SELECT id FROM plants_inventory.plant_candidate WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'plants_inventory.plant_candidate',
    table: 'plants_inventory.plant_candidate',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Plants. The forward link from `plant` to `plant_identification` was
  // already released by the preparation above.
  {
    name: 'plants_inventory.plant_revision',
    table: 'plants_inventory.plant_revision',
    rows: (gardenId) =>
      sql`plant_id IN (SELECT id FROM plants_inventory.plant WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'plants_inventory.plant_identification',
    table: 'plants_inventory.plant_identification',
    rows: (gardenId) =>
      sql`plant_id IN (SELECT id FROM plants_inventory.plant WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'plants_inventory.plant_photo',
    table: 'plants_inventory.plant_photo',
    rows: (gardenId) =>
      sql`plant_id IN (SELECT id FROM plants_inventory.plant WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'plants_inventory.plant',
    table: 'plants_inventory.plant',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // The map. Deleting `garden_object` cascades all ten `*_details` tables
  // (the schema declares it) and resolves their object-to-object references
  // inside the one statement.
  {
    name: 'gardens_mapping.calibration',
    table: 'gardens_mapping.calibration',
    rows: (gardenId) =>
      sql`background_object_id IN (SELECT id FROM gardens_mapping.garden_object WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'gardens_mapping.garden_object_revision',
    table: 'gardens_mapping.garden_object_revision',
    rows: (gardenId) =>
      sql`garden_object_id IN (SELECT id FROM gardens_mapping.garden_object WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'gardens_mapping.garden_object',
    table: 'gardens_mapping.garden_object',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  {
    name: 'gardens_mapping.georeference',
    table: 'gardens_mapping.georeference',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  {
    name: 'gardens_mapping.coordinate_space',
    table: 'gardens_mapping.coordinate_space',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  // Garden context facts (P9D-CONTEXT-01) — a plain garden-scoped table with
  // nothing referencing it, the same shape as `georeference`/
  // `coordinate_space` immediately above.
  {
    name: 'gardens_mapping.garden_context_fact',
    table: 'gardens_mapping.garden_context_fact',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Weather, after `recommendation_evidence.source_weather_record_id` is gone.
  {
    name: 'integrations.weather_record',
    table: 'integrations.weather_record',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Notifications. Delivery attempts cascade from intents.
  {
    name: 'notifications.notification_intent',
    table: 'notifications.notification_intent',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  {
    name: 'notifications.notification_preference',
    table: 'notifications.notification_preference',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Exports (section 10.7 names them explicitly). Section checkpoints
  // cascade. The package BYTES were handed to the media deletion workflow by
  // the purge's own media phase, which runs before any of this.
  {
    name: 'exports.export_request',
    table: 'exports.export_request',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Media rows, last of the content: every attachment row that referenced
  // them is gone by now, and their bytes are already confirmed absent — the
  // purge does not reach this step until every one of the garden's media
  // records is terminal.
  {
    name: 'media.processing_job',
    table: 'media.processing_job',
    rows: (gardenId) =>
      sql`media_id IN (SELECT id FROM media.media_record WHERE garden_id = ${gardenId})`,
  },
  {
    name: 'media.quota_reservation',
    table: 'media.quota_reservation',
    rows: (gardenId) => sql`
      scope_garden_id = ${gardenId}
      OR media_id IN (SELECT id FROM media.media_record WHERE garden_id = ${gardenId})
    `,
  },
  {
    name: 'media.media_record',
    table: 'media.media_record',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // Collaboration. Invitations are deleted outright: an invitation to a
  // garden that no longer exists is not a tombstone anyone reads, unlike a
  // membership row. Memberships are NOT in this list — see this file's
  // header.
  {
    name: 'collaboration.invitation',
    table: 'collaboration.invitation',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  // Access HISTORY, unlike the membership row it belongs to, is ordinary
  // garden content: nothing in the synchronization protocol reads it, so
  // nothing depends on it outliving the garden. The membership row itself
  // still survives as the revocation tombstone; only the record of when each
  // grant began and ended goes (P9A-DATA-01).
  {
    name: 'collaboration.membership_period',
    table: 'collaboration.membership_period',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },
  // The transfer record names the garden by foreign key, so it has to go
  // before the garden row can. Its own audit event survives in
  // `platform.audit_event`, which is what the evidence requirement actually
  // rests on.
  {
    name: 'collaboration.ownership_transfer',
    table: 'collaboration.ownership_transfer',
    rows: (gardenId) => sql`garden_id = ${gardenId}`,
  },

  // The garden itself. Reachable only once every step above has converged on
  // zero, which is the same thing as saying nothing references it any more.
  {
    name: 'gardens_mapping.garden',
    table: 'gardens_mapping.garden',
    rows: (gardenId) => sql`id = ${gardenId}`,
  },
];

/**
 * The account cascade — section 11's "Purges personal domain data", "Revokes
 * invitations, memberships, sessions, and device channels".
 *
 * Shorter than the garden cascade for a reason worth stating: almost
 * everything a person creates belongs to a GARDEN, not to them. Their
 * sole-owned gardens are resolved into their own garden deletions at request
 * time and purged by their own records; what is left here is the genuinely
 * personal residue — provider links, consents, devices, inbox, preferences,
 * sessions, idempotency, exports.
 *
 * `collaboration.membership` is again absent: the account purge revokes the
 * rows rather than deleting them, so the person's other devices still
 * converge on the revocation. `platform.audit_event` is absent because it is
 * the evidence, and its actor now resolves to a tombstone carrying no
 * personal data.
 */
export const ACCOUNT_PURGE_STEPS: readonly PurgeStep[] = [
  {
    name: 'platform.outbox_event',
    table: 'platform.outbox_event',
    rows: (profileId) => sql`
      published_at IS NOT NULL
      AND aggregate_id IN (SELECT id FROM exports.export_request WHERE requester_profile_id = ${profileId})
    `,
  },
  {
    name: 'exports.export_request',
    table: 'exports.export_request',
    rows: (profileId) => sql`requester_profile_id = ${profileId}`,
  },
  {
    name: 'media.quota_reservation',
    table: 'media.quota_reservation',
    rows: (profileId) => sql`scope_profile_id = ${profileId}`,
  },
  {
    name: 'notifications.notification_intent',
    table: 'notifications.notification_intent',
    rows: (profileId) => sql`recipient_profile_id = ${profileId}`,
  },
  {
    name: 'notifications.notification_device',
    table: 'notifications.notification_device',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
  {
    name: 'notifications.notification_preference',
    table: 'notifications.notification_preference',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
  {
    name: 'notifications.notification_preference_document',
    table: 'notifications.notification_preference_document',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
  // "Revokes ... sessions": the durable half of a session is the registered
  // client installation. Firebase's own token state is revoked by deleting
  // the identity provider's user, which the purge does after these rows.
  {
    name: 'platform.sync_client_installation',
    table: 'platform.sync_client_installation',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
  {
    name: 'platform.idempotency_record',
    table: 'platform.idempotency_record',
    rows: (profileId) => sql`actor_profile_id = ${profileId}`,
  },
  // "Revokes invitations": those this person SENT. An invitation they
  // accepted names them in a nullable column the purge releases instead —
  // that row belongs to a garden that may well survive.
  {
    name: 'collaboration.invitation',
    table: 'collaboration.invitation',
    rows: (profileId) => sql`inviter_profile_id = ${profileId}`,
  },
  // "Revokes ... memberships" applied to the part of a membership that is
  // personal rather than protocol: when this person's access to each garden
  // began and ended. The membership ROW still survives as the revocation
  // tombstone the offline protocol reads (see this file's header); its
  // history does not, including for shared gardens that outlive the account.
  {
    name: 'collaboration.membership_period',
    table: 'collaboration.membership_period',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
  {
    name: 'identity_access.consent_record',
    table: 'identity_access.consent_record',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
  {
    name: 'identity_access.identity_provider_link',
    table: 'identity_access.identity_provider_link',
    rows: (profileId) => sql`profile_id = ${profileId}`,
  },
];

export const ACCOUNT_PURGE_PREPARATIONS: readonly PurgePreparation[] = [
  {
    name: 'collaboration.invitation.detach_accepted_by',
    statement: (profileId) => sql`
      UPDATE collaboration.invitation
      SET accepted_by_profile_id = NULL
      WHERE accepted_by_profile_id = ${profileId}
    `,
  },
  {
    name: 'exports.export_request.close_active',
    statement: (profileId) => sql`
      UPDATE exports.export_request
      SET state = 'failed',
          failure_code = 'subject_purged',
          revision = revision + 1,
          updated_at = now()
      WHERE requester_profile_id = ${profileId} AND state IN ('requested', 'running')
    `,
  },
];
