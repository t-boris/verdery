import type { GardenMember, Invitation } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createCollaborationGateway } from './collaboration-gateway';
import { CSRF_HEADER_NAME } from './csrf';

const ORIGIN = 'https://api.example.test';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';

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
  return { gateway: createCollaborationGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const INVITATION: Invitation = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01',
  gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
  inviterProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03',
  intendedRole: 'editor',
  state: 'pending',
  createdAt: '2026-07-21T09:00:00Z',
  expiresAt: '2026-07-28T09:00:00Z',
};

const MEMBER: GardenMember = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a04',
  gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02',
  profileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a05',
  role: 'editor',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

describe('createCollaborationGateway', () => {
  it('creates an invitation with the idempotency key header and request body', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...INVITATION, token: 'a'.repeat(32) }, 201),
    );

    await gateway.createInvitation(
      INVITATION.gardenId,
      { intendedRole: 'editor', intendedEmail: 'friend@example.test' },
      IDEMPOTENCY_KEY,
    );

    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${INVITATION.gardenId}/invitations`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headers['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      intendedRole: 'editor',
      intendedEmail: 'friend@example.test',
    });
  });

  it('lists a garden invitations', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [INVITATION] }, 200));

    const result = await gateway.listInvitations(INVITATION.gardenId);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${INVITATION.gardenId}/invitations`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: { items: [INVITATION] } }));
  });

  it('posts to the revoke sub-resource', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(INVITATION, 200));

    await gateway.revokeInvitation(INVITATION.gardenId, INVITATION.id, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${INVITATION.gardenId}/invitations/${INVITATION.id}/revoke`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('accepts an invitation at the top-level, garden-less path', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEMBER, 200));

    await gateway.acceptInvitation('a'.repeat(32), IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/invitations/accept`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ token: 'a'.repeat(32) });
  });

  it('lists a garden members with no idempotency key, being a read', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [MEMBER] }, 200));

    await gateway.listMembers(MEMBER.gardenId);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${MEMBER.gardenId}/members`);
    expect(recorded[0]?.init.method).toBe('GET');
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
  });

  it('changes a member role with PATCH', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...MEMBER, role: 'viewer' }, 200),
    );

    await gateway.changeMemberRole(
      MEMBER.gardenId,
      MEMBER.profileId,
      { role: 'viewer' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${MEMBER.gardenId}/members/${MEMBER.profileId}`,
    );
    expect(recorded[0]?.init.method).toBe('PATCH');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ role: 'viewer' });
  });

  it('removes a member with DELETE', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEMBER, 200));

    await gateway.removeMember(MEMBER.gardenId, MEMBER.profileId, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${MEMBER.gardenId}/members/${MEMBER.profileId}`,
    );
    expect(recorded[0]?.init.method).toBe('DELETE');
  });

  it('never sends a CSRF header when no CSRF cookie is present', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEMBER, 200));

    await gateway.removeMember(MEMBER.gardenId, MEMBER.profileId, IDEMPOTENCY_KEY);

    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER_NAME]).toBeUndefined();
  });
});
