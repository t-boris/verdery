/**
 * `createObject` — the one command that can introduce a garden's coordinate
 * space as a side effect (see `CoordinateSpaceRepository.findOrCreateForGarden`).
 *
 * `provenance` defaults to `'manualDrawing'`: `CreateObjectPayload` (both the
 * OpenAPI `CreateMapObjectCommand` and `packages/geometry-contracts`'s own
 * type) carries no `provenance` field at all, so the server must choose one,
 * and a human using the map editor to draw a new shape is definitionally
 * manual-drawing provenance — the other provenance kinds
 * (`importedPlan`, `arMeasurement`, `processor`, and so on) describe
 * ingestion pipelines outside this command's scope (assisted capture is
 * Phase 10). `confidence` is likewise absent from the command and defaults
 * to `null` ("not expressed").
 */

import type { CreateObjectPayload } from '@verdery/geometry-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MapObject } from '../domain/map-object.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenObjectResource, type MapCommandResultResource } from './map-object-view.js';
import { requireMatchingCategoryDetails } from './validate-category-details.js';
import { requireGateReferencesExistingFence } from './validate-gate-fence-reference.js';
import { requireValidGeometryForCategory } from './validate-map-geometry.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.createObject';

export class CreateMapObject {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    payload: CreateObjectPayload,
    idempotencyKey: string,
  ): Promise<MapCommandResultResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    requireValidGeometryForCategory(payload.category, payload.geometry);
    requireMatchingCategoryDetails(payload.category, payload.categoryDetails);

    const input = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, payload }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      await requireGateReferencesExistingFence(
        context.mapObjects,
        gardenId,
        payload.categoryDetails,
      );
      const coordinateSpace = await context.coordinateSpaces.findOrCreateForGarden(gardenId, now);

      const object: MapObject = {
        id: payload.objectId,
        gardenId,
        coordinateSpaceId: coordinateSpace.id,
        category: payload.category,
        geometry: payload.geometry,
        label: payload.label ?? null,
        provenance: 'manualDrawing',
        confidence: null,
        lifecycleState: 'active',
        currentRevision: 1,
        details: payload.categoryDetails,
        createdByProfileId: profileId,
        createdAt: now,
        updatedAt: now,
      };

      await context.mapObjects.insert(object);

      await context.revisionJournal.record({
        gardenObjectId: object.id,
        revision: object.currentRevision,
        commandType: 'createObject',
        geometry: object.geometry,
        label: object.label,
        lifecycleState: object.lifecycleState,
        actorProfileId: profileId,
      });
      await context.syncChanges.record({
        gardenId,
        recordId: object.id,
        recordType: 'gardenObject',
        operation: 'upsert',
        recordRevision: object.currentRevision,
      });
      await context.outbox.append({
        eventType: 'mapObject.created',
        aggregateType: 'gardenObject',
        aggregateId: object.id,
        payload: { gardenId, category: object.category },
      });
      await context.auditLogger.record({
        eventType: 'mapObject.created',
        subjectType: 'gardenObject',
        subjectId: object.id,
        actorProfileId: profileId,
        actorType: 'user',
      });

      return { affectedObjects: [toGardenObjectResource(object)] };
    });
  }
}
