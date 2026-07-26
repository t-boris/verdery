import type {
  ClientEngagement,
  GardenAssignment,
  OrganizationMember,
  ServiceOrganization,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createOrganizationGateway } from './organization-gateway';

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
  return { gateway: createOrganizationGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ORGANIZATION: ServiceOrganization = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b01',
  name: 'Riverside Landscaping',
  callerRole: 'organizationAdmin',
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const MEMBER: OrganizationMember = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b02',
  organizationId: ORGANIZATION.id,
  profileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b03',
  role: 'professional',
  state: 'active',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const ASSIGNMENT: GardenAssignment = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b04',
  organizationId: ORGANIZATION.id,
  profileId: MEMBER.profileId,
  gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b05',
  role: 'editor',
  state: 'active',
  validFrom: '2026-07-21T09:00:00Z',
  createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b06',
  createdAt: '2026-07-21T09:00:00Z',
};

const ENGAGEMENT: ClientEngagement = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9b07',
  gardenId: ASSIGNMENT.gardenId,
  serviceOrganizationId: ORGANIZATION.id,
  state: 'draft',
  stewardshipPolicy: 'residential',
  clientNotificationsEnabled: true,
  createdByProfileId: ASSIGNMENT.createdByProfileId,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

describe('createOrganizationGateway — service organizations', () => {
  it('creates an organization with the idempotency key header and request body', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(ORGANIZATION, 201));

    await gateway.create({ name: ORGANIZATION.name }, IDEMPOTENCY_KEY);

    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/service-organizations`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headers['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ name: ORGANIZATION.name });
  });

  it('lists the caller’s own organizations with no idempotency key, being a read', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [ORGANIZATION] }, 200));

    const result = await gateway.list();

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/service-organizations`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: { items: [ORGANIZATION] } }));
  });

  it('gets a single organization by id', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(ORGANIZATION, 200));

    await gateway.get(ORGANIZATION.id);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}`);
    expect(recorded[0]?.init.method).toBe('GET');
  });
});

describe('createOrganizationGateway — organization membership', () => {
  it('lists an organization’s member roster', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [MEMBER] }, 200));

    await gateway.listMembers(ORGANIZATION.id);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/members`);
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('adds an existing profile as a member', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEMBER, 201));

    await gateway.addMember(
      ORGANIZATION.id,
      { profileId: MEMBER.profileId, role: 'professional' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/members`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      profileId: MEMBER.profileId,
      role: 'professional',
    });
  });

  it('changes a member role with PATCH', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...MEMBER, role: 'organizationAdmin' }, 200),
    );

    await gateway.changeMemberRole(
      ORGANIZATION.id,
      MEMBER.profileId,
      { role: 'organizationAdmin' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/members/${MEMBER.profileId}`,
    );
    expect(recorded[0]?.init.method).toBe('PATCH');
  });

  it('removes a member with DELETE', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEMBER, 200));

    await gateway.removeMember(ORGANIZATION.id, MEMBER.profileId, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/members/${MEMBER.profileId}`,
    );
    expect(recorded[0]?.init.method).toBe('DELETE');
  });
});

describe('createOrganizationGateway — garden assignments', () => {
  it('creates a garden assignment', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(ASSIGNMENT, 201));

    await gateway.createGardenAssignment(
      ORGANIZATION.id,
      { profileId: MEMBER.profileId, gardenId: ASSIGNMENT.gardenId, role: 'editor' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/garden-assignments`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('lists an organization’s garden assignments', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [ASSIGNMENT] }, 200));

    await gateway.listOrganizationGardenAssignments(ORGANIZATION.id);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/garden-assignments`,
    );
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('ends a garden assignment at its own sub-resource', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...ASSIGNMENT, state: 'ended' }, 200),
    );

    await gateway.endGardenAssignment(ORGANIZATION.id, ASSIGNMENT.id, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/garden-assignments/${ASSIGNMENT.id}/end`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('revokes a garden assignment at its own sub-resource', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...ASSIGNMENT, state: 'revoked' }, 200),
    );

    await gateway.revokeGardenAssignment(ORGANIZATION.id, ASSIGNMENT.id, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/garden-assignments/${ASSIGNMENT.id}/revoke`,
    );
    expect(recorded[0]?.init.method).toBe('POST');
  });
});

describe('createOrganizationGateway — client engagements', () => {
  it('lists an organization’s client engagements', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [ENGAGEMENT] }, 200));

    await gateway.listOrganizationClientEngagements(ORGANIZATION.id);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/service-organizations/${ORGANIZATION.id}/client-engagements`,
    );
    expect(recorded[0]?.init.method).toBe('GET');
  });

  it('creates a client engagement at the top-level, organization-less path', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(ENGAGEMENT, 201));

    await gateway.createClientEngagement(
      { gardenId: ENGAGEMENT.gardenId, serviceOrganizationId: ORGANIZATION.id },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client-engagements`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('activates a draft engagement', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...ENGAGEMENT, state: 'active' }, 200),
    );

    await gateway.activateClientEngagement(ENGAGEMENT.id, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client-engagements/${ENGAGEMENT.id}/activate`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('ends an active engagement', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...ENGAGEMENT, state: 'ended' }, 200),
    );

    await gateway.endClientEngagement(ENGAGEMENT.id, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client-engagements/${ENGAGEMENT.id}/end`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('revokes an engagement with an optional reason in the body', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse({ ...ENGAGEMENT, state: 'revoked', revokedReason: 'client left' }, 200),
    );

    await gateway.revokeClientEngagement(ENGAGEMENT.id, { reason: 'client left' }, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/client-engagements/${ENGAGEMENT.id}/revoke`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ reason: 'client left' });
  });
});

describe('createOrganizationGateway — garden-scoped reads (tag Collaboration, Organizations-domain rows)', () => {
  it('lists a garden’s active assignments, open to every active role', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [ASSIGNMENT] }, 200));

    await gateway.listGardenAssignments(ASSIGNMENT.gardenId);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${ASSIGNMENT.gardenId}/assignments`);
    expect(recorded[0]?.init.method).toBe('GET');
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
  });

  it('lists a garden’s client engagements, owner-only', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [ENGAGEMENT] }, 200));

    await gateway.listGardenClientEngagements(ENGAGEMENT.gardenId);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${ENGAGEMENT.gardenId}/engagements`);
    expect(recorded[0]?.init.method).toBe('GET');
  });
});
