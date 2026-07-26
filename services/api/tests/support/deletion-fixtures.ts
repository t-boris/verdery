/**
 * Seeds one garden with at least one row in EVERY table the garden purge
 * plan names (P8-DELETE-01), plus the cascade-covered children the plan
 * relies on the schema to remove.
 *
 * Written as direct SQL rather than through each module's commands
 * deliberately. What the purge suite verifies is a CASCADE — which rows
 * survive a delete and which do not — so the fixture's job is to put a row in
 * every table quickly and with every foreign key genuinely satisfied. Driving
 * twenty-odd commands to reach the same state would test those commands
 * again, at ten times the length, and would still leave tables (weather
 * records, delivery attempts, priority factors) that no command writes in a
 * test-reachable way.
 *
 * Every insert here goes through the real schema, so a column, constraint, or
 * foreign key that changes breaks this file loudly rather than quietly
 * weakening the emptiness proof.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';

export interface GardenFixture {
  readonly gardenId: string;
  readonly gardenRevision: number;
  readonly ownerId: string;
  readonly editorId: string;
  readonly mediaId: string;
  readonly mapObjectId: string;
  readonly plantId: string;
  readonly notificationIntentId: string;
  readonly exportRequestId: string;
}

/** A profile with an active, usable account. */
export async function seedProfile(db: Kysely<DatabaseSchema>): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO identity_access.profile (id, firebase_uid, account_state)
    VALUES (${id}, ${`firebase-${id}`}, 'active')
  `.execute(db);
  return id;
}

export async function seedGardenContent(
  db: Kysely<DatabaseSchema>,
  clock: Clock,
  name: string,
  existingOwnerId?: string,
): Promise<GardenFixture> {
  const now = clock.now();
  const ownerId = existingOwnerId ?? (await seedProfile(db));
  const editorId = await seedProfile(db);

  const gardenId = randomUUID();
  await sql`
    INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id, created_at, updated_at)
    VALUES (${gardenId}, ${name}, ${ownerId}, ${now}, ${now})
  `.execute(db);
  const ownerMembershipId = randomUUID();
  const editorMembershipId = randomUUID();
  await sql`
    INSERT INTO collaboration.membership (id, garden_id, profile_id, role, state, created_at, updated_at)
    VALUES (${ownerMembershipId}, ${gardenId}, ${ownerId}, 'owner', 'active', ${now}, ${now}),
           (${editorMembershipId}, ${gardenId}, ${editorId}, 'editor', 'active', ${now}, ${now})
  `.execute(db);
  // The open access period behind each membership (P9A-DATA-01). Written here
  // rather than left to the migration's backfill because that backfill runs
  // before this fixture exists, which would leave the purge step for this
  // table asserting emptiness it never had to achieve.
  await sql`
    INSERT INTO collaboration.membership_period
      (id, membership_id, garden_id, profile_id, role, valid_from)
    VALUES (${randomUUID()}, ${ownerMembershipId}, ${gardenId}, ${ownerId}, 'owner', ${now}),
           (${randomUUID()}, ${editorMembershipId}, ${gardenId}, ${editorId}, 'editor', ${now})
  `.execute(db);
  // A completed ownership transfer, so the purge step for that table is not
  // vacuous either. `completed` rather than `pending` keeps the garden's one
  // in-flight-transfer slot free.
  await sql`
    INSERT INTO collaboration.ownership_transfer
      (id, garden_id, from_profile_id, to_profile_id, from_resulting_role,
       state, authenticated_at, requested_at, completed_at)
    VALUES (${randomUUID()}, ${gardenId}, ${ownerId}, ${editorId}, 'editor',
            'completed', ${now}, ${now}, ${now})
  `.execute(db);
  await sql`
    INSERT INTO collaboration.invitation
      (id, garden_id, inviter_profile_id, intended_role, token_hash, expires_at)
    VALUES (${randomUUID()}, ${gardenId}, ${ownerId}, 'viewer', ${randomUUID()}, ${now})
  `.execute(db);

  // --- media (the garden's own photo, plus a processing job and a quota
  // reservation, all of which the purge must clear only after the bytes go).
  const mediaId = randomUUID();
  await sql`
    INSERT INTO media.media_record
      (id, garden_id, uploaded_by_profile_id, media_class, display_filename,
       declared_content_type, declared_byte_size, bucket_name, object_key,
       upload_state, sensitivity_classification)
    VALUES (${mediaId}, ${gardenId}, ${ownerId}, 'garden_photo', 'bed.jpg',
            'image/jpeg', 1024, 'test-user-media', ${`ab/${mediaId}/${randomUUID()}`},
            'available', 'standard')
  `.execute(db);
  await sql`
    INSERT INTO media.processing_job (id, media_id, job_kind, state)
    VALUES (${randomUUID()}, ${mediaId}, 'derivative_generation', 'requested')
  `.execute(db);
  await sql`
    INSERT INTO media.quota_reservation (id, scope_kind, scope_garden_id, media_id, reserved_bytes)
    VALUES (${randomUUID()}, 'garden', ${gardenId}, ${mediaId}, 1024)
  `.execute(db);

  // --- the map
  const coordinateSpaceId = randomUUID();
  await sql`
    INSERT INTO gardens_mapping.coordinate_space (id, garden_id, origin_description)
    VALUES (${coordinateSpaceId}, ${gardenId}, 'south-west fence corner')
  `.execute(db);
  await sql`
    INSERT INTO gardens_mapping.georeference
      (id, garden_id, coordinate_space_id, local_anchor, geographic_anchor,
       provenance, method, created_by_profile_id)
    VALUES (${randomUUID()}, ${gardenId}, ${coordinateSpaceId},
            ST_SetSRID(ST_MakePoint(0, 0), 0), ST_SetSRID(ST_MakePoint(4.3, 52.1), 4326),
            'manualDrawing', 'anchorPair', ${ownerId})
  `.execute(db);

  const mapObjectId = randomUUID();
  await sql`
    INSERT INTO gardens_mapping.garden_object
      (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
    VALUES (${mapObjectId}, ${gardenId}, ${coordinateSpaceId}, 'structure',
            ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))'), 0),
            'manualDrawing', ${ownerId})
  `.execute(db);
  await sql`
    INSERT INTO gardens_mapping.structure_details (garden_object_id, structure_kind)
    VALUES (${mapObjectId}, 'shed')
  `.execute(db);
  await sql`
    INSERT INTO gardens_mapping.garden_object_revision
      (garden_object_id, revision, command_type, lifecycle_state, actor_profile_id)
    VALUES (${mapObjectId}, 1, 'createObject', 'active', ${ownerId})
  `.execute(db);
  await sql`
    INSERT INTO gardens_mapping.calibration
      (id, background_object_id, revision, reference_points, created_by_profile_id)
    VALUES (${randomUUID()}, ${mapObjectId}, 1,
            ${JSON.stringify([{ imagePoint: [0, 0], worldPoint: [0, 0] }])}::jsonb, ${ownerId})
  `.execute(db);

  // --- plants
  const plantId = randomUUID();
  const plantPhotoId = randomUUID();
  const identificationId = randomUUID();
  await sql`
    INSERT INTO plants_inventory.plant
      (id, garden_id, display_name, grouping_kind, lifecycle_stage, status, created_by_profile_id)
    VALUES (${plantId}, ${gardenId}, 'Apple tree', 'individual', 'growing', 'active', ${ownerId})
  `.execute(db);
  await sql`
    INSERT INTO plants_inventory.plant_photo (id, plant_id, media_id, is_primary)
    VALUES (${plantPhotoId}, ${plantId}, ${mediaId}, true)
  `.execute(db);
  await sql`
    INSERT INTO plants_inventory.plant_identification
      (id, plant_id, plant_photo_id, confidence_score)
    VALUES (${identificationId}, ${plantId}, ${plantPhotoId}, 0.9)
  `.execute(db);
  await sql`
    UPDATE plants_inventory.plant SET accepted_identification_id = ${identificationId}
     WHERE id = ${plantId}
  `.execute(db);
  await sql`
    INSERT INTO plants_inventory.plant_revision
      (plant_id, revision, command_type, lifecycle_stage, status, actor_profile_id)
    VALUES (${plantId}, 1, 'addPlant', 'growing', 'active', ${ownerId})
  `.execute(db);

  // --- observations
  const observationId = randomUUID();
  const observationPhotoId = randomUUID();
  await sql`
    INSERT INTO observations_history.observation
      (id, garden_id, plant_id, actor_type, created_by_profile_id, note_text, observed_at)
    VALUES (${observationId}, ${gardenId}, ${plantId}, 'user', ${ownerId}, 'Looks healthy', ${now})
  `.execute(db);
  await sql`
    INSERT INTO observations_history.observation_photo (id, observation_id, media_id)
    VALUES (${observationPhotoId}, ${observationId}, ${mediaId})
  `.execute(db);
  await sql`
    INSERT INTO observations_history.image_analysis_result
      (id, observation_photo_id, analysis_kind, suggested_label, confidence_score)
    VALUES (${randomUUID()}, ${observationPhotoId}, 'stress', 'leaf scorch', 0.6)
  `.execute(db);

  // --- tasks
  const taskId = randomUUID();
  await sql`
    INSERT INTO tasks_recommendations.task
      (id, garden_id, target_kind, target_plant_id, title, status, urgency, source,
       origin_observation_id, created_by_profile_id)
    VALUES (${taskId}, ${gardenId}, 'plant', ${plantId}, 'Prune the apple tree', 'planned',
            'normal', 'manual', ${observationId}, ${ownerId})
  `.execute(db);
  await sql`
    INSERT INTO tasks_recommendations.task_attachment (id, task_id, media_id)
    VALUES (${randomUUID()}, ${taskId}, ${mediaId})
  `.execute(db);
  await sql`
    INSERT INTO tasks_recommendations.task_revision
      (task_id, revision, command_type, status, actor_profile_id)
    VALUES (${taskId}, 1, 'createManualTask', 'planned', ${ownerId})
  `.execute(db);

  // --- recommendations. The candidate and its primary evidence reference
  // each other, which only a DEFERRABLE constraint inside one transaction
  // makes representable — exactly how the real engine writes them.
  const ruleVersionId = randomUUID();
  await sql`
    INSERT INTO tasks_recommendations.rule_version (id, rule_key, version, safety_tier)
    VALUES (${ruleVersionId}, ${`watering.dry_spell.${ruleVersionId}`}, 1, 'ordinary_care')
  `.execute(db);

  const candidateId = randomUUID();
  const evidenceId = randomUUID();
  await db.transaction().execute(async (trx) => {
    await sql`
      INSERT INTO tasks_recommendations.recommendation_candidate
        (id, garden_id, target_kind, target_plant_id, care_category, rule_version_id,
         safety_tier, state, urgency, primary_evidence_id, explanation)
      VALUES (${candidateId}, ${gardenId}, 'plant', ${plantId}, 'watering', ${ruleVersionId},
              'ordinary_care', 'eligible', 'normal', ${evidenceId}, 'The soil is dry.')
    `.execute(trx);
    await sql`
      INSERT INTO tasks_recommendations.recommendation_evidence
        (id, candidate_id, evidence_kind, source_observation_id, fact_key, fact_value)
      VALUES (${evidenceId}, ${candidateId}, 'observation', ${observationId}, 'soil.dry',
              ${JSON.stringify(true)}::jsonb)
    `.execute(trx);
  });
  await sql`
    INSERT INTO tasks_recommendations.recommendation_priority_factor
      (id, candidate_id, factor_kind, factor_value)
    VALUES (${randomUUID()}, ${candidateId}, 'urgency_window', ${JSON.stringify({ days: 2 })}::jsonb)
  `.execute(db);
  await sql`
    INSERT INTO tasks_recommendations.recommendation_feedback
      (id, candidate_id, feedback_kind, actor_profile_id)
    VALUES (${randomUUID()}, ${candidateId}, 'completed', ${ownerId})
  `.execute(db);
  await sql`
    INSERT INTO tasks_recommendations.recommendation_ai_explanation
      (id, candidate_id, locale, provider_key, model, prompt_template_version,
       packet_fact_keys, generated_text, validation_outcome)
    VALUES (${randomUUID()}, ${candidateId}, 'en', 'test', 'test-model', 1,
            ${JSON.stringify(['soil.dry'])}::jsonb, 'Because it is dry.', 'accepted')
  `.execute(db);

  // --- weather
  await sql`
    INSERT INTO integrations.weather_record
      (id, garden_id, provider_key, record_kind, effective_at, fetched_at, latitude, longitude,
       temperature_celsius, unit_system, source_units, license_note)
    VALUES (${randomUUID()}, ${gardenId}, 'test', 'observation', ${now}, ${now}, 52.1, 4.3,
            20, 'si', ${JSON.stringify({ temperature: 'celsius' })}::jsonb, 'test licence')
  `.execute(db);

  // --- notifications
  const notificationIntentId = randomUUID();
  await sql`
    INSERT INTO notifications.notification_intent
      (id, intent_type, recipient_profile_id, garden_id, recommendation_candidate_id,
       source_event_id, template_key, template_parameters, priority, channel_in_app,
       channel_push, deep_link, dedup_key, earliest_delivery_at, expires_at)
    VALUES (${notificationIntentId}, 'care_recommendation', ${ownerId}, ${gardenId}, ${candidateId},
            ${randomUUID()}, 'care_recommendation.created.v1', ${JSON.stringify({})}::jsonb,
            'normal', true, true, ${JSON.stringify({ kind: 'today', gardenId })}::jsonb,
            ${`care:${candidateId}`}, ${now}, ${now})
  `.execute(db);
  await sql`
    INSERT INTO notifications.notification_delivery_attempt
      (id, intent_id, device_id, outcome, attempted_at)
    VALUES (${randomUUID()}, ${notificationIntentId}, ${randomUUID()}, 'accepted', ${now})
  `.execute(db);
  await sql`
    INSERT INTO notifications.notification_preference
      (id, profile_id, garden_id, notification_type, in_app_enabled, push_enabled)
    VALUES (${randomUUID()}, ${ownerId}, ${gardenId}, 'care_recommendation', true, false)
  `.execute(db);

  // --- exports
  const exportRequestId = randomUUID();
  const packageMediaId = randomUUID();
  await sql`
    INSERT INTO exports.export_request
      (id, requester_profile_id, scope, garden_id, include_media, format_version,
       session_credential_kind, session_authenticated_at, output_media_id,
       package_bucket_name, package_object_key, state, failure_code)
    VALUES (${exportRequestId}, ${ownerId}, 'garden', ${gardenId}, true, '1',
            'sessionCookie', ${now}, ${packageMediaId}, 'test-exports',
            ${`cd/${packageMediaId}/${randomUUID()}`}, 'failed', 'test')
  `.execute(db);
  await sql`
    INSERT INTO exports.export_section_checkpoint
      (export_request_id, entry_path, disposition, bucket_name, object_key, content_type,
       checksum_sha256, byte_size, completed_at)
    VALUES (${exportRequestId}, 'export.json', 'package', 'test-exports',
            ${`staging/${exportRequestId}/export.json`}, 'application/json',
            ${'a'.repeat(64)}, 12, ${now})
  `.execute(db);

  // --- platform: a published outbox event about this garden, and the sync
  // changes a real client would already have pulled.
  await sql`
    INSERT INTO platform.outbox_event
      (id, event_type, aggregate_type, aggregate_id, payload, published_at)
    VALUES (${randomUUID()}, 'garden.created', 'garden', ${gardenId}, ${JSON.stringify({})}::jsonb, ${now})
  `.execute(db);
  await sql`
    INSERT INTO platform.sync_change (garden_id, record_id, record_type, operation, record_revision)
    VALUES (${gardenId}, ${gardenId}, 'garden', 'upsert', 1),
           (${gardenId}, ${plantId}, 'plant', 'upsert', 1)
  `.execute(db);

  return {
    gardenId,
    gardenRevision: 1,
    ownerId,
    editorId,
    mediaId,
    mapObjectId,
    plantId,
    notificationIntentId,
    exportRequestId,
  };
}
