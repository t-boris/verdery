import type { CreateObjectPayload, MoveObjectPayload } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createMapGateway } from './map-gateway';
import type { WireGardenMapDocument, WireMapCommandResult } from './map-wire-types';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function gatewayRecording(response: Response) {
  const recorded: RecordedRequest[] = [];
  const fetchImplementation: FetchLike = (url, init) => {
    recorded.push({ url, init });
    return Promise.resolve(response);
  };

  const client = createApiClient({ origin: ORIGIN, fetchImplementation });
  return { gateway: createMapGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const EMPTY_DOCUMENT: WireGardenMapDocument = {
  coordinateSpaceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  objects: [],
  validationSummary: [],
};

describe('createMapGateway', () => {
  it('gets the whole map when no viewport is supplied', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(EMPTY_DOCUMENT, 200));

    const result = await gateway.getMap(GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/map`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: EMPTY_DOCUMENT }));
  });

  it('encodes all four viewport bounds together', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(EMPTY_DOCUMENT, 200));

    await gateway.getMap(GARDEN_ID, { minX: -5, minY: -5, maxX: 5, maxY: 5 });

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/map?minX=-5&minY=-5&maxX=5&maxY=5`,
    );
  });

  it('posts the command envelope with the idempotency key header', async () => {
    const result: WireMapCommandResult = { affectedObjects: [] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(result, 200));

    const payload: MoveObjectPayload = {
      type: 'moveObject',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
      expectedRevision: 3,
      translationMetres: { dx: 1.5, dy: -0.5 },
    };

    await gateway.submitCommand(
      GARDEN_ID,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
      '2026-07-21T09:00:00Z',
      payload,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/map/commands`);
    expect(recorded[0]?.init.method).toBe('POST');
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      commandId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
      clientTimestamp: '2026-07-21T09:00:00Z',
      payload,
    });
  });

  it('flattens categoryDetails on the wire — confirmed live-endpoint behaviour, see map-wire-types.ts', async () => {
    const result: WireMapCommandResult = { affectedObjects: [] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(result, 200));

    const payload: CreateObjectPayload = {
      type: 'createObject',
      objectId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d',
      category: 'structure',
      geometry: { type: 'Point', coordinates: [1, 2] },
      categoryDetails: {
        category: 'structure',
        details: { structureKind: 'shed', heightMetres: 2.5 },
      },
    };

    await gateway.submitCommand(
      GARDEN_ID,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
      '2026-07-21T09:00:00Z',
      payload,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    const sentBody = JSON.parse(recorded[0]?.init.body as string) as {
      payload: { categoryDetails: unknown };
    };
    expect(sentBody.payload.categoryDetails).toEqual({
      category: 'structure',
      structureKind: 'shed',
      heightMetres: 2.5,
    });
  });
});
