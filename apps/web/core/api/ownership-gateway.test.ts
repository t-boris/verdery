import type {
  GardenMember,
  IncomingOwnershipTransferListResult,
  OwnershipTransfer,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createOwnershipGateway } from './ownership-gateway';

const ORIGIN = 'https://api.example.test';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a05';

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
  return { gateway: createOwnershipGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const MEMBER: GardenMember = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a04',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const TRANSFER: OwnershipTransfer = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a06',
  gardenId: GARDEN_ID,
  fromProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a07',
  toProfileId: PROFILE_ID,
  fromResultingRole: 'editor',
  state: 'pending',
  authenticatedAt: '2026-07-21T09:00:00Z',
  requestedAt: '2026-07-21T09:00:00Z',
};

describe('createOwnershipGateway', () => {
  it('posts to the promote sub-resource with no body', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEMBER, 200));

    await gateway.promoteMember(GARDEN_ID, PROFILE_ID, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/members/${PROFILE_ID}/promote`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe(IDEMPOTENCY_KEY);
  });

  it('posts to the demote sub-resource with the resulting role', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...MEMBER, role: 'editor' }, 200),
    );

    await gateway.demoteOwner(GARDEN_ID, PROFILE_ID, { role: 'editor' }, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/members/${PROFILE_ID}/demote`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ role: 'editor' });
  });

  it("reads the garden's currently pending ownership transfer", async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TRANSFER, 200));

    await gateway.getGardenOwnershipTransfer(GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/ownership-transfer`);
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('requests an ownership transfer', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TRANSFER, 200));

    await gateway.transferOwnership(
      GARDEN_ID,
      { toProfileId: PROFILE_ID, resultingRole: 'editor' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/ownership-transfer`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      toProfileId: PROFILE_ID,
      resultingRole: 'editor',
    });
  });

  it('cancels the pending ownership transfer with DELETE and no body', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...TRANSFER, state: 'cancelled' }, 200),
    );

    await gateway.cancelOwnershipTransfer(GARDEN_ID, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/ownership-transfer`);
    expect(recorded[0]?.init.method).toBe('DELETE');
  });

  it('accepts the pending ownership transfer addressed to the caller', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...TRANSFER, state: 'completed' }, 200),
    );

    await gateway.acceptOwnershipTransfer(GARDEN_ID, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/ownership-transfer/accept`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('declines the pending ownership transfer addressed to the caller', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...TRANSFER, state: 'cancelled' }, 200),
    );

    await gateway.declineOwnershipTransfer(GARDEN_ID, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/ownership-transfer/decline`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('lists every incoming ownership transfer addressed to the caller, across gardens', async () => {
    const result: IncomingOwnershipTransferListResult = {
      items: [{ ...TRANSFER, gardenName: 'Riverside Garden' }],
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(result, 200));

    await gateway.listIncomingOwnershipTransfers();

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/ownership-transfers/incoming`);
    expect(recorded[0]?.init.method).toBe('GET');
  });
});
