/**
 * Garden map HTTP routes: the read-only map document and the single
 * revision-aware command endpoint.
 *
 * Same hand-written-validation convention as `garden-routes.ts` — reuses its
 * `requireGardenId`/`requireIdempotencyKey`/`UUID_PATTERN`/`invalid` rather
 * than a second copy of the same logic.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Map`; implementation-plan.md
 * work packages P3-BE-01, P3-BE-02.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { invalid, requireGardenId, requireIdempotencyKey } from './garden-routes.js';
import { parseMapCommandPayload } from './parse-map-command-payload.js';
import { requireDateTime, requireNumber, requireUuid } from './parse-primitives.js';
import type { AssignPlantToTarget } from '../application/assign-plant-to-target.js';
import type { ChangeMapObjectProperties } from '../application/change-map-object-properties.js';
import type { CreateMapObject } from '../application/create-map-object.js';
import type { DecideMapProposal } from '../application/decide-map-proposal.js';
import type { DeleteMapObject } from '../application/delete-map-object.js';
import type { DuplicateMapObject } from '../application/duplicate-map-object.js';
import type { EditMapObjectVertex } from '../application/edit-map-object-vertex.js';
import type { GetGardenMap } from '../application/get-garden-map.js';
import type { JoinMapObjectLinework } from '../application/join-map-object-linework.js';
import type { MapCommandResultResource } from '../application/map-object-view.js';
import type { ViewportBoundingBox } from '../application/map-object-repository.js';
import type { MoveMapObject } from '../application/move-map-object.js';
import type { ReplaceMapObjectGeometry } from '../application/replace-map-object-geometry.js';
import type { RestoreMapObject } from '../application/restore-map-object.js';
import type { SplitMapObjectLinework } from '../application/split-map-object-linework.js';
import type { UpsertMapCalibration } from '../application/upsert-map-calibration.js';

export interface MapRoutesDependencies {
  readonly getGardenMap: GetGardenMap;
  readonly createMapObject: CreateMapObject;
  readonly moveMapObject: MoveMapObject;
  readonly replaceMapObjectGeometry: ReplaceMapObjectGeometry;
  readonly editMapObjectVertex: EditMapObjectVertex;
  readonly splitMapObjectLinework: SplitMapObjectLinework;
  readonly joinMapObjectLinework: JoinMapObjectLinework;
  readonly changeMapObjectProperties: ChangeMapObjectProperties;
  readonly assignPlantToTarget: AssignPlantToTarget;
  readonly upsertMapCalibration: UpsertMapCalibration;
  readonly decideMapProposal: DecideMapProposal;
  readonly deleteMapObject: DeleteMapObject;
  readonly restoreMapObject: RestoreMapObject;
  readonly duplicateMapObject: DuplicateMapObject;
}

function parseViewport(request: FastifyRequest): ViewportBoundingBox | null {
  const query = request.query as Record<string, unknown>;
  const keys = ['minX', 'minY', 'maxX', 'maxY'] as const;
  const present = keys.filter((key) => query[key] !== undefined);

  if (present.length === 0) {
    return null;
  }
  if (present.length !== keys.length) {
    throw invalid(
      'minX, minY, maxX, and maxY must all be supplied together, or all omitted.',
      'request.viewport.incomplete',
      '/query',
    );
  }

  const toNumber = (key: (typeof keys)[number]): number => {
    const raw = query[key];
    const value = typeof raw === 'string' ? Number(raw) : raw;
    return requireNumber(value, `/query/${key}`);
  };

  return {
    minX: toNumber('minX'),
    minY: toNumber('minY'),
    maxX: toNumber('maxX'),
    maxY: toNumber('maxY'),
  };
}

function requireCommandId(request: FastifyRequest): string {
  const body = request.body as { commandId?: unknown };
  return requireUuid(body.commandId, '/commandId');
}

function requireClientTimestamp(request: FastifyRequest): string {
  const body = request.body as { clientTimestamp?: unknown };
  return requireDateTime(body.clientTimestamp, '/clientTimestamp');
}

export function registerMapRoutes(app: FastifyInstance, dependencies: MapRoutesDependencies): void {
  app.get('/gardens/:gardenId/map', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const viewport = parseViewport(request);

    const document = await dependencies.getGardenMap.execute(
      gardenId,
      request.actorContext.profileId,
      viewport,
    );

    return reply.status(200).send(document);
  });

  app.post('/gardens/:gardenId/map/commands', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    // Validated for contract conformance but not otherwise used — see the
    // module doc comment on `application/create-map-object.ts`'s sibling
    // handlers and the work package's final report for why commandId has
    // nowhere durable to be stored this pass (`garden_object_revision` has
    // no command_id column).
    requireCommandId(request);
    requireClientTimestamp(request);

    const body = request.body as { payload?: unknown };
    const payload = parseMapCommandPayload(body.payload, '/payload');
    const profileId = request.actorContext.profileId;

    let result: MapCommandResultResource;
    switch (payload.type) {
      case 'createObject':
        result = await dependencies.createMapObject.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'moveObject':
        result = await dependencies.moveMapObject.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'replaceGeometry':
        result = await dependencies.replaceMapObjectGeometry.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'editVertex':
        result = await dependencies.editMapObjectVertex.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'splitLinework':
        result = await dependencies.splitMapObjectLinework.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'joinLinework':
        result = await dependencies.joinMapObjectLinework.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'changeProperties':
        result = await dependencies.changeMapObjectProperties.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'assignPlant':
        result = await dependencies.assignPlantToTarget.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'upsertCalibration':
        result = await dependencies.upsertMapCalibration.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'decideProposal':
        result = await dependencies.decideMapProposal.execute(gardenId, profileId, payload);
        break;
      case 'deleteObject':
        result = await dependencies.deleteMapObject.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'restoreObject':
        result = await dependencies.restoreMapObject.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
      case 'duplicateObject':
        result = await dependencies.duplicateMapObject.execute(
          gardenId,
          profileId,
          payload,
          idempotencyKey,
        );
        break;
    }

    return reply.status(200).send(result);
  });
}
