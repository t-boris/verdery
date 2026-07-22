import type { MapCommandPayload } from '@verdery/geometry-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import {
  toWireCommandPayload,
  type WireGardenMapDocument,
  type WireMapCommandResult,
} from './map-wire-types';
import type { ApiResult } from './result';

/** Garden-local viewport in metres. All four bounds are required together — see `openapi.yaml`. */
export interface MapViewportBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface MapGateway {
  getMap(
    gardenId: string,
    viewport?: MapViewportBounds,
    signal?: AbortSignal,
  ): Promise<ApiResult<WireGardenMapDocument>>;
  submitCommand(
    gardenId: string,
    commandId: string,
    clientTimestamp: string,
    payload: MapCommandPayload,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<WireMapCommandResult>>;
}

function viewportQuery(viewport: MapViewportBounds | undefined): string {
  if (viewport === undefined) {
    return '';
  }

  const params = new URLSearchParams({
    minX: String(viewport.minX),
    minY: String(viewport.minY),
    maxX: String(viewport.maxX),
    maxY: String(viewport.maxY),
  });
  return `?${params.toString()}`;
}

/**
 * Gateway for the garden map endpoints.
 *
 * One command endpoint carries every editor command (`submitCommand`), rather
 * than one REST method per command type — see `openapi.yaml`, operation
 * `submitMapCommand`, for why. Callers build the `MapCommandPayload` (see
 * `features/map/commands.ts`); this gateway only knows how to transport it.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Map`;
 * services/api/src/modules/gardens-mapping/transport/map-routes.ts.
 */
export function createMapGateway(client: ApiClient): MapGateway {
  return {
    getMap(gardenId, viewport, signal) {
      return client.request<WireGardenMapDocument>({
        method: 'GET',
        path: `/gardens/${gardenId}/map${viewportQuery(viewport)}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    submitCommand(gardenId, commandId, clientTimestamp, payload, idempotencyKey, signal) {
      return client.request<WireMapCommandResult>({
        method: 'POST',
        path: `/gardens/${gardenId}/map/commands`,
        // `toWireCommandPayload` flattens `categoryDetails` for the two
        // command types that carry it — see `map-wire-types.ts`'s module
        // doc comment for the confirmed request/response shape asymmetry
        // this bridges.
        body: { commandId, clientTimestamp, payload: toWireCommandPayload(payload) },
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
