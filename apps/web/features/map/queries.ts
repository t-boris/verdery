'use client';

import type { MapCommandPayload } from '@verdery/geometry-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createGeocodingGateway,
  createMapGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
  type WireGeoreference,
  type WireAerialTraceResult,
  type WireSetGeoreferenceRequest,
  type WireValidationIssue,
} from '@/core/api/public';
import type { AddressCandidateListResult } from '@verdery/api-contracts';

import { generateMapId } from './commands';
import { toMapObjectRecord } from './object-mapper';
import type { MapObjectRecord } from './types';

/**
 * TanStack Query hooks for the garden map.
 *
 * Mirrors `features/gardens/queries.ts`: gateway wrapped in `useMemo`,
 * `unwrap` turns a typed `ApiResult` failure into `ApiFailureError` so
 * `query.isError`/`mutation.isError` carry it, and `query.data` is already in
 * this feature's local `MapObjectRecord` shape — no component reaches for the
 * wire shape directly.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

export interface MapDocumentData {
  readonly coordinateSpaceId: string;
  readonly georeference?: WireGeoreference;
  readonly objects: readonly MapObjectRecord[];
  readonly validationSummary: readonly WireValidationIssue[];
}

const mapQueryKey = (gardenId: string) => ['map', gardenId] as const;

function useMapGateway() {
  return useMemo(() => createMapGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useGardenMap(gardenId: string) {
  const gateway = useMapGateway();

  return useQuery<MapDocumentData, ApiFailureError>({
    queryKey: mapQueryKey(gardenId),
    queryFn: async ({ signal }) => {
      const document = unwrap(await gateway.getMap(gardenId, undefined, signal));
      return {
        coordinateSpaceId: document.coordinateSpaceId,
        ...(document.georeference === undefined ? {} : { georeference: document.georeference }),
        objects: document.objects.map(toMapObjectRecord),
        validationSummary: document.validationSummary,
      };
    },
  });
}

/** Explicit, user-triggered provider call; never retries or runs on mount. */
export function useTraceGardenFromAerial(gardenId: string) {
  const gateway = useMapGateway();

  return useMutation<WireAerialTraceResult, ApiFailureError>({
    mutationFn: async () => unwrap(await gateway.traceAerial(gardenId)),
    retry: false,
  });
}

/** Replaces or appends every upserted record; removes every record the command soft-deleted. */
function mergeAffected(
  current: MapDocumentData,
  affected: readonly MapObjectRecord[],
): MapDocumentData {
  let objects = current.objects;

  for (const record of affected) {
    if (record.lifecycleState === 'deleted') {
      objects = objects.filter((existing) => existing.id !== record.id);
      continue;
    }

    const index = objects.findIndex((existing) => existing.id === record.id);
    objects = index === -1 ? [...objects, record] : objects.with(index, record);
  }

  return { ...current, objects };
}

/**
 * Submits one map editor command and folds the server's authoritative
 * response back into the cached map document.
 *
 * Undo/redo bookkeeping is the caller's job (`use-map-editor-actions.ts`):
 * this hook only knows how to talk to the server and keep the query cache
 * correct, the same separation `features/gardens/queries.ts` keeps between
 * server state and UI concerns.
 */
export function useSubmitMapCommand(gardenId: string) {
  const gateway = useMapGateway();
  const queryClient = useQueryClient();

  return useMutation<readonly MapObjectRecord[], ApiFailureError, MapCommandPayload>({
    mutationFn: async (payload) => {
      const commandId = generateMapId();
      const clientTimestamp = new Date().toISOString();
      const idempotencyKey = generateIdempotencyKey();

      const result = unwrap(
        await gateway.submitCommand(gardenId, commandId, clientTimestamp, payload, idempotencyKey),
      );
      return result.affectedObjects.map(toMapObjectRecord);
    },
    onSuccess: (affected) => {
      queryClient.setQueryData<MapDocumentData>(mapQueryKey(gardenId), (current) =>
        current === undefined ? current : mergeAffected(current, affected),
      );
    },
  });
}

/**
 * Places the garden on the Earth, or moves where it already sits.
 *
 * The response IS the new record, so the cached map document is updated
 * from it rather than invalidated: nothing else about the map changed —
 * georeferencing moves no local geometry — and refetching every object to
 * learn one anchor would be a bigger request than the write itself.
 */
export function useSetGardenGeoreference(gardenId: string) {
  const gateway = useMapGateway();
  const queryClient = useQueryClient();

  return useMutation<WireGeoreference, ApiFailureError, WireSetGeoreferenceRequest>({
    mutationFn: async (request) => {
      const current = queryClient.getQueryData<MapDocumentData>(mapQueryKey(gardenId));

      return unwrap(
        await gateway.setGeoreference(
          gardenId,
          request,
          current?.georeference?.revision ?? null,
          generateIdempotencyKey(),
        ),
      );
    },
    onSuccess: (georeference) => {
      queryClient.setQueryData<MapDocumentData>(mapQueryKey(gardenId), (cached) =>
        cached === undefined ? cached : { ...cached, georeference },
      );
      // Weather, hemisphere, and the seasonal plan all read this record.
      // They are other features' queries, so the honest move is to drop what
      // was derived from the old location rather than patch it here.
      // Keys owned by `features/seasonal-plan` and `features/recommendations`
      // — named here, not imported, for the same dependency-rule reason
      // `useCallerRole` is duplicated across features.
      void queryClient.invalidateQueries({ queryKey: ['seasonal-plan', gardenId] });
      void queryClient.invalidateQueries({ queryKey: ['today', gardenId] });
    },
  });
}

/**
 * Address lookup for the location panel.
 *
 * A mutation rather than a query, deliberately: this runs when someone
 * presses search, not when a component renders, and re-running it on a
 * remount would be a provider call nobody asked for.
 */
export function useAddressCandidates() {
  const gateway = useMemo(() => createGeocodingGateway(createBrowserApiClient()), []);

  return useMutation<AddressCandidateListResult, ApiFailureError, string>({
    mutationFn: async (query) => unwrap(await gateway.findAddressCandidates(query)),
  });
}
